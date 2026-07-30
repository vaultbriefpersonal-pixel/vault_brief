// The single classifier for "what is this holding?" — and the per-asset view
// of a treasury built on top of it.
//
// WHY THIS FILE EXISTS
//
// There used to be three answers to that question, and they disagreed:
//
//   1. `classifyTokens` in wallet-sync.ts — four buckets, matched on SYMBOL
//      only, run once at sync time and frozen into the four
//      `treasury_snapshots` columns (stablecoins_usd / eth_usd /
//      native_token_usd / other_assets_usd).
//   2. `analyzeTreasuryLiquidity` in treasury-liquidity.ts — a DIFFERENT four
//      buckets, re-derived from `balances_detail` at report time.
//   3. `solana-sync.ts`, which writes the chain's gas asset into
//      `native_token_usd` while wallet-sync writes the project's OWN token
//      into the same column. Same column, incompatible meanings.
//
// The report read both (1) and (2) at once: the PDF donut and the Treasury
// Overview table read the frozen columns, every sentence of prose read the
// derived ones. On a real $1.06B treasury whose `projects.token_symbol` had
// been left NULL at sync time, (1) froze `native_token_usd` at $0.00 and swept
// the entire own-token position into `other_assets_usd`, so the donut read
// "Other 100.0%" underneath prose that described the split correctly. No
// re-sync can repair a column that was computed from data the project had not
// entered yet — but a read-time classifier can, on every snapshot already in
// the database, which is why the fix lives here rather than in the sync.
//
// So: ONE predicate, `classifyHolding`, and everything else projects from it.
// `analyzeTreasuryLiquidity` is now a thin projection over `composeTreasury`,
// and `classifyTokens` is `bucketsToLegacyColumns(composeTreasury(...))`. The
// four snapshot columns are still written — dashboard tiles, anomalies.ts and
// the historical charts read them — but they are a WRITE-ONLY CACHE now.
// Nothing report-facing reads them. Editing one path and not the other is
// caught by the reconciliation test in treasury-composition.test.ts.
//
// Recognising `CHAINS[chain].nativeToken` as liquid crypto is what closes (3):
// SOL on Solana, MATIC on Polygon and ETH on every L2 are gas assets with deep
// markets, and before this they all fell through to `otherUsd` — understating
// liquid reserves, and through them runway, for every non-Ethereum treasury.
//
// PURITY IS A HARD CONSTRAINT. report-sections.ts imports this module, and
// report-sections.ts reaches the browser bundle through
// ReportTemplateEditor.tsx ("use client"). Allowed imports: `@/lib/chains` and
// `./defi-positions`, both pure. No `@/server/db`, no `openai`, no `node:*`,
// no `process.env` beyond what `@/lib/chains` already touches.
//
// Like defi-positions.ts, treasury-attribution.ts and treasury-liquidity.ts,
// every figure here derives from the already-stored
// `treasury_snapshots.balances_detail` JSONB (shape: `WalletBalanceSummary[]`
// from wallet-sync.ts) rather than from a new column. That choice is
// load-bearing: a sync-time column is NULL on every historical row, so the
// month-over-month section would read the first populated row as "this
// appeared this month" for every project on its next report. Deriving works
// retroactively across all history, with no backfill and no re-sync.
//
// A NOTE ON SPAM, so nobody re-litigates it: Dune Sim returns a `pool_size`
// field that looks like a spam signal and is not one — it is ABSENT for USDC
// and USDT while PRESENT for spam tokens. It was tested and rejected. The only
// spam defence here is `DUST_FLOOR_USD`: a holding worth under $100 is never
// named individually, so a spam airdrop cannot buy itself a line in a report.

import { CHAINS, STABLECOIN_SYMBOLS } from "@/lib/chains";
import { isLiquidStakingToken } from "./defi-positions";

/**
 * Below this, a holding is not named individually in a report — it is rolled
 * into a single "N smaller holdings" line.
 *
 * Absolute, NOT proportional, and that is the whole point. A proportional
 * floor (0.1% of the treasury) evaluates to ~$1.06M on the fixture treasury,
 * which suppressed a $1,136 stablecoin position and a $440 ETH position as
 * "immaterial". They are the opposite of immaterial: $1,136 of spendable cash
 * against a $1.06B balance sheet IS the finding, because it says the treasury
 * holds essentially no cash. See report-derived.ts for the three floors this
 * one was split out of.
 *
 * Dust still counts toward every total. The floor gates NAMING, not summing —
 * dropping it from the arithmetic would make the rows stop adding up to the
 * treasury, which is worse than printing a long tail.
 */
export const DUST_FLOOR_USD = 100;

/** Uppercase. Wrapped BTC trades against the same order books as BTC itself. */
export const BTC_SYMBOLS: ReadonlySet<string> = new Set([
  "BTC",
  "WBTC",
  "CBBTC",
  "TBTC",
]);

/** Uppercase. The chains' own gas asset and its wrapper are one asset here. */
export const ETH_SYMBOLS: ReadonlySet<string> = new Set(["ETH", "WETH"]);

/** A stored per-token holding. A structural subset of `TokenBalance`. */
export interface StoredTokenBalance {
  symbol?: string;
  name?: string;
  amount?: number;
  priceUsd?: number;
  valueUsd?: number;
  contractAddress?: string | null;
}

/** One wallet's stored balances. A structural subset of `WalletBalanceSummary`. */
export interface StoredWalletBalance {
  chain?: string;
  tokens?: StoredTokenBalance[];
}

/** The project fields that identify its own token. A structural subset of `Project`. */
export interface ProjectTokenIdentity {
  tokenSymbol?: string | null;
  tokenContract?: string | null;
}

/**
 * What a holding is, for every purpose in the product. Four values, because
 * four is what an investor reads differently:
 *
 *   • `stable`        — spendable on payroll this week, no price risk.
 *   • `liquid_crypto` — sellable at size, but at the market's price on the day.
 *   • `own_token`     — a bet on ourselves. Never counts toward runway.
 *   • `other`         — unrecognised, therefore illiquid by default.
 */
export type HoldingClass = "stable" | "liquid_crypto" | "own_token" | "other";

/**
 * The project's own token, matched on contract address FIRST. The contract is
 * authoritative: it identifies exactly one asset, whereas a ticker is a
 * self-declared string that dozens of tokens can and do share — and the real
 * fixture treasury holds spam deliberately spoofing real tickers.
 *
 * Symbol matching is the fallback, and it is not a legacy path to be removed:
 * every snapshot written before the `contractAddress` persistence fix stores
 * ZERO contract addresses, so symbol matching is the ONLY thing that
 * classifies them. It has to keep working.
 *
 * But the fallback is reached only when the contracts cannot decide the
 * question — when the project configured no contract, or the holding carries
 * none. When BOTH are present and they DIFFER, that is a definitive no, and the
 * symbol never gets a vote: "authoritative" has to mean it can rule a match
 * OUT as well as in, or a token merely calling itself UNI on an unrelated
 * contract gets counted as the project's own position. On a treasury that
 * really does hold spam spoofing its own ticker, letting the symbol overrule a
 * mismatched contract writes a false figure into the concentration percentage
 * and the runway denominator at once.
 *
 * Where the symbol IS the only signal, a false positive misclassifies an
 * unrelated token as the project's own and drops it out of runway. That is the
 * safe direction for an unavoidable ambiguity: it shortens the reported runway
 * rather than lengthening it.
 */
export function isOwnToken(
  token: StoredTokenBalance,
  project: ProjectTokenIdentity
): boolean {
  const ownContract = project.tokenContract?.trim().toLowerCase();
  const heldContract = token.contractAddress?.trim().toLowerCase();
  if (ownContract && heldContract) {
    // Both sides identify the asset unambiguously. The comparison is the whole
    // answer, in both directions.
    return heldContract === ownContract;
  }
  const ownSymbol = project.tokenSymbol?.trim().toUpperCase();
  if (!ownSymbol) return false;
  return token.symbol?.trim().toUpperCase() === ownSymbol;
}

/**
 * THE single predicate. Every bucket, every column, every donut slice and
 * every per-asset row in the product resolves through this function.
 *
 * Check order is deliberate and load-bearing:
 *
 *  1. Own token FIRST — it wins over every other rule, including the
 *     stablecoin rule. A stablecoin issuer holding its own stable is still
 *     holding its own token: the position unwinds badly for exactly the same
 *     reason any other own-token position does, and the runway denominator
 *     must not include it.
 *  2. Stablecoins.
 *  3. BTC and its wrappers.
 *  4. ETH and WETH.
 *  5. The chain's own gas asset (`CHAINS[chain].nativeToken`) — SOL on Solana,
 *     MATIC on Polygon, ETH on the L2s. Without this every non-Ethereum
 *     treasury's gas reserves read as illiquid.
 *  6. Recognised liquid-staking derivatives (bucketing only — never used to
 *     print a protocol name; see defi-positions.ts).
 *  7. Everything else: `other`. Illiquid by default, because an asset we
 *     cannot identify is an asset we cannot promise to sell, and understating
 *     liquidity is the safe direction for an error in an investor report.
 *
 * `chain` is the wallet's chain key from `balances_detail`. Unknown or missing
 * chains simply skip rule 5 rather than throwing.
 */
export function classifyHolding(
  token: StoredTokenBalance,
  identity: ProjectTokenIdentity,
  chain?: string | null
): HoldingClass {
  if (isOwnToken(token, identity)) return "own_token";

  const symbol = token.symbol?.trim().toUpperCase() ?? "";
  if (STABLECOIN_SYMBOLS.has(symbol)) return "stable";
  if (BTC_SYMBOLS.has(symbol)) return "liquid_crypto";
  if (ETH_SYMBOLS.has(symbol)) return "liquid_crypto";

  const nativeToken = chain
    ? CHAINS[chain as keyof typeof CHAINS]?.nativeToken
    : undefined;
  if (nativeToken && symbol === nativeToken) return "liquid_crypto";

  if (isLiquidStakingToken(token)) return "liquid_crypto";
  return "other";
}

/**
 * A holding we hold but cannot value: a positive quantity with no usable
 * price. Distinct from an empty position and from a corrupt row, because the
 * report is required to NAME these separately — "6 holdings with no price
 * feed" is honest; folding them into a total at $0 silently understates the
 * treasury and tells the reader nothing.
 */
function isUnpricedHolding(token: StoredTokenBalance): boolean {
  const amount = Number(token.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const price = Number(token.priceUsd ?? 0);
  return !Number.isFinite(price) || price <= 0;
}

/**
 * The four buckets, plus the two slices a report needs to name inside them.
 *
 * `btcUsd` and `ethUsd` are SLICES of `liquidCryptoUsd`, never fifth and
 * sixth buckets — adding them to the four would double-count. They exist
 * because "$1.02B of Other assets" tells a bitcoin-heavy treasury's reader
 * nothing, and because `ethUsd` is the one figure the legacy snapshot columns
 * need that the four buckets cannot reconstruct.
 */
export interface TreasuryBuckets {
  /** Stablecoins. The conservative runway denominator. */
  liquidStableUsd: number;
  /** ETH/WETH, BTC and wrappers, chain gas assets, recognised LSDs. */
  liquidCryptoUsd: number;
  /** The project's own token. Never counts toward runway, at any size. */
  concentratedUsd: number;
  /** Everything unrecognised. Illiquid by default. */
  otherUsd: number;
  /** BTC, WBTC, cbBTC, tBTC. A slice of `liquidCryptoUsd`. */
  btcUsd: number;
  /** ETH and WETH. A slice of `liquidCryptoUsd`. */
  ethUsd: number;
  /** Sum of the FOUR buckets. Excludes unpriced holdings entirely. */
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

/** One aggregated holding, ready to be a row in a report table. */
export interface AssetRow {
  /** As reported by the balance provider. Never trusted as an identity. */
  symbol: string;
  /** The chain the holding sits on, so two same-ticker rows stay distinguishable. */
  chain: string;
  /** Lowercased contract address, or null on snapshots written before it was persisted. */
  contractAddress: string | null;
  valueUsd: number;
  /** Percentage (0-100) of `totalUsd`. 0 when the total is 0. */
  sharePct: number;
  cls: HoldingClass;
}

/** The long tail, as one line. Its dollars are already inside the buckets. */
export interface DustRollup {
  /** Holdings worth less than `DUST_FLOOR_USD`. */
  count: number;
  /** Their combined value. Included in `totalUsd` — this is a display split. */
  totalUsd: number;
}

/** Holdings with no price feed. They carry no USD, so there is no total. */
export interface UnpricedRollup {
  count: number;
}

export interface TreasuryComposition extends TreasuryBuckets {
  /**
   * Every priced holding, aggregated per (chain, contract-or-symbol) and
   * sorted descending by value. Includes dust — filtering happens at display
   * time so the rows always add up to `totalUsd`.
   *
   * Aggregation key is deliberately per-chain and contract-first: merging
   * two chains' USDC into one row would be friendlier to read, but merging on
   * symbol alone would also merge a spam token spoofing "USDC" into the real
   * position, which is a false figure in an investor report.
   */
  assets: AssetRow[];
  dust: DustRollup;
  unpriced: UnpricedRollup;
}

const EMPTY: TreasuryComposition = {
  liquidStableUsd: 0,
  liquidCryptoUsd: 0,
  concentratedUsd: 0,
  otherUsd: 0,
  btcUsd: 0,
  ethUsd: 0,
  totalUsd: 0,
  concentrationPct: 0,
  derived: false,
  assets: [],
  dust: { count: 0, totalUsd: 0 },
  unpriced: { count: 0 },
};

/**
 * Walks a stored `balances_detail` payload and sorts every priced holding
 * into exactly one of four buckets, while building the per-asset view.
 *
 * Skipped, and contributing to NO bucket and NOT to `totalUsd`: holdings whose
 * value is non-finite, zero or negative. A negative "value" is corrupt data,
 * not a short position. Holdings that are skipped because nobody prices them
 * are counted in `unpriced` so the report can say so out loud.
 *
 * Defensive throughout: null, legacy shapes, non-array payloads, missing token
 * arrays and non-numeric values all aggregate to zeros rather than throwing.
 * An unreadable snapshot is an underived composition, not an exception — this
 * runs inside report generation, where throwing loses the whole report over
 * one bad row.
 */
export function composeTreasury(
  balancesDetail: unknown,
  project: ProjectTokenIdentity | null | undefined
): TreasuryComposition {
  if (!Array.isArray(balancesDetail) || balancesDetail.length === 0) {
    return { ...EMPTY, assets: [], dust: { ...EMPTY.dust }, unpriced: { ...EMPTY.unpriced } };
  }
  const identity: ProjectTokenIdentity = project ?? {};

  let liquidStableUsd = 0;
  let liquidCryptoUsd = 0;
  let concentratedUsd = 0;
  let otherUsd = 0;
  let btcUsd = 0;
  let ethUsd = 0;
  let unpricedCount = 0;
  let sawToken = false;

  // Insertion-ordered so equal-valued rows keep the provider's ordering
  // rather than an arbitrary one — a stable sort over a stable map.
  const rows = new Map<string, AssetRow>();

  for (const wallet of balancesDetail as StoredWalletBalance[]) {
    if (!wallet || !Array.isArray(wallet.tokens)) continue;
    const chain = typeof wallet.chain === "string" ? wallet.chain : "";

    for (const token of wallet.tokens) {
      if (!token || typeof token !== "object") continue;
      const value = Number(token.valueUsd ?? 0);
      if (!Number.isFinite(value) || value <= 0) {
        if (isUnpricedHolding(token)) unpricedCount++;
        continue;
      }
      sawToken = true;

      const cls = classifyHolding(token, identity, chain);
      const symbol = token.symbol?.trim().toUpperCase() ?? "";

      if (cls === "own_token") {
        concentratedUsd += value;
      } else if (cls === "stable") {
        liquidStableUsd += value;
      } else if (cls === "liquid_crypto") {
        liquidCryptoUsd += value;
        // The slices are read off the same predicate's result rather than
        // re-tested from scratch, so an own token that happens to be called
        // WBTC can never inflate `btcUsd`.
        if (BTC_SYMBOLS.has(symbol)) btcUsd += value;
        else if (ETH_SYMBOLS.has(symbol)) ethUsd += value;
      } else {
        otherUsd += value;
      }

      const contractAddress =
        token.contractAddress?.trim().toLowerCase() || null;
      const key = `${chain}:${contractAddress ?? symbol}`;
      const existing = rows.get(key);
      if (existing) {
        existing.valueUsd += value;
      } else {
        rows.set(key, {
          symbol: token.symbol?.trim() || "unknown",
          chain,
          contractAddress,
          valueUsd: value,
          sharePct: 0,
          cls,
        });
      }
    }
  }

  const totalUsd =
    liquidStableUsd + liquidCryptoUsd + concentratedUsd + otherUsd;

  const assets = [...rows.values()].sort((a, b) => b.valueUsd - a.valueUsd);
  for (const row of assets) {
    row.sharePct = totalUsd > 0 ? (row.valueUsd / totalUsd) * 100 : 0;
  }

  // Dust is measured on the AGGREGATED rows, not the raw holdings: three $40
  // positions in the same token across three wallets are one $120 holding, and
  // calling that dust would hide a position the treasury actually has.
  const dustRows = assets.filter((a) => a.valueUsd < DUST_FLOOR_USD);

  return {
    liquidStableUsd,
    liquidCryptoUsd,
    concentratedUsd,
    otherUsd,
    btcUsd,
    ethUsd,
    totalUsd,
    concentrationPct: totalUsd > 0 ? (concentratedUsd / totalUsd) * 100 : 0,
    derived: sawToken,
    assets,
    dust: {
      count: dustRows.length,
      totalUsd: dustRows.reduce((sum, a) => sum + a.valueUsd, 0),
    },
    unpriced: { count: unpricedCount },
  };
}

/** The four frozen `treasury_snapshots` columns, as written at sync time. */
export interface LegacySnapshotColumns {
  stablecoinsUsd: number;
  ethUsd: number;
  nativeTokenUsd: number;
  otherAssetsUsd: number;
}

/**
 * Projects the buckets onto the four sync-time snapshot columns.
 *
 * THESE COLUMNS ARE A WRITE-ONLY CACHE. Nothing report-facing reads them any
 * more — the PDF donut, the Treasury Overview table, the email donut, the
 * report widget strip and every sentence of prose all derive from
 * `composeTreasury` at read time. They are still written because the project
 * dashboard tiles, `anomalies.ts` and the historical treasury charts read them
 * directly off the row, and because dropping a column needs its own migration.
 *
 * The mapping is lossy in one direction, by design: the legacy schema has no
 * bucket for BTC, for liquid-staking derivatives or for a non-ETH gas asset,
 * so all three land in `otherAssetsUsd` exactly as the old symbol-only
 * classifier put them there. `liquidCryptoUsd - ethUsd` is precisely that
 * remainder. Do not "improve" this mapping: its job is to reproduce the legacy
 * columns, and the reconciliation test in treasury-composition.test.ts fails
 * the build if it stops doing so.
 */
export function bucketsToLegacyColumns(
  buckets: TreasuryBuckets
): LegacySnapshotColumns {
  return {
    stablecoinsUsd: buckets.liquidStableUsd,
    ethUsd: buckets.ethUsd,
    // wallet-sync's meaning of this column: the PROJECT's own token. Note that
    // solana-sync.ts writes the CHAIN's gas asset into the same column — a
    // pre-existing semantic collision that is now harmless precisely because
    // the column is write-only.
    nativeTokenUsd: buckets.concentratedUsd,
    otherAssetsUsd: buckets.otherUsd + (buckets.liquidCryptoUsd - buckets.ethUsd),
  };
}

/**
 * Donut/pie slices, in one place, because THREE surfaces render this chart —
 * the PDF (`pdf-generator.ts`), the investor email (`email-sender.ts`) and the
 * report widget strip (`ReportWidgets.tsx`). They used to build their own slice
 * arrays off the frozen columns and had already drifted in their labels.
 *
 * Returned unfiltered: each caller keeps its own zero-filter, because a chart
 * that renders a 0% wedge and a chart that omits it are both defensible and
 * the callers already made that choice differently.
 */
export function compositionSlices(
  buckets: TreasuryBuckets,
  project: ProjectTokenIdentity | null | undefined
): { label: string; value: number }[] {
  const ownLabel = project?.tokenSymbol?.trim() || "Own token";
  return [
    { label: "Stablecoins", value: buckets.liquidStableUsd },
    { label: "Liquid crypto", value: buckets.liquidCryptoUsd },
    { label: ownLabel, value: buckets.concentratedUsd },
    { label: "Other assets", value: buckets.otherUsd },
  ];
}
