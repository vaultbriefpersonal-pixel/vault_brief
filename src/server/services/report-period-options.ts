// Which reporting periods can this project actually produce a report for?
//
// ── THE ONE IDEA IN THIS FILE ──
//
// A report is generated FROM a snapshot, and since the `period_start`
// migration a snapshot CARRIES its own window (`period_start` …
// `snapshot_date`). Its balances are as of that window's end and its flows are
// measured over that window. So "which period does this report cover" is NOT a
// free parameter the founder gets to type in — it is a property of the
// snapshot, and a picker that pretends otherwise is a machine for producing
// documents whose stated period and actual contents disagree.
//
// Choosing a period is therefore really: name a window → find the snapshot
// that covers EXACTLY that window → generate. `resolvePeriodOption` is that
// middle step, and "exactly" is not pedantry: a report labelled "since the
// grant award" whose numbers are one month's is the precise failure this whole
// plan has been avoiding.
//
// ── WHAT HAPPENS WHEN NOTHING COVERS THE WINDOW ──
//
// The option is OFFERED AND DISABLED, carrying the reason. Never silently
// snapped to a nearby snapshot, never generated anyway.
//
// This is the "restrict the picker to periods that have snapshots" branch, and
// it is chosen over "offer a sync for that period" because of a hard fact about
// the product as it stands: `projects.sync` builds its periods as
//
//     start = new Date(y, m - 1 - i, 1)
//     end   = new Date(y, m - i, 0, 23:59:59)
//
// i.e. WHOLE CALENDAR MONTHS, walking back from the last completed month. Every
// snapshot this product can create is a calendar month. So "offer a sync for
// that period" is only truthful for month-shaped windows — and for those, this
// module says exactly which backfill depth would create the missing row, which
// is the actionable half of that option without the half that would be a lie.
// For a window that is not a calendar month the honest answer today is that
// the product cannot measure it, and the reason says so in those words rather
// than offering a button that cannot work.
//
// The arbitrary-period machinery downstream (`createReportRecord`'s period
// argument, `reports.generate`'s input, `assertPeriodSupported`) is fully wired
// regardless. The day a sync writes a non-month snapshot, these options resolve
// against it with no change here.
//
// ── DEPENDENCIES ──
//
// Imports `./report-period` and nothing else, on purpose: this is read by a
// "use client" picker as well as by the server page that feeds it, and the same
// constraint report-period.ts documents applies — a server-only import here
// breaks the client bundle. Provenance (`balance_basis`, `reconstruction_meta`)
// arrives ALREADY RESOLVED from the caller, through `balanceBasisOf` /
// `reconstructionMetaOf` in report-derived.ts, so this module never reads those
// columns itself and there is still exactly one reader of each.

import {
  MAX_RECONSTRUCTION_MONTHS,
  assertPeriodSupported,
  periodFromRange,
  periodFromSnapshot,
  type ReportPeriod,
  type SnapshotPeriodLike,
} from "./report-period";

const MS_PER_DAY = 86_400_000;

/** Where a snapshot's balances came from, as `balanceBasisOf` resolves it. */
export type PeriodBalanceBasis = "observed" | "reconstructed";

/**
 * The parts of `reconstruction_meta` a founder needs BEFORE generating.
 *
 * Structural and declared locally rather than imported from
 * balance-reconstruction.ts, for the same reason `SnapshotPeriodLike` is
 * declared locally in report-period.ts: it keeps this module's import list at
 * one entry. Every field is optional because the value is JSONB written by a
 * different deploy than the one reading it.
 */
export interface ReconstructionNote {
  observedAsOf?: string;
  stepsFromObserved?: number;
  clampedPositions?: number;
  unpricedPositions?: number;
  unpricedSymbols?: string[];
  unpricedShareOfTotal?: number | null;
  carriedForwardWallets?: unknown[];
  notes?: string[];
}

/** A snapshot as the picker sees it. */
export interface PeriodSnapshotChoice extends SnapshotPeriodLike {
  id: string;
  basis: PeriodBalanceBasis;
  /** Null on an observed row. */
  reconstruction: ReconstructionNote | null;
}

/** A grant award as the picker sees it — enough to anchor "since the award". */
export interface PeriodGrantAward {
  id: string;
  grantor: string;
  /** 'YYYY-MM-DD'. */
  awardDate: string;
  /** Overrides `awardDate` when the reporting clock starts later. */
  reportingStartDate?: string | null;
}

export interface PeriodOption {
  /** Stable across renders; `custom` is the free-form entry. */
  id: string;
  label: string;
  /** One line under the label explaining where the window comes from. */
  hint: string;
  /** The window this option names, or null when it cannot be computed at all. */
  period: ReportPeriod | null;
  /** The snapshot covering exactly `period`, or null. */
  snapshotId: string | null;
  basis: PeriodBalanceBasis | null;
  reconstruction: ReconstructionNote | null;
  /** Non-null ⇒ the option is not selectable, and this is the visible reason. */
  disabledReason: string | null;
}

export interface PeriodOptionsInput {
  snapshots: readonly PeriodSnapshotChoice[];
  grantAwards?: readonly PeriodGrantAward[];
  /** `max(reports.period_end)` for this project, 'YYYY-MM-DD', or null. */
  lastReportPeriodEnd?: string | null;
  /** The clock. A UTC day; `assertPeriodSupported` reads it through `getUTC*`. */
  today: string | Date;
}

// ─── resolution ────────────────────────────────────────────────────────────

/**
 * Find the snapshot that covers EXACTLY this window.
 *
 * Exact, on both ends. A snapshot whose window merely CONTAINS the requested
 * one is not a match and must never be treated as one: its flow columns are
 * totals over its own window, so reporting them under a shorter label
 * overstates them, and its balances are as of its own end date. There is no
 * arithmetic that narrows a stored snapshot to a sub-window, which is precisely
 * why this is a lookup and not a computation.
 */
export function snapshotCovering<T extends SnapshotPeriodLike>(
  period: ReportPeriod,
  snapshots: readonly T[] | null | undefined
): T | null {
  if (!Array.isArray(snapshots)) return null;
  for (const snapshot of snapshots) {
    let candidate: ReportPeriod;
    try {
      candidate = periodFromSnapshot(snapshot);
    } catch {
      // A row with an unreadable date cannot cover anything. Skipping it is
      // right: this decides whether to OFFER an option, and one malformed row
      // must not take the whole picker down.
      continue;
    }
    if (candidate.start === period.start && candidate.end === period.end) {
      return snapshot;
    }
  }
  return null;
}

/**
 * How deep a `projects.sync` backfill would have to go to create a snapshot for
 * this month — or null when no backfill can.
 *
 * `projects.sync` snapshots the `months` calendar months ending with the LAST
 * COMPLETED one, so the depth is the distance from that month back to the
 * target, and the answer is null for the in-progress month (never snapshotted),
 * for anything in the future, and for anything past the 12-month ceiling the
 * mutation's own `z.number().max(12)` enforces.
 */
export function backfillMonthsToCover(
  period: ReportPeriod,
  today: string | Date
): number | null {
  if (period.kind !== "month") return null;
  const now = today instanceof Date ? today : new Date(`${String(today)}T00:00:00.000Z`);
  if (!Number.isFinite(now.getTime())) return null;

  // "Last completed month" is the month before the one `today` falls in —
  // mirroring `getLastMonthPeriod`, which subtracts one from the month index
  // regardless of the day of the month.
  const lastCompletedIndex = now.getUTCFullYear() * 12 + now.getUTCMonth() - 1;
  const [year, month] = period.months[0].split("-").map(Number);
  const targetIndex = year * 12 + (month - 1);

  const depth = lastCompletedIndex - targetIndex + 1;
  if (depth < 1) return null;
  if (depth > MAX_RECONSTRUCTION_MONTHS) return null;
  return depth;
}

/**
 * Attach a snapshot — or a reason there isn't one — to a window.
 *
 * The support gate runs FIRST. "Is this a period the product can measure at
 * all?" is a different and more fundamental question than "do we happen to hold
 * a snapshot for it", and answering the second first would tell a founder to
 * run a backfill that `projects.sync` would then refuse.
 */
export function resolvePeriodOption(
  period: ReportPeriod,
  snapshots: readonly PeriodSnapshotChoice[],
  today: string | Date
): Pick<
  PeriodOption,
  "period" | "snapshotId" | "basis" | "reconstruction" | "disabledReason"
> {
  const support = assertPeriodSupported(period, today);
  if (!support.ok) {
    return {
      period,
      snapshotId: null,
      basis: null,
      reconstruction: null,
      disabledReason: support.reason,
    };
  }

  const snapshot = snapshotCovering(period, snapshots);
  if (snapshot) {
    return {
      period,
      snapshotId: snapshot.id,
      basis: snapshot.basis,
      reconstruction: snapshot.reconstruction,
      disabledReason: null,
    };
  }

  const depth = backfillMonthsToCover(period, today);
  const backfillHint =
    depth === null
      ? "VaultBrief only snapshots whole calendar months today, so no sync can produce this window. " +
        "A report's period is its snapshot's period, and there is no honest way to relabel a month as something else."
      : `Run Sync now ▾ → “Last ${depth === 1 ? "month" : `${depth} months`}” to create it` +
        (depth > 1
          ? ", which reconstructs the balances from transfer history and labels them as estimates."
          : ".");

  return {
    period,
    snapshotId: null,
    basis: null,
    reconstruction: null,
    disabledReason: `No snapshot covers ${period.label} (${period.start} to ${period.end}). ${backfillHint}`,
  };
}

// ─── presets ───────────────────────────────────────────────────────────────

function isoDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function dayMs(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

/** Newest snapshot by period end, or null. */
function newestSnapshot(
  snapshots: readonly PeriodSnapshotChoice[]
): { snapshot: PeriodSnapshotChoice; period: ReportPeriod } | null {
  let best: { snapshot: PeriodSnapshotChoice; period: ReportPeriod } | null = null;
  for (const snapshot of snapshots) {
    let period: ReportPeriod;
    try {
      period = periodFromSnapshot(snapshot);
    } catch {
      continue;
    }
    if (!best || period.end > best.period.end) best = { snapshot, period };
  }
  return best;
}

/**
 * Build a window safely — a preset whose endpoints cross over (an award dated
 * after the newest snapshot, a "last report" that already covers everything)
 * has no window, and saying so beats throwing inside a page render.
 */
function safeRange(start: string, end: string): ReportPeriod | null {
  try {
    return periodFromRange(start, end);
  } catch {
    return null;
  }
}

function unresolvable(
  id: string,
  label: string,
  hint: string,
  disabledReason: string
): PeriodOption {
  return {
    id,
    label,
    hint,
    period: null,
    snapshotId: null,
    basis: null,
    reconstruction: null,
    disabledReason,
  };
}

/**
 * The picker's options, in the order they should be shown.
 *
 * EVERY PRESET IS ANCHORED TO THE NEWEST SNAPSHOT'S END, NOT TO `today`, and
 * that is a correctness choice rather than a convenience. A window running to
 * today has no data for its final days — the treasury has not been read since
 * the last sync — so "the last 90 days" ending today would be a window the
 * product could not measure even in principle, and would additionally
 * guarantee that no snapshot ever matches it. Ending at the newest snapshot is
 * the furthest the data actually reaches.
 *
 * `custom` is emitted last with a null period; the UI resolves the founder's
 * own dates through `resolvePeriodOption` as they are typed.
 */
export function buildPeriodOptions(input: PeriodOptionsInput): PeriodOption[] {
  const snapshots = input.snapshots ?? [];
  const awards = input.grantAwards ?? [];
  const today = input.today;
  const options: PeriodOption[] = [];

  const newest = newestSnapshot(snapshots);

  // ── 1. the latest synced period ──────────────────────────────────────────
  // The default, and the back-compat path: this is the period a report has
  // always covered when nobody chose one.
  if (!newest) {
    options.push(
      unresolvable(
        "latest",
        "Latest synced period",
        "The most recent snapshot",
        "Nothing has been synced for this project yet. Run Sync now to pull a treasury snapshot, then generate from it."
      )
    );
  } else {
    options.push({
      id: "latest",
      label: `Latest synced period — ${newest.period.label}`,
      hint: "The most recent snapshot",
      ...resolvePeriodOption(newest.period, snapshots, today),
    });
  }

  const anchorEnd = newest?.period.end ?? null;
  const anchorEndMs = anchorEnd ? dayMs(anchorEnd) : null;

  // ── 2. since each grant award ────────────────────────────────────────────
  if (awards.length === 0) {
    options.push(
      unresolvable(
        "since_grant_award",
        "Since grant award",
        "Anchored to the award's reporting start date",
        "No grant award is recorded for this project. Add one under Grants to report on a grant window."
      )
    );
  } else {
    for (const award of awards) {
      const start = award.reportingStartDate ?? award.awardDate;
      const label = `Since ${award.grantor} award`;
      const hint = `From ${start}${anchorEnd ? ` to ${anchorEnd}` : ""}`;
      if (!anchorEnd) {
        options.push(
          unresolvable(
            `since_grant_award:${award.id}`,
            label,
            hint,
            "Nothing has been synced for this project yet, so there is no end date for the grant window."
          )
        );
        continue;
      }
      const period = safeRange(start, anchorEnd);
      if (!period) {
        options.push(
          unresolvable(
            `since_grant_award:${award.id}`,
            label,
            hint,
            `The award's reporting start (${start}) is after the newest snapshot (${anchorEnd}), so there is no window to report on yet.`
          )
        );
        continue;
      }
      options.push({
        id: `since_grant_award:${award.id}`,
        label,
        hint,
        ...resolvePeriodOption(period, snapshots, today),
      });
    }
  }

  // ── 3. since the last report ─────────────────────────────────────────────
  // Starts the day AFTER the last report's period ended, so consecutive
  // reports tile the timeline instead of double-counting a day.
  const lastEndMs = input.lastReportPeriodEnd
    ? dayMs(input.lastReportPeriodEnd)
    : null;
  if (lastEndMs === null) {
    options.push(
      unresolvable(
        "since_last_report",
        "Since last report",
        "Starts the day after the previous report's period ended",
        "No report has been generated for this project yet, so there is no previous period to continue from."
      )
    );
  } else if (anchorEnd === null || anchorEndMs === null) {
    options.push(
      unresolvable(
        "since_last_report",
        "Since last report",
        "Starts the day after the previous report's period ended",
        "Nothing has been synced for this project yet."
      )
    );
  } else {
    const start = isoDay(lastEndMs + MS_PER_DAY);
    const hint = `From ${start} to ${anchorEnd}`;
    const period = safeRange(start, anchorEnd);
    options.push(
      period
        ? {
            id: "since_last_report",
            label: "Since last report",
            hint,
            ...resolvePeriodOption(period, snapshots, today),
          }
        : unresolvable(
            "since_last_report",
            "Since last report",
            hint,
            `The last report already covers everything through ${input.lastReportPeriodEnd}, which is on or after the newest snapshot (${anchorEnd}). Sync a newer period first.`
          )
    );
  }

  // ── 4. trailing windows ──────────────────────────────────────────────────
  for (const days of [30, 90]) {
    const id = `last_${days}_days`;
    const label = `Last ${days} days`;
    if (anchorEndMs === null || anchorEnd === null) {
      options.push(
        unresolvable(
          id,
          label,
          `The ${days} days ending at the newest snapshot`,
          "Nothing has been synced for this project yet."
        )
      );
      continue;
    }
    // Inclusive of both ends, so N days back is N-1 steps.
    const start = isoDay(anchorEndMs - (days - 1) * MS_PER_DAY);
    const period = safeRange(start, anchorEnd);
    const hint = `From ${start} to ${anchorEnd}`;
    options.push(
      period
        ? { id, label, hint, ...resolvePeriodOption(period, snapshots, today) }
        : unresolvable(id, label, hint, "Could not build this window.")
    );
  }

  // ── 5. custom ────────────────────────────────────────────────────────────
  options.push({
    id: "custom",
    label: "Custom period",
    hint: "Pick your own start and end dates",
    period: null,
    snapshotId: null,
    basis: null,
    reconstruction: null,
    disabledReason: null,
  });

  return options;
}
