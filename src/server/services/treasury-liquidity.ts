// Splits a treasury into what the project could actually spend, and what it
// only nominally owns.
//
// The motivating error: runway was computed as total treasury ÷ burn, and
// "total treasury" includes the project's own token. A DAO cannot sell its own
// token at size without moving its price against itself, and that token is
// worth least at exactly the moment the project is in trouble and needs to
// sell — the correlation runs the wrong way. Counting it as runway overstates
// survival time, routinely by years. Every figure here exists so a report can
// state a runway an investor can rely on.
//
// Two orthogonal axes, four buckets, because an investor reads them
// differently. Liquidity asks "can this be converted to operating cash
// quickly?"; concentration asks "how much of this is a bet on ourselves?".
// A treasury can be liquid and concentrated (own token with a deep market),
// or illiquid and diversified (a spread of long-tail assets). Collapsing them
// into one "quality" score destroys the distinction the reader needs.
//
// Like defi-positions.ts and treasury-attribution.ts, this derives everything
// from the already-stored `treasury_snapshots.balances_detail` JSONB (shape:
// `WalletBalanceSummary[]` from wallet-sync.ts) rather than adding a column.
// That choice is load-bearing, not stylistic: a new sync-time column is NULL
// on every historical row, so the month-over-month section would read the
// first populated row as "BTC appeared this month" for every project on its
// next report. Deriving works retroactively across all history, no backfill.
//
// Deliberately dependency-free: no `@/server/db`, no `openai`, no `node:*`,
// no `process.env`. report-sections.ts imports this, and report-sections.ts
// reaches the browser through ReportTemplateEditor.tsx ("use client"), so a
// server-only import here breaks the build. `@/lib/chains` is pure and safe.
//
// SINCE P0.1, THE CLASSIFICATION ITSELF LIVES IN treasury-composition.ts.
// This module is a projection: `analyzeTreasuryLiquidity` calls
// `composeTreasury` and picks the eight fields below off the result. The split
// exists because the same predicate now has to serve the liquidity/runway
// question AND the per-asset composition table AND the four sync-time snapshot
// columns, and three independent implementations of "is this a stablecoin?" is
// how the donut ended up reading "Other 100.0%" under prose that had it right.
//
// The exported name, signature and return shape here are unchanged and must
// stay unchanged — report-derived.ts, report-evidence.ts and
// treasury-liquidity.test.ts all depend on them, and that test file passing
// UNMODIFIED is the proof the projection is shape-compatible.

import {
  composeTreasury,
  type ProjectTokenIdentity,
  type TreasuryBuckets,
} from "./treasury-composition";

// Re-exported so every existing importer of these keeps resolving. They moved
// to treasury-composition.ts because the single predicate needs to own them;
// nothing about their meaning changed.
export {
  BTC_SYMBOLS,
  ETH_SYMBOLS,
  isOwnToken,
  type ProjectTokenIdentity,
} from "./treasury-composition";

export interface TreasuryLiquidity {
  /**
   * Stablecoins. The conservative runway denominator: no price risk, no
   * slippage worth modelling, spendable on payroll this week.
   */
  liquidStableUsd: number;
  /**
   * ETH/WETH, BTC and its wrappers, and recognised liquid-staking tokens.
   * Sellable at size, but the amount realised depends on the market on the
   * day — liquid, not safe.
   */
  liquidCryptoUsd: number;
  /**
   * The project's own token. Never counts toward runway, at any size, for
   * any project.
   */
  concentratedUsd: number;
  /**
   * Everything unrecognised. Illiquid by default: an asset we cannot identify
   * is an asset we cannot promise to sell, and understating liquidity is the
   * safe direction for an error in an investor report.
   */
  otherUsd: number;
  /**
   * BTC, WBTC, cbBTC and tBTC. A SLICE OF `liquidCryptoUsd`, not a fifth
   * bucket — never add it to the four above. Broken out because BTC has no
   * bucket in the snapshot's stored columns, so today a bitcoin-heavy treasury
   * renders as ~100% "Other assets" and the reader is told nothing.
   */
  btcUsd: number;
  /** Sum of the four buckets. 0 when the snapshot carries no per-token detail. */
  totalUsd: number;
  /** Own token as a percentage (0-100) of `totalUsd`. 0 when total is 0. */
  concentrationPct: number;
  /**
   * False when `balances_detail` was missing, empty or unreadable. Distinct
   * from a treasury that genuinely holds nothing: "we could not compute the
   * split" and "the split is all zeros" support different sentences, and only
   * one of them may be printed as a finding.
   */
  derived: boolean;
}

/**
 * Narrows a full `TreasuryComposition` (or any bucket set) to the liquidity
 * view. Fields are picked explicitly rather than spread, so the returned object
 * carries exactly the eight keys declared above and nothing else — the
 * per-asset rows, the dust rollup and the unpriced count belong to the
 * composition view and must not leak into a consumer that never asked for them.
 *
 * Exported so report-derived.ts can reuse its ONE memoized `composeTreasury`
 * call for both views instead of walking every token in the snapshot twice.
 */
export function liquidityFromBuckets(
  buckets: TreasuryBuckets
): TreasuryLiquidity {
  return {
    liquidStableUsd: buckets.liquidStableUsd,
    liquidCryptoUsd: buckets.liquidCryptoUsd,
    concentratedUsd: buckets.concentratedUsd,
    otherUsd: buckets.otherUsd,
    btcUsd: buckets.btcUsd,
    totalUsd: buckets.totalUsd,
    concentrationPct: buckets.concentrationPct,
    derived: buckets.derived,
  };
}

/**
 * The liquidity split of a stored `balances_detail` payload.
 *
 * All classification — the own-token-first check order, the stablecoin set, the
 * BTC and ETH families, the chain gas asset, liquid-staking recognition, and
 * the skip rules for non-finite, zero and negative values — lives in
 * `composeTreasury`. This function is the projection onto the eight fields
 * `TreasuryLiquidity` declares, and nothing more.
 *
 * Still defensive by inheritance: null, legacy shapes, non-array payloads,
 * missing token arrays and non-numeric values all aggregate to zeros rather
 * than throwing. An unreadable snapshot is an underived split, not an
 * exception — this runs inside report generation, where throwing loses the
 * whole report over one bad row.
 */
export function analyzeTreasuryLiquidity(
  balancesDetail: unknown,
  project: ProjectTokenIdentity | null | undefined
): TreasuryLiquidity {
  return liquidityFromBuckets(composeTreasury(balancesDetail, project));
}

/**
 * The runway denominator's numerator: what the project can actually spend.
 * Own-token holdings are excluded by construction, and unrecognised assets are
 * excluded because we cannot vouch for them.
 */
export function liquidReservesUsd(liquidity: TreasuryLiquidity): number {
  return liquidity.liquidStableUsd + liquidity.liquidCryptoUsd;
}
