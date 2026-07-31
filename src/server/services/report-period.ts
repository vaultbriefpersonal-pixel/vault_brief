// The reporting period, as a value.
//
// VaultBrief was born monthly. `ReportSectionContext.period` is a bare
// 'YYYY-MM' string, every manual-entry table tags its rows with one, and the
// whole report reads as "the month ending on the snapshot date". That works
// exactly as long as every report IS a month. It stops working the moment a
// team has to report "since we received the grant, through today" — a window
// that starts on the 14th, spans six months, and has no single 'YYYY-MM' that
// names it.
//
// This module is that window made explicit. It answers the four questions the
// report generator keeps asking of a period and currently answers by string
// surgery: which months does it touch (for month-tagged manual rows), which
// real dates does it contain (for rows with actual `date` columns), how many
// months long is it (for anything normalised per month), and — the one nobody
// asked before — is it a period this product can honestly measure at all.
//
// The load-bearing judgement here is that a CALENDAR MONTH IS EXACTLY ONE
// MONTH. Not 31/30.4375 months, not 28/30.4375. Every helper that divides by a
// month length short-circuits on `kind === "month"` and returns the figure a
// monthly report already prints. Normalisation is a thing custom periods need;
// applying it to the monthly path would silently restate numbers in reports
// that have already been sent to investors. See `monthsInPeriod`.
//
// Deliberately dependency-free: no `@/server/db`, no `openai`, no `node:*`,
// no `process.env`, no drizzle, no date library. Zero imports, by design.
// report-sections.ts will import this and reaches the browser through
// ReportTemplateEditor.tsx ("use client"), so a server-only import here breaks
// the client bundle — the same constraint burn-metrics.ts documents.
//
// ALL ARITHMETIC IS UTC. `date` columns arrive as 'YYYY-MM-DD' and parse as
// UTC midnight, so `Date.UTC` to construct and `getUTC*` to read is the only
// combination that survives a generator running in a non-UTC timezone. The
// local-vs-UTC mix is not hypothetical in this codebase: report-generator.ts
// builds month boundaries with `new Date(y, m, 1)` (local) and then calls
// `.toISOString()` (UTC), which lands `periodStart` in the previous month for
// anyone east of Greenwich. Mirror `gapInDays` (report-sections.ts:116-124)
// instead.

/**
 * A reporting window. Every field is derived — construct through
 * `periodFromRange`, `periodOfMonth` or `periodFromSnapshot` rather than by
 * hand, so the invariants below actually hold.
 */
export interface ReportPeriod {
  /** Inclusive start, 'YYYY-MM-DD'. */
  start: string;
  /** Inclusive end, 'YYYY-MM-DD'. */
  end: string;
  /** Whole days the period covers, inclusive of both ends. Always >= 1. */
  days: number;
  /** Every 'YYYY-MM' the range touches, ascending. Never empty. */
  months: readonly string[];
  /** "month" iff start is the 1st and end is the last day OF THE SAME month. */
  kind: "month" | "custom";
  /** 'YYYY-MM' when kind==="month", else '2026-02-14..2026-07-31'. */
  tag: string;
  /** Human label: 'April 2026' | '14 Feb – 31 Jul 2026'. */
  label: string;
  /**
   * start is a 1st AND end is a month-end — so the period is made of whole
   * calendar months, but possibly several of them.
   *
   * Deliberately NOT the same as `kind === "month"`. A full quarter
   * (Feb 1 → Apr 30) is month-aligned and is not a month. The distinction is
   * what decides whether a report has to disclose that month-tagged manual
   * entries may include items dated outside the period: when the period stops
   * on month boundaries, "the whole of February" and "February 1st to 28th"
   * are the same set, and there is nothing to disclose.
   */
  monthAligned: boolean;
}

/**
 * Structural subset of `TreasurySnapshot`. Declared locally rather than
 * imported so this module stays free of schema (and therefore drizzle)
 * imports; `date` columns arrive as strings, hence the unions.
 */
export interface SnapshotPeriodLike {
  snapshotDate: string | Date;
  /** Added in a later phase; absent/null on every snapshot written before it. */
  periodStart?: string | Date | null;
}

/**
 * Average days in a Gregorian month: 365.25 / 12.
 *
 * Exported so `burn-metrics.ts` can normalise a stored period length against
 * the SAME constant this module divides by. Two copies of 30.4375 in two files
 * is one edit away from two different definitions of "a month", and the two
 * would disagree silently — the trailing average and the current period's
 * runway would be denominated differently in the same report.
 */
export const DAYS_PER_MONTH = 30.4375;

const MS_PER_DAY = 86_400_000;

/** Long-form month names for a whole-month label ('April 2026'). */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Short forms for a range label ('14 Feb – 31 Jul 2026'). */
const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * How far in the past `period.end` may sit before a period is refused.
 * Two days covers timezone slop (a UTC-dated period read from a UTC+13 clock)
 * plus the legitimate "through yesterday" case. See `assertPeriodSupported`.
 */
const END_TOLERANCE_DAYS = 2;

// ─── parsing ───────────────────────────────────────────────────────────────

/**
 * A date value reduced to the UTC midnight that begins its day, in epoch ms —
 * or null if it isn't a date at all.
 *
 * Strings must lead with a strict, zero-padded 'YYYY-MM-DD'; a trailing time
 * component is accepted and discarded, so both a `date` column ('2026-04-30')
 * and a serialised timestamp ('2026-04-30T00:00:00.000Z') read the same. The
 * strictness is deliberate: `new Date('2026-4-30')` succeeds in V8 and the
 * looseness is exactly how a malformed value gets silently absorbed into a
 * report instead of being rejected at the door.
 *
 * `Date` inputs are read through `getUTC*`, matching how the rest of this
 * module treats a day — a Date built from a local-timezone constructor may
 * therefore land on the neighbouring day, which is the correct reading of a
 * value that was never anchored to a UTC day in the first place.
 */
function utcDayMs(value: string | Date | null | undefined): number | null {
  if (value instanceof Date) {
    const t = value.getTime();
    if (!Number.isFinite(t)) return null;
    return Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate()
    );
  }
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // Round-trip rejects both out-of-range components and calendar overflow:
  // Date.UTC silently rolls '2026-02-30' forward to March 2nd, and a
  // two-digit-looking year like '0026' to 1926. Neither is a date the caller
  // meant, and both would produce a plausible-looking wrong period.
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** UTC epoch ms → 'YYYY-MM-DD'. */
function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** UTC epoch ms → 'YYYY-MM'. */
function isoMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

// ─── construction ──────────────────────────────────────────────────────────

/**
 * The primary constructor. Derives every field of `ReportPeriod` from an
 * inclusive date range.
 *
 * THROWS on unparseable input or `end < start`, and this asymmetry against the
 * predicates below is intentional. A constructor handed garbage is a caller
 * bug — there is no period to return and inventing one would put fabricated
 * dates on a document sent to an investor or a grantor. The predicates
 * (`matchesPeriod`, `dateInPeriod`) do the opposite and return false, because
 * they run per-row inside report generation where one malformed value must not
 * cost the whole report; that is the established convention here, stated as
 * "Never throws" in major-transactions.ts and report-evidence.ts.
 */
export function periodFromRange(
  start: string | Date,
  end: string | Date
): ReportPeriod {
  const startMs = utcDayMs(start);
  const endMs = utcDayMs(end);
  if (startMs === null) {
    throw new Error(
      `report-period: unparseable period start ${JSON.stringify(start)} — expected 'YYYY-MM-DD' or a Date`
    );
  }
  if (endMs === null) {
    throw new Error(
      `report-period: unparseable period end ${JSON.stringify(end)} — expected 'YYYY-MM-DD' or a Date`
    );
  }
  if (endMs < startMs) {
    throw new Error(
      `report-period: period end ${isoDay(endMs)} precedes start ${isoDay(startMs)}`
    );
  }

  const startIso = isoDay(startMs);
  const endIso = isoDay(endMs);
  // Both operands are exact UTC midnights, so this division is exact and no
  // DST transition can shave or add an hour. +1 because both ends are
  // inclusive: a single-day period is one day, not zero.
  const days = (endMs - startMs) / MS_PER_DAY + 1;

  const months = enumerateMonths(startMs, endMs);

  const startsMonth = new Date(startMs).getUTCDate() === 1;
  // "Last day of its month" without a days-in-month table: tomorrow is a 1st.
  // Leap years and February fall out for free.
  const endsMonth = new Date(endMs + MS_PER_DAY).getUTCDate() === 1;
  const monthAligned = startsMonth && endsMonth;
  const kind: "month" | "custom" =
    monthAligned && months.length === 1 ? "month" : "custom";

  return {
    start: startIso,
    end: endIso,
    days,
    months,
    kind,
    tag: kind === "month" ? months[0] : `${startIso}..${endIso}`,
    label: buildLabel(startMs, endMs, kind),
    monthAligned,
  };
}

/**
 * Convenience for a whole calendar month: '2026-04' → April 1st–30th 2026.
 * Always yields `kind: "month"`, which is what keeps every per-month
 * short-circuit in this module on the identity path for the existing product.
 *
 * Throws on anything that is not a zero-padded 'YYYY-MM' with a real month —
 * same constructor discipline as `periodFromRange`.
 */
export function periodOfMonth(yyyyMm: string): ReportPeriod {
  const m = typeof yyyyMm === "string" ? /^(\d{4})-(\d{2})$/.exec(yyyyMm.trim()) : null;
  if (!m) {
    throw new Error(
      `report-period: expected a 'YYYY-MM' month, got ${JSON.stringify(yyyyMm)}`
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) {
    throw new Error(`report-period: month out of range in ${JSON.stringify(yyyyMm)}`);
  }
  const first = Date.UTC(year, month - 1, 1);
  // Day 0 of the following month is the last day of this one — 29 in a leap
  // February, 28 otherwise, with no table to get wrong.
  const last = Date.UTC(year, month, 0);
  return periodFromRange(isoDay(first), isoDay(last));
}

/**
 * The back-compat reader: the period a stored snapshot describes.
 *
 * `end` is always `snapshotDate`. `start` is `periodStart` when the column
 * holds a value, and otherwise the first day of `snapshotDate`'s month.
 *
 * THE NULL FALLBACK IS NOT A GUESS. `period_start` does not exist yet; it
 * arrives in a later migration, so every snapshot written to date has no value
 * to read. But every write path that has ever existed produced exactly a
 * calendar month: `getLastMonthPeriod` (data-sync.ts:11-16) returns the 1st to
 * the last day of the previous month, and the backfill loop
 * (trpc/routers/projects.ts:584-587) walks that same shape backwards. The
 * fallback therefore RECONSTRUCTS the true period of those rows rather than
 * inventing a plausible one, and a snapshot read before the migration and the
 * same snapshot read after it yield an identical `ReportPeriod`.
 *
 * That equivalence is the whole point: it lets the period-aware code ship and
 * behave correctly before the column exists, instead of blocking every phase
 * behind a migration.
 */
export function periodFromSnapshot(snapshot: SnapshotPeriodLike): ReportPeriod {
  const endMs = utcDayMs(snapshot?.snapshotDate);
  if (endMs === null) {
    throw new Error(
      `report-period: snapshot has unparseable snapshotDate ${JSON.stringify(
        snapshot?.snapshotDate
      )}`
    );
  }
  const end = new Date(endMs);
  const explicitStart =
    snapshot.periodStart === null || snapshot.periodStart === undefined
      ? null
      : utcDayMs(snapshot.periodStart);
  const startMs =
    explicitStart ?? Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);
  return periodFromRange(isoDay(startMs), isoDay(endMs));
}

/**
 * The value to store in `treasury_snapshots.period_start` for a sync, derived
 * so the stored pair `(period_start, snapshot_date)` reads back as the window
 * that was actually measured.
 *
 * THIS IS NOT `range.start.toISOString().split("T")[0]`, and the difference is
 * the whole reason this function exists rather than being one inline
 * expression at the call site.
 *
 * `snapshot_date` is `range.end.toISOString().split("T")[0]` — a LOCAL Date
 * (see `monthsInDateRange`) projected onto a UTC day. Applying the same
 * projection to `range.start` is "the same conversion", but it does not give
 * the same window: at UTC+2, June's local period converts to
 * `2026-05-31 … 2026-06-30`, which is 31 days and `kind: "custom"`. Storing
 * that would switch per-month normalisation ON for an ordinary monthly sync in
 * every timezone east of Greenwich and restate its burn by 1.8% — the exact
 * regression the calendar-month exemption exists to prevent.
 *
 * So: when the range IS a calendar month (decided on the local components it
 * was built from, by `monthsInDateRange`), the start is derived FROM
 * `snapshot_date` itself — the first day of its month. That is the strongest
 * form of "consistent with `snapshotDate`" available: the stored pair is then
 * bit-for-bit the pair `periodFromSnapshot` already reconstructs from a NULL
 * column, in every timezone. Writing the column can therefore never change
 * what an existing monthly report says.
 *
 * The pre-existing local-vs-UTC skew in `snapshot_date` is deliberately NOT
 * fixed here — at UTC-5 a June period still stores `snapshot_date` of July 1st,
 * and this function faithfully reproduces the same period the NULL fallback
 * already yields for it. Correcting that would change `snapshot_date` for
 * existing users and belongs to its own task.
 *
 * For a range that is not a calendar month, there is no month to defer to and
 * the UTC projection of `range.start` is the best available answer.
 *
 * Throws only if `snapshotDate` is unparseable, which is unreachable from the
 * sync path: the caller derives it from `range.end.toISOString()`, and that
 * throws first on an invalid Date.
 */
export function snapshotPeriodStart(
  range: { start: Date; end: Date },
  snapshotDate: string | Date
): string {
  const endMs = utcDayMs(snapshotDate);
  if (endMs === null) {
    throw new Error(
      `report-period: unparseable snapshotDate ${JSON.stringify(
        snapshotDate
      )} — cannot derive period_start`
    );
  }
  const end = new Date(endMs);
  const firstOfEndMonth = isoDay(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)
  );
  if (monthsInDateRange(range) === 1) return firstOfEndMonth;

  const startMs = utcDayMs(range?.start);
  // A start that will not parse, or that lands after the end, would build an
  // impossible period. Degrading to the calendar month reproduces the NULL
  // fallback, which is the meaning every row in the table already carries.
  if (startMs === null || startMs > endMs) return firstOfEndMonth;
  return isoDay(startMs);
}

export type SnapshotPeriodCheck =
  | { ok: true }
  | {
      ok: false;
      snapshotDate: string;
      existingStart: string;
      incomingStart: string;
      reason: string;
    };

/**
 * Would writing `incoming` over `existing` silently change the window an
 * already-stored snapshot describes?
 *
 * `treasury_snapshots` is unique on `(project_id, snapshot_date)` and
 * data-sync.ts upserts against that index. Two reporting periods that END on
 * the same day — a monthly snapshot and a grant window both dated today —
 * therefore collide, and the second overwrites the first. That is not a lost
 * row: any report whose `snapshot_id` points at it now references flows for a
 * DIFFERENT window, which the report page widgets, the PDF charts and the
 * email KPI block all read and none of them can detect.
 *
 * The database cannot catch this yet: widening the unique key would invalidate
 * the deployed `ON CONFLICT` target the instant the DDL landed, so it is a
 * separate three-step migration. Until then this predicate is the guard, and
 * it lives here — pure, import-free, unit-tested — because data-sync.ts
 * imports `db` and nothing in it can be tested at all. Same reasoning that put
 * the sampling rule in transaction-sample.ts.
 *
 * A NULL stored `period_start` DOES NOT WAIVE THE CHECK. It is resolved
 * through `periodFromSnapshot` to the calendar month ending on its
 * `snapshot_date` — which is what that NULL means, not a hole in the data —
 * and compared on that. Waiving it instead would let the single most likely
 * instance of the bug straight through: today every row in the table is
 * pre-backfill, so a grant window landing on a pre-existing monthly snapshot's
 * date is exactly the collision the guard was written for.
 *
 * Re-syncing the SAME period is not a conflict and must keep upserting — that
 * is the existing, desirable behaviour (see data-sync.ts's note that re-syncs
 * have to overwrite derived fields, or expense breakdowns get stuck on the
 * first sync of the day).
 *
 * NEVER THROWS, and fails OPEN on anything unparseable: this gates a write
 * that is otherwise fine, and refusing a whole sync over a value that failed a
 * regex is the worse error. Both inputs come from `date` columns in practice.
 * A missing `existing` (no row at that date yet) is likewise `ok`.
 */
export function snapshotPeriodConflicts(
  existing: SnapshotPeriodLike | null | undefined,
  incoming: SnapshotPeriodLike
): SnapshotPeriodCheck {
  if (!existing || !incoming) return { ok: true };
  let existingPeriod: ReportPeriod;
  let incomingPeriod: ReportPeriod;
  try {
    existingPeriod = periodFromSnapshot(existing);
    incomingPeriod = periodFromSnapshot(incoming);
  } catch {
    return { ok: true };
  }
  // Different end dates are different rows — the upsert will not collide, so
  // there is nothing here to overwrite.
  if (existingPeriod.end !== incomingPeriod.end) return { ok: true };
  if (existingPeriod.start === incomingPeriod.start) return { ok: true };
  return {
    ok: false,
    snapshotDate: existingPeriod.end,
    existingStart: existingPeriod.start,
    incomingStart: incomingPeriod.start,
    reason:
      `A snapshot dated ${existingPeriod.end} already exists for a different ` +
      `reporting period (${existingPeriod.label}, starting ${existingPeriod.start}). ` +
      `This sync covers ${incomingPeriod.label}, starting ${incomingPeriod.start}. ` +
      "Overwriting it would silently change the data under an existing report, " +
      "which would keep pointing at this snapshot while describing a different window.",
  };
}

// ─── membership ────────────────────────────────────────────────────────────

/**
 * Does a manually-entered row tagged 'YYYY-MM' belong to this period?
 *
 * SET MEMBERSHIP AGAINST `period.months`, not a `>=`/`<=` comparison on the
 * string. For well-formed, zero-padded values the two are equivalent — TEXT
 * 'YYYY-MM' is fixed-width, so lexicographic order is chronological order. The
 * difference is what happens to a malformed one. A full date typed into a
 * month field sorts cleanly inside a range — '2026-04-15' is both >= '2026-02'
 * and <= '2026-07' — so a range check admits it and narrates a row from an
 * unknown period; so does a stray trailing space. Neither matches any member
 * of `months`. A row that quietly vanishes is a far better failure than a row
 * that quietly appears, and the equivalence for well-formed values means this
 * choice costs nothing.
 *
 * Null, undefined and empty tags are false: an untagged row belongs to no
 * period. Never throws — this runs once per manual row during generation.
 */
export function matchesPeriod(
  rowPeriod: string | null | undefined,
  period: ReportPeriod
): boolean {
  if (typeof rowPeriod !== "string") return false;
  const tag = rowPeriod.trim();
  if (!tag) return false;
  return period.months.includes(tag);
}

/**
 * Does a real date fall inside this period? Inclusive at both ends.
 *
 * For data that carries an actual `date` column — `milestones.completedDate`
 * is the motivating case — rather than a month tag. Strictly better than
 * `matchesPeriod` where it applies, because it needs no boundary-month
 * disclosure: the answer is exact.
 *
 * Unparseable, null and undefined are false. Never throws, same reason as
 * `matchesPeriod`.
 */
export function dateInPeriod(
  date: string | Date | null | undefined,
  period: ReportPeriod
): boolean {
  const ms = utcDayMs(date);
  if (ms === null) return false;
  const startMs = utcDayMs(period?.start);
  const endMs = utcDayMs(period?.end);
  if (startMs === null || endMs === null) return false;
  return ms >= startMs && ms <= endMs;
}

// ─── normalisation ─────────────────────────────────────────────────────────

/**
 * The period's length in months, for anything expressed per month — burn rate,
 * runway, a monthly average.
 *
 * RETURNS EXACTLY 1 FOR A CALENDAR MONTH, and that short-circuit is
 * load-bearing rather than an optimisation. A calendar month IS one month by
 * definition; dividing a 31-day January by 30.4375 would make it 1.0185 months
 * and shift its burn rate down by 1.8%. Every monthly report this product has
 * already published would restate on regeneration, with no cause a reader
 * could see. Normalisation exists so a 181-day grant window does not report a
 * six-month runway as a one-month one — it must only ever bite on custom
 * periods.
 *
 * Custom periods use 365.25/12 rather than 30 or 31, so a quarter is 3.0
 * months and a year 12.0 rather than accumulating a drift the report would
 * then narrate as a trend.
 */
export function monthsInPeriod(period: ReportPeriod): number {
  if (period.kind === "month") return 1;
  return period.days / DAYS_PER_MONTH;
}

/**
 * `monthsInPeriod` for the sync path, which never sees a `ReportPeriod`.
 *
 * `fetchAndClassify` (transaction-sync.ts) is handed `{ start: Date; end: Date }`
 * and has to divide this period's outflow total by its length in months before
 * it can store a figure called `runway_months`. It lives here, beside
 * `monthsInPeriod`, so the two normalisation paths share the constant and the
 * calendar-month exemption instead of drifting; a copy in transaction-sync.ts
 * would be the second definition of "a month" in the codebase and nothing
 * would fail when they disagreed.
 *
 * THE ONLY FUNCTION IN THIS MODULE THAT READS LOCAL DATE FIELDS, and
 * deliberately so — everything else here is UTC because it parses 'YYYY-MM-DD'
 * `date` columns. These Dates are not that. Both construction sites build them
 * with LOCAL constructors:
 *
 *     new Date(now.getFullYear(), now.getMonth() - 1, 1)            // data-sync.ts:13
 *     new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)    // data-sync.ts:14
 *
 * so for a generator at UTC+2, `start` is local midnight on the 1st, which is
 * 21:00 UTC on the LAST DAY OF THE PREVIOUS MONTH. Read through `getUTC*` — or
 * round-tripped through `.toISOString().split("T")[0]` and handed to
 * `periodFromRange` — a genuine calendar month would come back as a
 * non-aligned custom range, switching normalisation on for every monthly sync
 * in that timezone. Reading the same fields the values were constructed from
 * is the only way to recover the month the caller meant.
 *
 * Returns EXACTLY 1 for a calendar month, for the reason `monthsInPeriod`
 * spells out at length: every snapshot this product has written is a calendar
 * month, and normalisation must be the identity for all of them.
 *
 * Returns 1 rather than throwing on unusable input. This runs inside a sync
 * that is about to persist `runway_months`, and the two alternatives are both
 * worse: throwing loses the whole snapshot over a divisor, and propagating NaN
 * writes NaN into a numeric column the dashboard renders. 1 degrades to the
 * arithmetic this line used before normalisation existed, which is a known
 * quantity.
 */
export function monthsInDateRange(range: {
  start: Date;
  end: Date;
}): number {
  const start = range?.start;
  const end = range?.end;
  if (!(start instanceof Date) || !(end instanceof Date)) return 1;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return 1;
  }

  const sameMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth();
  // Day 0 of the following month is the last day of this one — no days-in-month
  // table, and February and leap years fall out for free.
  const lastDayOfEndMonth = new Date(
    end.getFullYear(),
    end.getMonth() + 1,
    0
  ).getDate();
  if (
    sameMonth &&
    start.getDate() === 1 &&
    end.getDate() === lastDayOfEndMonth
  ) {
    return 1;
  }

  // Whole calendar days, inclusive of both ends. The local Y/M/D components are
  // re-anchored as UTC midnights before subtracting, rather than subtracting
  // the raw timestamps, because `end` carries a TIME (23:59:59 at both
  // construction sites): `Math.round((end - start) / MS_PER_DAY) + 1` on the
  // raw values counts 30-day June as 31 days. Re-anchoring also makes a DST
  // transition inside the range irrelevant, since neither endpoint keeps an
  // offset.
  const startDay = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate()
  );
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  const days = (endDay - startDay) / MS_PER_DAY + 1;
  if (!(days >= 1)) return 1;
  return days / DAYS_PER_MONTH;
}

/**
 * The gap beyond which balance-derived flow and the period's transaction
 * totals cover visibly different windows, so cross-comparing them has to be
 * disclosed. Generalises the fixed `LONG_GAP_DAYS = 45` in report-sections.ts,
 * whose 45 clears a normal monthly cadence plus a late sync.
 *
 * `max(45, round(days * 1.5))` keeps that floor for short periods and scales
 * it for long ones — a 181-day period whose previous snapshot is 60 days stale
 * is not a coverage problem worth a paragraph, but the same 60 days against a
 * 30-day period is.
 *
 * RETURNS EXACTLY 45 FOR A CALENDAR MONTH, for the same load-bearing reason
 * `monthsInPeriod` returns exactly 1: the formula alone does NOT preserve the
 * existing constant. 28, 29 and 30-day months land on 45 via the floor, but a
 * 31-day month computes 47 (31 * 1.5 = 46.5, rounded up) — so seven months of
 * the year would silently widen the threshold by two days and suppress a
 * long-gap disclosure that ships today. Replacing a constant must not change
 * what already-published monthly reports say; scaling may only bite on custom
 * periods.
 */
export function longGapDaysFor(period: ReportPeriod): number {
  if (period.kind === "month") return 45;
  return Math.max(45, Math.round(period.days * 1.5));
}

/**
 * May period `b` be averaged together with period `a`?
 *
 * Guards trailing averages. A trailing burn average built from three 30-day
 * months is meaningful; the same average with a 181-day grant window mixed in
 * is a number with no denominator, and it would flow straight into runway and
 * month-over-month without a single line of output saying so.
 *
 * DELIBERATELY ASYMMETRIC: the tolerance scales off `a`, which is THE CURRENT
 * PERIOD, with `b` the candidate being admitted to its average. "Is this
 * candidate close enough to what I am measuring" is the question being asked,
 * so the thing being measured sets the scale. `comparablePeriods(a, b)` and
 * `comparablePeriods(b, a)` can disagree, and callers must pass the current
 * period first.
 *
 * The 7-day floor is what makes any two calendar months comparable — February
 * against January is a 3-day difference against a tolerance of 7.
 */
export function comparablePeriods(a: ReportPeriod, b: ReportPeriod): boolean {
  return Math.abs(a.days - b.days) <= Math.max(7, 0.25 * a.days);
}

/**
 * The prior snapshots that may legitimately be averaged with, and compared
 * against, the current period — most-recent-first, capped at `limit`.
 *
 * The generator used to take `ORDER BY snapshot_date DESC LIMIT 3` and hand
 * the result straight to `trailingAverageBurn`, month-over-month and anomaly
 * detection. That is correct exactly as long as every snapshot is a month. Put
 * one 181-day grant window in the same table and the query happily returns it
 * as the "previous month", producing a burn trend, a delta and an anomaly
 * baseline built from windows six times apart — the same class of error
 * burn-metrics.ts exists to prevent, arriving through a different door.
 *
 * The caller therefore OVER-FETCHES (a wide `LIMIT`, ordered by date) and
 * filters here, rather than filtering in SQL: comparability is a property of
 * the period, and the period of a pre-migration row is not in the row at all —
 * it is reconstructed by `periodFromSnapshot`. Doing it in JS is what makes
 * this behave identically before and after the backfill.
 *
 * FOR MONTHLY SNAPSHOTS THIS IS THE IDENTITY. Any two calendar months are
 * comparable (28 vs 31 days is 3, against a floor of 7), so the first three
 * candidates survive and today's behaviour is unchanged. For a project's first
 * grant-window report the result is empty, which cleanly gates off
 * month-over-month, the forecast and anomalies — correct, not a loss.
 *
 * Candidates whose date will not parse are skipped rather than thrown on: this
 * runs inside report generation, where one malformed row must not cost the
 * whole report.
 */
export function comparableTrailing<T extends SnapshotPeriodLike>(
  current: ReportPeriod,
  candidates: readonly T[] | null | undefined,
  limit = 3
): T[] {
  if (!Array.isArray(candidates) || limit <= 0) return [];
  const out: T[] = [];
  for (const candidate of candidates) {
    if (out.length >= limit) break;
    let period: ReportPeriod;
    try {
      period = periodFromSnapshot(candidate);
    } catch {
      continue;
    }
    if (comparablePeriods(current, period)) out.push(candidate);
  }
  return out;
}

/**
 * `BurnSnapshotLike.periodDays` for a stored snapshot — or `undefined`, which
 * that field defines as "exactly one month".
 *
 * UNDEFINED FOR A CALENDAR MONTH, and that is the entire point of routing
 * through here instead of computing `snapshot_date − period_start` at the call
 * site. A raw day count cannot express the calendar-month exemption: 31 is
 * both a January and an arbitrary 31-day window, and burn-metrics.ts cannot
 * tell them apart. Passing `periodDays: 31` for a January would divide its
 * burn by 1.0185 and restate every already-published 31-day report by 1.8%.
 * This is `monthsInPeriod`'s short-circuit expressed in the units that field
 * takes.
 *
 * Undefined too for anything unparseable — a row with no usable date falls
 * back to the pre-existing arithmetic rather than poisoning an average.
 */
export function burnPeriodDays(
  snapshot: SnapshotPeriodLike | null | undefined
): number | undefined {
  if (!snapshot) return undefined;
  let period: ReportPeriod;
  try {
    period = periodFromSnapshot(snapshot);
  } catch {
    return undefined;
  }
  return period.kind === "month" ? undefined : period.days;
}

// ─── support gate ──────────────────────────────────────────────────────────

export type PeriodSupport =
  | { ok: true }
  | { ok: false; code: "PAST_PERIOD_UNSUPPORTED"; reason: string };

/**
 * Can this product honestly measure the given period?
 *
 * The refusal exists because `fetchAllBalances` (data-sync.ts:33) takes no
 * period argument — wallet balances are read live from chain, as of now, and
 * there is no code path that reconstructs them for a past date. A report for a
 * period ending nine months ago would therefore carry TODAY's balances printed
 * under that date, and nothing in the output would disclose it. That is the
 * same failure mode that keeps the backfill options disabled in
 * SyncNowButton.tsx:12-53 — read that comment block, it is the canonical
 * statement of this problem and this function is the server-side half of it.
 *
 * RETURNS A RESULT, NEVER THROWS. The caller decides what a refusal is: a
 * tRPC mutation turns it into a TRPCError, a UI turns it into a disabled
 * option with a visible reason. Baking a throw in here would force the second
 * caller to catch an exception to render a tooltip.
 *
 * Only PAST ends beyond tolerance are refused. A period ending in the future
 * is allowed through: it is a different problem (a window that has not
 * finished yet), nothing in the product can currently produce one, and
 * refusing it here would mean this function silently owns a rule it was not
 * written to express. `today` itself must be parseable — unlike the row-level
 * predicates, this is an authorisation gate, and failing open on a garbage
 * clock is not an option.
 */
export function assertPeriodSupported(
  period: ReportPeriod,
  today: string | Date
): PeriodSupport {
  const todayMs = utcDayMs(today);
  if (todayMs === null) {
    throw new Error(
      `report-period: unparseable 'today' ${JSON.stringify(today)} — cannot decide period support`
    );
  }
  const endMs = utcDayMs(period?.end);
  if (endMs === null) {
    throw new Error(
      `report-period: period has unparseable end ${JSON.stringify(period?.end)}`
    );
  }
  const daysStale = (todayMs - endMs) / MS_PER_DAY;
  if (daysStale <= END_TOLERANCE_DAYS) return { ok: true };
  return {
    ok: false,
    code: "PAST_PERIOD_UNSUPPORTED",
    reason:
      "VaultBrief can only measure a reporting period that ends today. " +
      "Wallet balances are read live from chain and cannot be reconstructed " +
      `for a past date — a report for a period ending ${period.end} would ` +
      "carry today's balances under that date, and nothing in the output " +
      "would say so. Historical reconstruction is planned.",
  };
}

// ─── internals ─────────────────────────────────────────────────────────────

/**
 * Every 'YYYY-MM' between two UTC days, ascending and inclusive.
 *
 * Walks by month index rather than by adding 30 days, so year boundaries and
 * short months are structural rather than something to remember: month 12 of
 * 2025 becomes month 0 of 2026 through the same increment as any other.
 */
function enumerateMonths(startMs: number, endMs: number): readonly string[] {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const endIndex = end.getUTCFullYear() * 12 + end.getUTCMonth();
  const out: string[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (year * 12 + month <= endIndex) {
    out.push(isoMonth(Date.UTC(year, month, 1)));
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return out;
}

/**
 * The human label. Hand-rolled rather than delegating to `formatDate` in
 * @/lib/utils: that helper is `toLocaleDateString`, which reads a UTC-midnight
 * date in the LOCAL timezone, so '2026-04-01' renders as "March 2026" for any
 * generator west of Greenwich — precisely the bug this module's UTC discipline
 * exists to avoid. (It also lives behind clsx/tailwind-merge imports, so
 * reusing it would end this module's zero-dependency status for a string.)
 *
 * Forms: 'April 2026' for a whole month; '14 Feb 2026' for a single day, where
 * a range would read as a formatting mistake; '14 Feb – 31 Jul 2026' within a
 * year and '15 Dec 2025 – 10 Feb 2026' across one. En-dash throughout.
 */
function buildLabel(
  startMs: number,
  endMs: number,
  kind: "month" | "custom"
): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  if (kind === "month") {
    return `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  }
  const endLabel = `${end.getUTCDate()} ${MONTH_ABBR[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  if (startMs === endMs) return endLabel;
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = sameYear
    ? `${start.getUTCDate()} ${MONTH_ABBR[start.getUTCMonth()]}`
    : `${start.getUTCDate()} ${MONTH_ABBR[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  return `${startLabel} – ${endLabel}`;
}
