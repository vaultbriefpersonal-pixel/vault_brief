// Burn figures that survive a quiet month.
//
// A single period's burn is a noisy denominator. Divide a treasury by one
// month in which little happened to leave the multisig and the report claims a
// runway of decades; divide it by a month that happened to contain an annual
// audit invoice and the same treasury looks weeks from death. Neither figure
// describes the business. Every function here exists to put a stabler number
// under the runway line, and to say out loud how thin the sample behind it is.
//
// The zero-burn rule is the load-bearing judgement: a month recording no
// operating outflows is missing data, not a month the project ran for free.
// The real causes are a sync that did not complete, a period whose only
// outflows were token_sale rebalances (booked as treasury operations, not
// opex), or payroll landing a day either side of a period boundary. Averaging
// those zeros in halves the burn and doubles the runway — the exact direction
// of error an investor report must never make.
//
// Deliberately dependency-free: no `@/server/db`, no `openai`, no `node:*`,
// no `process.env`. report-sections.ts imports this and reaches the browser
// through ReportTemplateEditor.tsx ("use client"), so a server-only import
// here breaks the client bundle.
//
// NOT a generalisation of anomalies.ts. `compareMetric` there takes a mean
// over an arbitrary baseline window of an arbitrary metric and keeps the
// zeros, because for anomaly detection a zero IS the signal. Same arithmetic,
// opposite contract. Merging them would be false DRY: one call site would have
// to pass a flag that inverts the other's core assumption.

// The one import, and it carries a constant rather than behaviour:
// report-period.ts is itself dependency-free and browser-safe, so this does not
// widen the bundle. `DAYS_PER_MONTH` is imported rather than re-declared so
// there is exactly one definition of "a month" in the codebase — two copies
// would let the trailing average and the current period's runway end up
// denominated differently inside the same report, with nothing failing.
import { DAYS_PER_MONTH } from "./report-period";

/**
 * Structural subset of `TreasurySnapshot`. Declared locally rather than
 * imported so this module stays free of schema (and therefore drizzle)
 * imports; `numeric` columns arrive as strings, hence the union.
 */
export interface BurnSnapshotLike {
  burnRateUsd?: string | number | null;
  /**
   * How many days the row's `burnRateUsd` covers — supplied ONLY when the row's
   * period is not a calendar month. Omit it (or pass null) for a calendar
   * month.
   *
   * `burnRateUsd` is a stored PERIOD TOTAL, not a rate. Averaging a 181-day
   * grant window's total together with three one-month totals produces a
   * number with no denominator at all, and it flows straight into runway,
   * stablecoin cover and the burn trend with nothing in the output saying so.
   * This field is what lets each row be reduced to a monthly figure before the
   * mean is taken.
   *
   * ABSENT MEANS ONE MONTH, exactly — the normaliser is 1 and the arithmetic is
   * bit-for-bit what it was before this field existed. That is not a
   * convenience default: the column that would carry a period length does not
   * exist yet, so every row in the database and every row written today comes
   * through here absent, and behaviour must be unchanged until it does.
   *
   * THE CALENDAR-MONTH EXEMPTION IS THE CALLER'S TO APPLY, because a day count
   * alone cannot express it: 31 days is a January and is also an arbitrary
   * 31-day window, and this module cannot tell them apart. A calendar month is
   * exactly one month by this codebase's definition (see `monthsInPeriod` in
   * report-period.ts) — passing `periodDays: 31` for a January would divide its
   * burn by 1.0185 and restate every already-published 31-day report by 1.8%.
   * Callers deriving this from a stored period should route through
   * `monthsInPeriod`, which short-circuits on `kind === "month"`, and pass
   * nothing when it returns 1.
   */
  periodDays?: number | null;
}

/**
 * The length of one row's period in months, for normalising its stored total.
 *
 * 1 for anything absent, non-numeric, non-finite or non-positive — see
 * `periodDays`. `x / 1` is exactly `x` in IEEE-754, so the absent path is not
 * merely close to the old arithmetic, it is the old arithmetic.
 */
function monthsOfEntry(snapshot: BurnSnapshotLike | undefined | null): number {
  const days = snapshot?.periodDays;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return 1;
  return days / DAYS_PER_MONTH;
}

export interface TrailingBurn {
  /**
   * Mean burn over the contributing months. 0 — never null — when none
   * contributed, so arithmetic downstream cannot produce NaN; check
   * `monthsUsed` to tell "no data" from "genuinely zero".
   */
  avgUsd: number;
  /**
   * How many months actually went into `avgUsd`, after dropping zero-burn
   * months. Returned so the caller can disclose a thin sample instead of
   * presenting a one-month average as a trailing three-month one.
   */
  monthsUsed: number;
  /** How many months were offered — `monthsUsed` plus the ones dropped. */
  monthsConsidered: number;
}

/**
 * Trailing average burn over prior periods.
 *
 * `snapshots` must be PRIOR snapshots, most-recent-first, EXCLUDING the
 * current one — the same ordering as `ReportSectionContext.trailing`. Callers
 * holding a list that starts with the current snapshot slice it off first.
 *
 * Months with zero, missing, negative or unparseable burn are excluded from
 * both the sum and the divisor (see the header). A shorter list than `months`
 * is normal on a young project and is reported through `monthsUsed`, not
 * treated as an error.
 *
 * Each surviving row is REDUCED TO A MONTHLY FIGURE before the mean is taken,
 * via its own `periodDays` — otherwise a 181-day window and a 30-day month
 * would be averaged as equals and the result would have no denominator. Rows
 * without `periodDays` normalise by exactly 1, so a list of ordinary snapshots
 * averages to precisely what it did before.
 *
 * THE ZERO-BURN RULE IS UNTOUCHED BY THAT. The exclusion still tests the RAW
 * stored value, and normalisation only ever runs on rows that already passed
 * it. A zero total stays missing data at any period length — dividing it by a
 * denominator would resurrect it as a zero-burn month, which is exactly the
 * halved-burn, doubled-runway error the header exists to prevent.
 */
export function trailingAverageBurn(
  snapshots: readonly BurnSnapshotLike[] | null | undefined,
  months = 3
): TrailingBurn {
  if (!Array.isArray(snapshots) || months <= 0) {
    return { avgUsd: 0, monthsUsed: 0, monthsConsidered: 0 };
  }
  const window = snapshots.slice(0, months);
  const burns = window
    .map((s) => {
      const raw = Number(s?.burnRateUsd ?? 0);
      if (!Number.isFinite(raw) || raw <= 0) return null;
      return raw / monthsOfEntry(s);
    })
    .filter((n): n is number => n !== null);
  return {
    avgUsd:
      burns.length > 0
        ? burns.reduce((a, b) => a + b, 0) / burns.length
        : 0,
    monthsUsed: burns.length,
    monthsConsidered: window.length,
  };
}

export type BurnTrend =
  | "accelerating"
  | "stable"
  | "decelerating"
  | "unknown";

/**
 * Dead band around the trailing average. Monthly burn moves several percent on
 * invoice timing alone; without a band, a report would narrate a trend every
 * single period and the word would stop meaning anything.
 */
const TREND_BAND = 0.15;

/**
 * Direction of this period's burn against its trailing average.
 *
 * "unknown" when there is no trailing average to compare against, and also
 * when the current period's burn is zero — by the same rule the average
 * applies, a zero-burn month is missing data, and calling it "decelerating"
 * would report a sync gap as an efficiency gain.
 */
export function burnTrend(current: number, trailingAvg: number): BurnTrend {
  if (!Number.isFinite(current) || !Number.isFinite(trailingAvg)) {
    return "unknown";
  }
  if (trailingAvg <= 0 || current <= 0) return "unknown";
  const ratio = current / trailingAvg;
  if (ratio > 1 + TREND_BAND) return "accelerating";
  if (ratio < 1 - TREND_BAND) return "decelerating";
  return "stable";
}

/**
 * Months of runway from spendable reserves at the given burn.
 *
 * Null — never Infinity, never 0 — when burn is zero, missing or unusable:
 * runway is undefined without a denominator, and 0 would read as "out of money
 * now" about a project that simply recorded no outflows. Callers must render
 * null as "not measurable this period", not as a number.
 *
 * The caller owns the definition of `liquidUsd`. Passing a total that includes
 * the project's own token reintroduces the bug this module was written to fix;
 * pass `liquidReservesUsd()` from treasury-liquidity.ts.
 */
export function liquidRunwayMonths(
  liquidUsd: number,
  avgBurn: number
): number | null {
  if (!Number.isFinite(liquidUsd) || liquidUsd < 0) return null;
  if (!Number.isFinite(avgBurn) || avgBurn <= 0) return null;
  return liquidUsd / avgBurn;
}
