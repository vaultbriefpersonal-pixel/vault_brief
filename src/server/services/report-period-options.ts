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
// The option is OFFERED, carrying either the sync that would create it
// (`createAction`) or the reason nothing can. Never silently snapped to a
// nearby snapshot, never generated anyway.
//
// This used to be flatly "no sync can produce that window", and that was true:
// `projects.sync` built its periods as whole calendar months walked back from
// the last completed one, so every snapshot the product could create was a
// month. It now also accepts ONE EXPLICIT WINDOW, so there are three answers
// rather than two:
//
//   • a month-shaped window → `{ kind: "months", months: N }`, the backfill
//     depth that would create it, exactly as before;
//   • any window ending at/near today → `{ kind: "period", start, end }`, a
//     single custom sync;
//   • a window ending further in the past → still nothing, and the reason says
//     so. Balances are read LIVE, and a lone custom window has no newer period
//     to walk back from, so syncing it would stamp today's holdings with a past
//     date and label them `observed`. `assertCustomSyncWindow` owns that rule,
//     in report-period.ts, so this module and `projects.sync` cannot disagree
//     about which windows are creatable.
//
// ── WHERE A PRESET'S WINDOW ENDS ──
//
// Two candidate ends, tried in order: the newest snapshot's end, then today.
//
// The first is free — if a snapshot already covers exactly that window the
// option resolves with no sync at all, which is what keeps yesterday's grant
// snapshot reachable tomorrow. The second is the only end a NEW custom sync can
// honestly produce, and it is what the label actually claims: on the 31st,
// "Last 90 days" is the 90 days ending on the 31st, not the 90 ending at the
// last monthly sync.
//
// The earlier rule was "always the newest snapshot, never today", on the ground
// that a window running to today was unmeasurable in principle. That ground is
// gone: a custom sync reads the treasury now and measures the window's
// transfers, so a window ending today is precisely the measurable one. Ending
// at a stale snapshot instead would have made every non-month preset
// permanently uncreatable — which is what greyed out "Since grant award".
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
  assertCustomSyncWindow,
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

/**
 * The `projects.sync` call that would create the snapshot this option needs.
 *
 * Two shapes because the mutation takes two: `months` walks whole calendar
 * months back from the last completed one, chaining reconstructed balances;
 * `period` is one explicit window read live. They are mutually exclusive there
 * and so are these.
 */
export type PeriodCreateAction =
  | { kind: "months"; months: number }
  | { kind: "period"; start: string; end: string };

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
  /**
   * Non-null ⇒ a report cannot be generated for this option yet, and this is
   * the visible reason.
   *
   * NOT the same as "not selectable". An option can carry a reason AND a
   * `createAction` — that is the ordinary "no snapshot yet, here is the sync
   * that makes one" case, and the founder has to be able to select it to reach
   * that button. Only `disabledReason !== null && createAction === null` is
   * dead.
   */
  disabledReason: string | null;
  /**
   * The sync that would make this option generatable, or null when nothing
   * would. Always null when `snapshotId` is set — there is nothing to create.
   */
  createAction: PeriodCreateAction | null;
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
  | "period"
  | "snapshotId"
  | "basis"
  | "reconstruction"
  | "disabledReason"
  | "createAction"
> {
  const support = assertPeriodSupported(period, today);
  if (!support.ok) {
    return {
      period,
      snapshotId: null,
      basis: null,
      reconstruction: null,
      disabledReason: support.reason,
      createAction: null,
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
      createAction: null,
    };
  }

  const missing = `No snapshot covers ${period.label} (${period.start} to ${period.end}) yet.`;

  // A month-shaped window is best created by the months backfill: it chains
  // through each month's own transfer history and is idempotent against the
  // monthly cadence, where a custom window of the same shape would collide with
  // that month's snapshot on `(project_id, snapshot_date)`. So this branch runs
  // FIRST even when a custom sync would also be legal.
  const depth = backfillMonthsToCover(period, today);
  if (depth !== null) {
    return {
      period,
      snapshotId: null,
      basis: null,
      reconstruction: null,
      disabledReason:
        `${missing} Sync “Last ${depth === 1 ? "month" : `${depth} months`}” to create it` +
        (depth > 1
          ? ", which reconstructs the older balances from transfer history and labels them as estimates."
          : "."),
      createAction: { kind: "months", months: depth },
    };
  }

  // Otherwise: can ONE custom window produce it? The rule is
  // `assertCustomSyncWindow`'s, shared with `projects.sync`, so the picker can
  // never offer a sync the mutation would refuse.
  const custom = assertCustomSyncWindow(period, today);
  if (custom.ok) {
    return {
      period,
      snapshotId: null,
      basis: null,
      reconstruction: null,
      disabledReason:
        `${missing} Sync this period to create one — VaultBrief reads the treasury now and ` +
        "measures this window's transfers, so the balances are observed rather than estimated.",
      createAction: { kind: "period", start: period.start, end: period.end },
    };
  }

  return {
    period,
    snapshotId: null,
    basis: null,
    reconstruction: null,
    disabledReason: `${missing} ${custom.reason}`,
    createAction: null,
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
    createAction: null,
  };
}

/** 'YYYY-MM-DD' for the clock, whichever form it arrived in. */
function todayIso(today: string | Date): string | null {
  if (today instanceof Date) {
    return Number.isFinite(today.getTime()) ? isoDay(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    ) : null;
  }
  const ms = typeof today === "string" ? dayMs(today) : null;
  return ms === null ? null : isoDay(ms);
}

/**
 * A preset that runs "from `start`, through the end of the data".
 *
 * TRIES EACH CANDIDATE END IN ORDER and returns the first one a snapshot
 * already covers exactly; failing that, the LAST candidate that produced a
 * valid window. Callers pass `[newestSnapshotEnd, today]`, so the meaning is:
 * prefer a window that is already measured, and otherwise name the one a sync
 * can still create — which is always the one ending today, because balances are
 * read live (`assertCustomSyncWindow`).
 *
 * `startFor` takes the end because a trailing window's start depends on it: the
 * "last 90 days" ending at the newest snapshot and the "last 90 days" ending
 * today are different windows, not the same window with a different end.
 */
function openEnded(
  id: string,
  label: string,
  startFor: (end: string) => string | null,
  ends: readonly (string | null)[],
  snapshots: readonly PeriodSnapshotChoice[],
  today: string | Date,
  noWindowReason: string
): PeriodOption {
  let fallback: PeriodOption | null = null;
  const seen = new Set<string>();
  for (const end of ends) {
    if (!end || seen.has(end)) continue;
    seen.add(end);
    const start = startFor(end);
    if (!start) continue;
    const period = safeRange(start, end);
    if (!period) continue;
    const resolved = resolvePeriodOption(period, snapshots, today);
    const option: PeriodOption = {
      id,
      label,
      hint: `From ${period.start} to ${period.end}`,
      ...resolved,
    };
    if (resolved.snapshotId) return option;
    fallback = option;
  }
  return fallback ?? unresolvable(id, label, "", noWindowReason);
}

/**
 * The picker's options, in the order they should be shown.
 *
 * EVERY OPEN-ENDED PRESET IS OFFERED AT THE NEWEST SNAPSHOT'S END FIRST AND AT
 * `today` SECOND — see this file's header for why both, and `openEnded` for the
 * mechanics. "Latest synced period" is the exception and is always the
 * snapshot's own window: it is a lookup, not a request.
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
  // The two candidate ends every open-ended preset is tried against, in
  // preference order: already-measured first, creatable second. `openEnded`
  // skips nulls and duplicates, so a project synced today collapses to one.
  const nowIso = todayIso(today);
  const ends: readonly (string | null)[] = [anchorEnd, nowIso];

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
      options.push(
        openEnded(
          `since_grant_award:${award.id}`,
          `Since ${award.grantor} award`,
          () => start,
          ends,
          snapshots,
          today,
          `The award's reporting start (${start}) is after ${
            nowIso ?? "today"
          }, so there is no window to report on yet.`
        )
      );
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
  } else {
    const start = isoDay(lastEndMs + MS_PER_DAY);
    options.push(
      openEnded(
        "since_last_report",
        "Since last report",
        () => start,
        ends,
        snapshots,
        today,
        `The last report already covers everything through ${input.lastReportPeriodEnd}, which is on or after ${
          nowIso ?? "today"
        }. There is no newer window to report on yet.`
      )
    );
  }

  // ── 4. trailing windows ──────────────────────────────────────────────────
  for (const days of [30, 90]) {
    options.push(
      openEnded(
        `last_${days}_days`,
        `Last ${days} days`,
        // The start moves with the end — "the 90 days ending at the newest
        // snapshot" and "the 90 days ending today" are different windows.
        // Inclusive of both ends, so N days back is N-1 steps.
        (end) => {
          const endMs = dayMs(end);
          return endMs === null ? null : isoDay(endMs - (days - 1) * MS_PER_DAY);
        },
        ends,
        snapshots,
        today,
        "Could not build this window."
      )
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
    createAction: null,
  });

  return options;
}
