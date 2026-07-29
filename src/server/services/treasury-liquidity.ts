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

import { STABLECOIN_SYMBOLS } from "@/lib/chains";
import { isLiquidStakingToken } from "./defi-positions";

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

const EMPTY: TreasuryLiquidity = {
  liquidStableUsd: 0,
  liquidCryptoUsd: 0,
  concentratedUsd: 0,
  otherUsd: 0,
  btcUsd: 0,
  totalUsd: 0,
  concentrationPct: 0,
  derived: false,
};

/** Uppercase. Wrapped BTC trades against the same order books as BTC itself. */
const BTC_SYMBOLS: ReadonlySet<string> = new Set([
  "BTC",
  "WBTC",
  "CBBTC",
  "TBTC",
]);

/** Uppercase. The chains' own gas asset and its wrapper are one asset here. */
const ETH_SYMBOLS: ReadonlySet<string> = new Set(["ETH", "WETH"]);

interface StoredTokenBalance {
  symbol?: string;
  valueUsd?: number;
  contractAddress?: string | null;
}

interface StoredWalletBalance {
  chain?: string;
  tokens?: StoredTokenBalance[];
}

/** The project fields that identify its own token. A structural subset of `Project`. */
export interface ProjectTokenIdentity {
  tokenSymbol?: string | null;
  tokenContract?: string | null;
}

/**
 * The project's own token, matched on contract address FIRST. The contract is
 * authoritative: it identifies exactly one asset, whereas a ticker is a
 * self-declared string that dozens of tokens can and do share. Symbol matching
 * is the fallback for projects that never filled in a contract, and for
 * holdings the balance provider returned without one.
 *
 * A symbol-only false positive misclassifies an unrelated token as the
 * project's own and drops it out of runway. That is the safe direction: it
 * shortens the reported runway rather than lengthening it.
 */
function isOwnToken(
  token: StoredTokenBalance,
  project: ProjectTokenIdentity
): boolean {
  const ownContract = project.tokenContract?.trim().toLowerCase();
  if (ownContract) {
    const held = token.contractAddress?.trim().toLowerCase();
    if (held && held === ownContract) return true;
  }
  const ownSymbol = project.tokenSymbol?.trim().toUpperCase();
  if (!ownSymbol) return false;
  return token.symbol?.trim().toUpperCase() === ownSymbol;
}

/**
 * Walks a stored `balances_detail` payload and sorts every priced holding into
 * exactly one of four liquidity buckets.
 *
 * Order of the checks is deliberate: own-token wins over every other rule,
 * including the stablecoin rule. A stablecoin issuer holding its own stable is
 * still holding its own token — the position unwinds badly for the same reason
 * any other own-token position does, and the runway denominator must not
 * include it.
 *
 * Defensive throughout: null, legacy shapes, non-array payloads, missing
 * token arrays, non-numeric values and negative values all aggregate to zeros
 * rather than throwing. An unreadable snapshot is an underived split, not an
 * exception — this runs inside report generation, where throwing loses the
 * whole report over one bad row.
 */
export function analyzeTreasuryLiquidity(
  balancesDetail: unknown,
  project: ProjectTokenIdentity | null | undefined
): TreasuryLiquidity {
  if (!Array.isArray(balancesDetail) || balancesDetail.length === 0) {
    return { ...EMPTY };
  }
  const identity: ProjectTokenIdentity = project ?? {};

  let liquidStableUsd = 0;
  let liquidCryptoUsd = 0;
  let concentratedUsd = 0;
  let otherUsd = 0;
  let btcUsd = 0;
  let sawToken = false;

  for (const wallet of balancesDetail as StoredWalletBalance[]) {
    if (!wallet || !Array.isArray(wallet.tokens)) continue;
    for (const token of wallet.tokens) {
      if (!token || typeof token !== "object") continue;
      const value = Number(token.valueUsd ?? 0);
      // Unpriced and zero-value dust contribute nothing to any bucket, and a
      // negative "value" is corrupt data, not a short position.
      if (!Number.isFinite(value) || value <= 0) continue;
      sawToken = true;

      const symbol = token.symbol?.trim().toUpperCase() ?? "";

      if (isOwnToken(token, identity)) {
        concentratedUsd += value;
      } else if (STABLECOIN_SYMBOLS.has(symbol)) {
        liquidStableUsd += value;
      } else if (BTC_SYMBOLS.has(symbol)) {
        liquidCryptoUsd += value;
        btcUsd += value;
      } else if (ETH_SYMBOLS.has(symbol)) {
        liquidCryptoUsd += value;
      } else if (isLiquidStakingToken(token)) {
        liquidCryptoUsd += value;
      } else {
        otherUsd += value;
      }
    }
  }

  const totalUsd =
    liquidStableUsd + liquidCryptoUsd + concentratedUsd + otherUsd;

  return {
    liquidStableUsd,
    liquidCryptoUsd,
    concentratedUsd,
    otherUsd,
    btcUsd,
    totalUsd,
    concentrationPct: totalUsd > 0 ? (concentratedUsd / totalUsd) * 100 : 0,
    derived: sawToken,
  };
}

/**
 * The runway denominator's numerator: what the project can actually spend.
 * Own-token holdings are excluded by construction, and unrecognised assets are
 * excluded because we cannot vouch for them.
 */
export function liquidReservesUsd(liquidity: TreasuryLiquidity): number {
  return liquidity.liquidStableUsd + liquidity.liquidCryptoUsd;
}
