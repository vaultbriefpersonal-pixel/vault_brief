// Splits the USD change in a treasury between two snapshots into the part
// caused by money actually moving (flow) and the part caused by the market
// re-pricing what was already held (price).
//
// This distinction is the whole point of the module. A treasury that grew
// 40% because the project's own token pumped is a completely different
// investor signal from one that grew 40% because revenue landed, yet both
// look identical in a headline "total balance" number. Reporting them as
// one figure is how a report ends up implying operational success that
// never happened.
//
// Like defi-positions.ts, this derives everything from the already-stored
// `treasury_snapshots.balances_detail` JSONB (shape: `WalletBalanceSummary[]`
// from wallet-sync.ts, which carries per-token `amount` + `priceUsd`) rather
// than adding a sync-time pipeline or schema column. So it works
// retroactively on every snapshot already in the database, no backfill.
//
// Deliberately dependency-free: no `@/server/db`, no `openai`, no `node:*`,
// no `process.env`. Report-section modules that import analytics like this
// get pulled into the client bundle through "use client" components, so a
// server-only import here would break the build in a way that is annoying to
// trace back. Keep it pure.
//
// Scope: this function knows nothing about dates and does no adjacency
// check. Passing two snapshots that are six periods apart produces a valid
// six-period attribution, not an error — picking the right pair of snapshots,
// and disclosing the size of the gap, is the caller's job.
//
// The wallet-set check is the one thing the caller genuinely *cannot* do for
// itself, which is why it lives here. Whether the tracked wallet set changed
// between two snapshots is only visible by diffing the two `balances_detail`
// payloads; a caller holding two snapshot rows sees a bigger total and has no
// way to tell coverage growth from an actual inflow.

/** Per-token contribution to the total change. Quantities are decimal-adjusted. */
export interface TokenAttribution {
  /** Identity used to match the token across the two snapshots. */
  key: string;
  symbol: string;
  chain: string;
  contractAddress: string | null;
  /** Total quantity held, across every wallet in that snapshot. */
  qtyPrev: number;
  qtyCurr: number;
  /** Reference prices actually used. 0 only when the token is unpriced. */
  pricePrev: number;
  priceCurr: number;
  valuePrevUsd: number;
  valueCurrUsd: number;
  /** Always equals valueCurrUsd - valuePrevUsd, and the four components below. */
  deltaUsd: number;
  /** Quantity moved within continuously-tracked wallets, at the prior price. */
  flowUsd: number;
  /** Prior quantity re-valued at the new price. Nothing moved. */
  priceEffectUsd: number;
  /** Interaction of the two. Reported separately, never folded into either. */
  crossUsd: number;
  /** Value that entered or left the report because wallet coverage changed. */
  walletSetUsd: number;
  /** Change we refuse to attribute because a price was missing. */
  unpricedUsd: number;
  /** False when Dune gave no usable price on a side where the token was held. */
  priced: boolean;
}

export interface TreasuryAttribution {
  valuePrevUsd: number;
  valueCurrUsd: number;
  deltaUsd: number;
  flowUsd: number;
  priceEffectUsd: number;
  crossUsd: number;
  /**
   * Value present in one snapshot's wallet set but not the other's. A
   * coverage change, not a treasury movement — never narrate it as an inflow
   * or an outflow.
   */
  walletSetUsd: number;
  unpricedUsd: number;
  /** True when the two snapshots do not cover the same wallets. */
  walletSetChanged: boolean;
  /** Wallets present only in curr, as they appeared in the payload. */
  addedWallets: string[];
  /** Wallets present only in prev. Includes wallets that failed to sync. */
  removedWallets: string[];
  /** Sorted by absolute USD impact, descending — top contributors first. */
  tokens: TokenAttribution[];
}

export type AttributionDriver =
  | "flow"
  | "price"
  | "cross"
  | "walletSet"
  | "unpriced"
  | "none";

export interface DominantDriver {
  driver: AttributionDriver;
  usd: number;
  /** 0-1 share of total absolute movement, not of the net delta — see below. */
  share: number;
}

export interface NetFlowReconciliation {
  /** Signed: balance-derived flow minus transaction-derived net flow. */
  divergenceUsd: number;
  /** Fraction (0-1+), not percentage points. Null when not comparable. */
  divergencePct: number | null;
  verdict: "consistent" | "diverging" | "unavailable";
}

interface StoredTokenBalance {
  symbol?: string;
  amount?: number;
  priceUsd?: number;
  valueUsd?: number;
  contractAddress?: string | null;
}

interface StoredWalletBalance {
  walletAddress?: string;
  chain?: string;
  tokens?: StoredTokenBalance[];
}

/**
 * One token's position in a single snapshot, split by whether the wallet
 * holding it appears in *both* snapshots. Only the tracked side is eligible
 * for flow/price attribution.
 */
interface Aggregated {
  key: string;
  symbol: string;
  chain: string;
  contractAddress: string | null;
  /** Quantity in wallets common to both snapshots. */
  qtyTracked: number;
  /** Quantity in wallets present in only this snapshot. */
  qtyUntracked: number;
  /** 0 means "Dune could not price this", never a genuine price of zero. */
  price: number;
  storedValueTrackedUsd: number;
  storedValueUntrackedUsd: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Wallet identity for set comparison. Chain is part of the key because
 * tracking the same EVM address on a second chain is genuinely new coverage.
 *
 * EVM addresses come back in mixed checksum casing and are case-insensitive,
 * so they are lowercased. Solana addresses are base58 and case-*sensitive* —
 * lowercasing one could merge two distinct wallets — so they are compared
 * raw. A missing address (legacy payloads) collapses to a stable placeholder
 * so old snapshots compare equal to each other, rather than every wallet
 * looking simultaneously added and removed.
 */
function walletKey(chain: string, address: string): string {
  return chain === "solana"
    ? `${chain}:${address}`
    : `${chain}:${address.toLowerCase()}`;
}

/** Wallet key → address as it appeared. Tolerates malformed payloads. */
function walletKeys(balancesDetail: unknown): Map<string, string> {
  const keys = new Map<string, string>();
  if (!Array.isArray(balancesDetail)) return keys;

  for (const wallet of balancesDetail as StoredWalletBalance[]) {
    if (!wallet) continue;
    const chain = typeof wallet.chain === "string" ? wallet.chain : "unknown";
    const address =
      typeof wallet.walletAddress === "string" ? wallet.walletAddress : "";
    keys.set(walletKey(chain, address), address);
  }

  return keys;
}

/**
 * Token identity across snapshots. Contract address is the only stable
 * handle — symbols get reused, renamed, and spoofed. The `chain:SYMBOL`
 * fallback exists for native assets (ETH, SOL), which have no contract;
 * symbol alone would merge two different chains' natives into one position.
 *
 * Known tradeoff: an address deployed at the same bytes on two EVM chains
 * aggregates into a single row. That understates chain-level detail but
 * never corrupts the flow/price split, since the quantities and prices
 * being combined are for economically equivalent claims.
 */
function tokenKey(chain: string, symbol: string, contractAddress: string | null): string {
  const address = contractAddress?.toLowerCase();
  return address ? address : `${chain}:${symbol.toUpperCase()}`;
}

/**
 * Collapses a `balances_detail` JSON value into one entry per token, keeping
 * wallets outside `trackedWallets` in a separate bucket. Defensive against
 * malformed/legacy/missing data — always returns a map, never throws.
 */
function aggregateSnapshot(
  balancesDetail: unknown,
  trackedWallets: Set<string>
): Map<string, Aggregated> {
  const byToken = new Map<string, Aggregated>();
  if (!Array.isArray(balancesDetail)) return byToken;

  for (const wallet of balancesDetail as StoredWalletBalance[]) {
    if (!wallet || !Array.isArray(wallet.tokens)) continue;
    const chain = typeof wallet.chain === "string" ? wallet.chain : "unknown";
    const address =
      typeof wallet.walletAddress === "string" ? wallet.walletAddress : "";
    const tracked = trackedWallets.has(walletKey(chain, address));

    for (const token of wallet.tokens) {
      if (!token) continue;
      const symbol = typeof token.symbol === "string" ? token.symbol : "";
      const contractAddress =
        typeof token.contractAddress === "string" ? token.contractAddress : null;
      if (!symbol && !contractAddress) continue;

      const key = tokenKey(chain, symbol, contractAddress);
      const amount = num(token.amount);
      const valueUsd = num(token.valueUsd);
      const price = num(token.priceUsd);

      const existing = byToken.get(key);
      if (existing) {
        if (tracked) {
          existing.qtyTracked += amount;
          existing.storedValueTrackedUsd += valueUsd;
        } else {
          existing.qtyUntracked += amount;
          existing.storedValueUntrackedUsd += valueUsd;
        }
        // Same token, same snapshot, so every wallet quotes the same Dune
        // price. Keep the first real one rather than averaging: a 0 from one
        // wallet must not drag a known price down toward "unknown".
        if (existing.price === 0) existing.price = price;
      } else {
        byToken.set(key, {
          key,
          symbol,
          chain,
          contractAddress,
          qtyTracked: tracked ? amount : 0,
          qtyUntracked: tracked ? 0 : amount,
          price,
          storedValueTrackedUsd: tracked ? valueUsd : 0,
          storedValueUntrackedUsd: tracked ? 0 : valueUsd,
        });
      }
    }
  }

  return byToken;
}

/**
 * Resolves the pair of prices to decompose against, or null when the change
 * cannot honestly be attributed.
 *
 * Dune returns `price_usd: null` for tokens it cannot price, which
 * wallet-sync stores as `0`. Treating that 0 as a real price is the
 * dangerous failure: a token unpriced at $0 in one snapshot and quoted at
 * $1,500 in the next would be reported as a $1,500-per-unit rally that
 * never occurred. So 0 means unknown here, always.
 *
 * A side where nothing is held needs no price of its own — a brand-new
 * position is valued at the price it arrived at, and an exited position at
 * the price it left at. Both are pure flow, with no price effect, because
 * there is no holding period over which a price could have moved.
 */
function resolvePrices(
  qtyPrev: number,
  rawPricePrev: number,
  qtyCurr: number,
  rawPriceCurr: number
): { pricePrev: number; priceCurr: number } | null {
  const heldPrev = qtyPrev !== 0;
  const heldCurr = qtyCurr !== 0;

  const knownPrev = rawPricePrev > 0 ? rawPricePrev : null;
  const knownCurr = rawPriceCurr > 0 ? rawPriceCurr : null;

  if (!heldPrev && !heldCurr) return { pricePrev: 0, priceCurr: 0 };

  const pricePrev = heldPrev ? knownPrev : knownCurr;
  const priceCurr = heldCurr ? knownCurr : knownPrev;
  if (pricePrev === null || priceCurr === null) return null;

  return { pricePrev, priceCurr };
}

function attributeToken(
  prev: Aggregated | undefined,
  curr: Aggregated | undefined
): TokenAttribution {
  // aggregateSnapshot only produces entries for keys it actually saw, so at
  // least one side is defined for every key attributeTreasuryChange iterates.
  const identity = curr ??
    prev ?? { key: "", symbol: "", chain: "unknown", contractAddress: null };
  const { key, symbol, chain, contractAddress } = identity;

  const trackedPrev = prev?.qtyTracked ?? 0;
  const trackedCurr = curr?.qtyTracked ?? 0;
  // Quantity sitting in a removed wallet (prev) or a newly added one (curr).
  const untrackedPrev = prev?.qtyUntracked ?? 0;
  const untrackedCurr = curr?.qtyUntracked ?? 0;

  const qtyPrev = trackedPrev + untrackedPrev;
  const qtyCurr = trackedCurr + untrackedCurr;

  const prices = resolvePrices(qtyPrev, prev?.price ?? 0, qtyCurr, curr?.price ?? 0);

  if (!prices) {
    // Unattributable: fall back to the stored USD values so the caller can
    // disclose the gap instead of us silently dropping it from the total.
    const storedTrackedPrev = prev?.storedValueTrackedUsd ?? 0;
    const storedTrackedCurr = curr?.storedValueTrackedUsd ?? 0;
    const storedUntrackedPrev = prev?.storedValueUntrackedUsd ?? 0;
    const storedUntrackedCurr = curr?.storedValueUntrackedUsd ?? 0;

    const valuePrevUsd = storedTrackedPrev + storedUntrackedPrev;
    const valueCurrUsd = storedTrackedCurr + storedUntrackedCurr;

    return {
      key,
      symbol,
      chain,
      contractAddress,
      qtyPrev,
      qtyCurr,
      pricePrev: 0,
      priceCurr: 0,
      valuePrevUsd,
      valueCurrUsd,
      deltaUsd: valueCurrUsd - valuePrevUsd,
      flowUsd: 0,
      priceEffectUsd: 0,
      crossUsd: 0,
      walletSetUsd: storedUntrackedCurr - storedUntrackedPrev,
      unpricedUsd: storedTrackedCurr - storedTrackedPrev,
      priced: false,
    };
  }

  const { pricePrev, priceCurr } = prices;

  // Flow/price/cross are computed over the continuously-tracked wallets only.
  // Holdings that entered or left the report because coverage changed have no
  // meaningful quantity change — nobody moved them — so folding them in here
  // would manufacture exactly the false inflow this module exists to prevent.
  // They go to walletSetUsd instead.
  const deltaQty = trackedCurr - trackedPrev;
  const deltaPrice = priceCurr - pricePrev;

  const flowUsd = deltaQty * pricePrev;
  const priceEffectUsd = trackedPrev * deltaPrice;
  const crossUsd = deltaQty * deltaPrice;
  const walletSetUsd = untrackedCurr * priceCurr - untrackedPrev * pricePrev;

  // Values are recomputed as qty x price rather than read from the stored
  // `valueUsd`. Dune's value_usd is its own rounded product and drifts from
  // amount x price_usd by cents, which would leave the components not quite
  // summing to the delta — and a decomposition that doesn't add up is worse
  // than useless in an investor-facing number.
  const valuePrevUsd = qtyPrev * pricePrev;
  const valueCurrUsd = qtyCurr * priceCurr;

  return {
    key,
    symbol,
    chain,
    contractAddress,
    qtyPrev,
    qtyCurr,
    pricePrev,
    priceCurr,
    valuePrevUsd,
    valueCurrUsd,
    deltaUsd: valueCurrUsd - valuePrevUsd,
    flowUsd,
    priceEffectUsd,
    crossUsd,
    walletSetUsd,
    unpricedUsd: 0,
    priced: true,
  };
}

/**
 * Decomposes the USD change between two snapshots' `balances_detail`.
 *
 * Per token, over the wallets both snapshots cover:
 * `flow = dQty x pricePrev`, `price = qtyPrev x dPrice`,
 * `cross = dQty x dPrice`. Those plus `walletSet` and `unpriced` sum exactly
 * to the token's value change — that identity is the correctness invariant
 * of this module.
 *
 * The cross term is reported on its own and never folded into flow or
 * price. Folding it is a judgement call that shifts an investor-facing
 * number without saying so; a caller that wants to merge it can, visibly.
 *
 * Caller must pass the snapshots it actually wants compared — see the
 * scope note at the top of this file.
 */
export function attributeTreasuryChange(
  prevBalancesDetail: unknown,
  currBalancesDetail: unknown
): TreasuryAttribution {
  const prevWallets = walletKeys(prevBalancesDetail);
  const currWallets = walletKeys(currBalancesDetail);

  // A wallet that failed to sync contributes no entry to balances_detail at
  // all (wallet-sync records it in `warnings` instead), so it shows up here
  // as removed. That is the correct read: its holdings are absent from the
  // snapshot, and calling that a drawdown would be a fabrication.
  const tracked = new Set<string>();
  const addedWallets: string[] = [];
  const removedWallets: string[] = [];
  for (const [key, address] of prevWallets) {
    if (currWallets.has(key)) tracked.add(key);
    else removedWallets.push(address);
  }
  for (const [key, address] of currWallets) {
    if (!prevWallets.has(key)) addedWallets.push(address);
  }

  const prev = aggregateSnapshot(prevBalancesDetail, tracked);
  const curr = aggregateSnapshot(currBalancesDetail, tracked);

  const tokens: TokenAttribution[] = [];
  for (const key of new Set([...prev.keys(), ...curr.keys()])) {
    tokens.push(attributeToken(prev.get(key), curr.get(key)));
  }

  tokens.sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));

  const total: TreasuryAttribution = {
    valuePrevUsd: 0,
    valueCurrUsd: 0,
    deltaUsd: 0,
    flowUsd: 0,
    priceEffectUsd: 0,
    crossUsd: 0,
    walletSetUsd: 0,
    unpricedUsd: 0,
    walletSetChanged: addedWallets.length > 0 || removedWallets.length > 0,
    addedWallets,
    removedWallets,
    tokens,
  };

  for (const t of tokens) {
    total.valuePrevUsd += t.valuePrevUsd;
    total.valueCurrUsd += t.valueCurrUsd;
    total.deltaUsd += t.deltaUsd;
    total.flowUsd += t.flowUsd;
    total.priceEffectUsd += t.priceEffectUsd;
    total.crossUsd += t.crossUsd;
    total.walletSetUsd += t.walletSetUsd;
    total.unpricedUsd += t.unpricedUsd;
  }

  return total;
}

/**
 * The single component a report sentence should lead with.
 *
 * `share` is measured against total absolute movement, not against the net
 * delta. When $10M of inflows is cancelled by a $10M price drawdown the net
 * delta is ~$0, and a share-of-delta would blow up to a meaningless
 * multiple — precisely in the case where naming the driver matters most.
 */
export function dominantDriver(attribution: TreasuryAttribution): DominantDriver {
  const components: { driver: AttributionDriver; usd: number }[] = [
    { driver: "flow", usd: attribution.flowUsd },
    { driver: "price", usd: attribution.priceEffectUsd },
    { driver: "cross", usd: attribution.crossUsd },
    { driver: "walletSet", usd: attribution.walletSetUsd },
    { driver: "unpriced", usd: attribution.unpricedUsd },
  ];

  const magnitude = components.reduce((sum, c) => sum + Math.abs(c.usd), 0);
  if (magnitude === 0) return { driver: "none", usd: 0, share: 0 };

  const top = components.reduce((best, c) =>
    Math.abs(c.usd) > Math.abs(best.usd) ? c : best
  );

  return { driver: top.driver, usd: top.usd, share: Math.abs(top.usd) / magnitude };
}

// Below this, both estimates are small enough that a percentage comparison
// amplifies noise instead of finding anything — $500 of drift on $600 of flow
// is an "83% divergence" that means nothing. Matches the absolute floor
// anomalies.ts already uses, so the two features agree on what counts as a
// real number.
const MIN_RECONCILE_DENOMINATOR_USD = 1_000;

// The two estimates measure the same quantity but never line up exactly: the
// balance-derived figure spans the whole gap between snapshots while
// netFlowUsd covers only the transaction sync's window; unpriced tokens
// contribute to one side and not the other; and balance quantities are valued
// at snapshot-boundary prices while transactions are valued at execution
// time. Single-digit and low-double-digit percentage gaps are therefore
// expected. 25% sits above that noise while still tripping on the case that
// actually matters — a report about to claim inflows the parsed transactions
// do not support, which shows up far larger than this (often a sign flip,
// which lands above 100% on its own).
const DIVERGENCE_THRESHOLD = 0.25;

/**
 * Cross-checks the balance-derived `flowUsd` against the snapshot's stored
 * `netFlowUsd`, which transaction-sync computes independently from parsed
 * transactions.
 *
 * Two independent estimates of the same quantity agreeing is a confidence
 * signal worth stating; them diverging is itself a finding, and a reason to
 * hedge the sentence rather than assert a number. Neither is authoritative
 * enough to correct the other, so this reports the gap and does not pick a
 * winner.
 */
export function reconcileWithNetFlow(
  attribution: TreasuryAttribution,
  netFlowUsd: number | null
): NetFlowReconciliation {
  const unavailable: NetFlowReconciliation = {
    divergenceUsd: 0,
    divergencePct: null,
    verdict: "unavailable",
  };

  if (netFlowUsd === null || !Number.isFinite(netFlowUsd)) return unavailable;

  // With coverage changed, flowUsd deliberately excludes the added/removed
  // wallets while netFlowUsd's transaction window makes no such distinction.
  // The two are then measuring different things, and any gap between them
  // says nothing about data quality.
  if (attribution.walletSetChanged) return unavailable;

  const divergenceUsd = attribution.flowUsd - netFlowUsd;

  // Larger of the two magnitudes, so a near-zero on either side cannot send
  // the ratio to Infinity.
  const denominator = Math.max(Math.abs(attribution.flowUsd), Math.abs(netFlowUsd));
  if (denominator < MIN_RECONCILE_DENOMINATOR_USD) return unavailable;

  const divergencePct = Math.abs(divergenceUsd) / denominator;

  return {
    divergenceUsd,
    divergencePct,
    verdict: divergencePct > DIVERGENCE_THRESHOLD ? "diverging" : "consistent",
  };
}
