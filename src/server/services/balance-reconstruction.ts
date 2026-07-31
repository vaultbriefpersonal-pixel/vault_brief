// Past balances, walked back from present ones — and an honest account of
// everything the walk-back could not see.
//
// WHY THIS FILE EXISTS
//
// `fetchAllBalances` (wallet-sync.ts) takes no period argument. It reads the
// wallets live, as of now. That is correct for a snapshot dated today and
// silently wrong for every other date, so `projects.sync({months: 12})` used
// to write twelve rows carrying ONE set of balances under twelve dates. Nothing
// downstream could tell: month-over-month, anomalies and the forecast all read
// those rows as observed history and narrated a treasury that had been
// perfectly flat for a year. Dune Sim has no historical-balances endpoint on
// this plan, so the only way to get a past balance is to walk the present one
// backwards through transfer history.
//
// THE ARITHMETIC, and it is the whole module:
//
//     qty(t−1) = qty(t) − inbound(t) + outbound(t)
//
// per `(chain, wallet, token identity)`. `qty(t)` is the quantity at the END of
// period t; `inbound`/`outbound` are the transfer legs INSIDE period t. Reading
// it the other way round — subtracting outbound, adding inbound — inverts every
// figure and is the single most likely way to get this wrong, which is why the
// unit tests assert direction explicitly rather than only asserting totals.
//
// ─── THE HONESTY LEDGER ────────────────────────────────────────────────────
//
// EXACT — transfer quantities and timestamps for the `external`, `erc20` and
// (on Ethereum/Polygon) `internal` legs that fall inside Alchemy's window, for
// every tracked wallet. That is what the walk-back is built from.
//
// APPROXIMATE — every per-token past balance produced here, and every USD
// value put on one. Quantities inherit the completeness of the transfer feed;
// USD comes from CoinGecko's daily close via price-resolver.ts, which is a
// close, not the price at the moment of the snapshot.
//
// NOT RECONSTRUCTABLE, THEREFORE MISSING — and each of these makes the
// reconstructed quantity too LOW, because it is a credit the wallet received
// without a Transfer event:
//   • rebasing and interest accrual (stETH, aTokens, sDAI)
//   • staking rewards credited by a balance write rather than a transfer
//   • mints and burns that Alchemy does not serve for the category set in use
//   • anything predating the fetch window
//   • NFTs, which carry no fungible quantity at all
// The same direction of error applies to gas: native-token gas spend is not a
// transfer, so the native balance at `t−1` is understated by the gas burned in
// the period. These are the reason `clampedPositions` exists — see below.
//
// NOT COVERED IN V1 — Solana. `fetchSolanaTransfers` pagination is unverified,
// so a Solana wallet's holdings are carried forward at their present quantity
// and the wallet is listed in `meta.carriedForwardWallets`. Disclosed, not
// guessed at: dropping the wallet instead would fabricate a total exit in
// month-over-month, which is the worse of the two errors (see the alias-matching
// note in treasury-attribution.ts for the same lesson learned the hard way).
//
// ─── NEGATIVES ARE THE SIGNAL, NOT THE NOISE ───────────────────────────────
//
// When the walk-back produces a negative quantity, the honest reading is not
// "the arithmetic is broken" — it is "this wallet received a credit we cannot
// see". Every bullet in the NOT RECONSTRUCTABLE list above produces exactly
// that. So negatives clamp to 0 (a negative token balance is not a thing) AND
// are counted, sized and sampled into `meta.clamps`, because a clamp is the
// single most informative fact the reconstruction can report about its own
// quality. Silently clamping would turn the one visible symptom of an
// unobservable credit into a plausible-looking zero.
//
// ─── PURITY IS A HARD CONSTRAINT ───────────────────────────────────────────
//
// report-derived.ts imports the types here, and report-derived.ts reaches the
// browser through report-sections.ts → ReportTemplateEditor.tsx ("use client").
// No `@/server/db`, no `openai`, no `node:*`, no `process.env`. `@/lib/chains`
// and the pure services are fine. This is also why PRICING IS NOT DONE HERE:
// price-resolver.ts imports `db`. The split is `reconstructBalances` (pure
// quantities) → caller resolves prices → `priceReconstruction` (pure, takes the
// resolved prices). All the arithmetic stays testable without a network.
//
// NEVER THROWS. A malformed stored payload reconstructs to a
// disclosed-incomplete result, not an exception — same discipline as
// defi-positions.ts, treasury-attribution.ts and major-transactions.ts. This
// runs inside a sync that is about to write a row; losing the whole sync over
// one unreadable token entry is the worse failure.

import {
  bucketsToLegacyColumns,
  composeTreasury,
  type ProjectTokenIdentity,
} from "./treasury-composition";

/**
 * Where a snapshot's BALANCE figures came from.
 *
 * Only the balances. Every FLOW column on a snapshot (inflows, outflows, burn,
 * the expense/income breakdowns, the GitHub counters) is measured over the
 * period in both cases, because `fetchAndClassify` really does query that
 * window — the walk-back is built out of exactly those transfers. A
 * reconstructed row is not a fabricated row; it is a row whose point-in-time
 * balances are estimates and whose period flows are not.
 */
export type BalanceBasis = "observed" | "reconstructed";

/** A stored per-token holding. Structural subset of wallet-sync's `TokenBalance`. */
export interface StoredToken {
  symbol?: string | null;
  name?: string | null;
  amount?: number | string | null;
  priceUsd?: number | string | null;
  valueUsd?: number | string | null;
  contractAddress?: string | null;
}

/** One wallet's stored balances. Structural subset of `WalletBalanceSummary`. */
export interface StoredWallet {
  walletAddress?: string | null;
  chain?: string | null;
  tokens?: StoredToken[] | null;
}

/**
 * One transfer leg, in the only shape the walk-back needs.
 *
 * Deliberately NOT `ClassifiedTransaction`. That type carries no `chain`, no
 * tracked-wallet handle and no contract address — it could not key a position
 * if it wanted to — and widening it would change the JSONB this product
 * persists in `transactions_raw` for a purpose that never reads it back.
 * transaction-sync.ts builds these alongside, from the same Alchemy rows,
 * inside the per-wallet loop where `chain` and `wallet` are still in scope.
 *
 * `amount` is in TOKEN UNITS, decimal-adjusted and positive, matching Alchemy's
 * `value` and `balances_detail`'s `amount`. Direction carries the sign; a
 * negative `amount` here is corrupt input and is ignored.
 */
export interface ReconstructionTransfer {
  chain?: string | null;
  /** The tracked wallet this leg was read FOR — not `from`/`to`. */
  wallet?: string | null;
  symbol?: string | null;
  contractAddress?: string | null;
  amount?: number | string | null;
  direction?: "in" | "out" | null;
}

/** One clamped position: the walk-back went negative and was cut off at zero. */
export interface ReconstructionClamp {
  chain: string;
  wallet: string;
  symbol: string;
  contractAddress: string | null;
  /** Token units the walk-back came up short by. Always > 0. */
  shortfall: number;
  /**
   * `shortfall` in USD at the reconstruction date. Null until
   * `priceReconstruction` runs, and null after it when the token has no price.
   */
  shortfallUsd: number | null;
}

/** A wallet whose holdings could not be walked back and were carried forward. */
export interface CarriedForwardWallet {
  chain: string;
  address: string;
  reason: string;
}

/**
 * What the walk-back did, and what it could not do. Stored verbatim in
 * `treasury_snapshots.reconstruction_meta`.
 *
 * Written for a READER, not for a debugger. The three entries that change what
 * a reader may conclude are `clampedPositions` (unobserved credits exist),
 * `unpricedShareOfTotal` (how much of the treasury has no price at this date)
 * and `carriedForwardWallets` (holdings that were not walked back at all).
 */
export interface ReconstructionMeta {
  method: "transfer-walkback";
  /** The day these balances are as of — the reconstructed period's last day. */
  asOf: string;
  /** The day of the LIVE reading this chain of walk-backs started from. */
  observedAsOf: string;
  /**
   * How many walk-back steps separate this row from the observed reading.
   * 1 means "walked back once, from the live read". Error compounds with each
   * step, so this is the reader's guide to how much weight the row can take.
   */
  stepsFromObserved: number;
  /** Legs the walk-back applied. */
  legsApplied: number;
  /** Legs skipped as unusable (no wallet, no token identity, no amount). */
  legsIgnored: number;
  /** Token positions in the reconstructed result. */
  positions: number;
  /** Positions whose quantity the walk-back actually changed. */
  positionsChanged: number;
  /** Positions with no legs this period — carried at the same quantity. */
  positionsCarriedForward: number;
  /**
   * Positions that exist ONLY at `t−1`: held then, fully disposed of by `t`,
   * so absent from the newer balances and materialised entirely out of legs.
   */
  positionsCreated: number;
  /** Positions whose walk-back went negative and was clamped to zero. */
  clampedPositions: number;
  /**
   * Total token units clamped away, summed across positions.
   *
   * DIMENSIONLESS BY CONSTRUCTION — 1 BTC and 1 PEPE both add 1. It is a
   * magnitude for a single position and a rough activity signal across many;
   * `clampedUsd` is the comparable figure and `clamps` carries the per-position
   * detail. Kept because the brief for this stage asks for a count and a
   * magnitude, and because it is available before any price is.
   */
  clampedQtyTotal: number;
  /** `clampedQtyTotal` in USD at this date. Null until priced; excludes unpriced clamps. */
  clampedUsd: number | null;
  /** Per-position clamp detail, largest first, capped at `MAX_CLAMP_SAMPLES`. */
  clamps: ReconstructionClamp[];
  /** Positions holding a positive quantity that could not be priced at this date. */
  unpricedPositions: number;
  /** Their symbols, deduped and capped. */
  unpricedSymbols: string[];
  /**
   * Roughly how much of the treasury the unpriced positions represent, 0-1.
   *
   * The denominator is a PROXY and must be read as one: an unpriced position
   * has no USD by definition, so it is sized using the price recorded in the
   * snapshot the walk-back started from. That is an estimate of the size of the
   * hole, never a value written into a column. Null when no proxy price exists
   * either.
   */
  unpricedShareOfTotal: number | null;
  /** Wallets carried forward unchanged because no transfer feed covers them. */
  carriedForwardWallets: CarriedForwardWallet[];
  /** The honesty-ledger lines that actually apply to THIS reconstruction. */
  notes: string[];
}

/** One reconstructed wallet, before pricing. */
export interface ReconstructedWallet {
  walletAddress: string;
  chain: string;
  tokens: {
    symbol: string;
    name: string;
    amount: number;
    contractAddress: string | null;
    /** The price recorded in the source snapshot. Sizing proxy only — never written. */
    sourcePriceUsd: number;
  }[];
}

export interface ReconstructionResult {
  wallets: ReconstructedWallet[];
  meta: ReconstructionMeta;
}

/** The finished article: `balances_detail` plus the columns a snapshot needs. */
export interface PricedReconstruction {
  totalBalanceUsd: number;
  stablecoinsUsd: number;
  ethUsd: number;
  nativeTokenUsd: number;
  otherAssetsUsd: number;
  balancesDetail: {
    walletAddress: string;
    chain: string;
    tokens: {
      symbol: string;
      name: string;
      amount: number;
      priceUsd: number;
      valueUsd: number;
      contractAddress: string | null;
    }[];
    totalUsd: number;
    stablecoinsUsd: number;
    ethUsd: number;
    nativeTokenUsd: number;
    otherAssetsUsd: number;
  }[];
  meta: ReconstructionMeta;
}

/**
 * Per-position clamp rows kept in the meta blob. Enough to name the offenders
 * in a caveat; not so many that a treasury holding a thousand rebasing dust
 * positions writes a megabyte of JSONB.
 */
const MAX_CLAMP_SAMPLES = 10;

/** Same reasoning for the unpriced symbol list. */
const MAX_UNPRICED_SYMBOLS = 15;

// ─── small readers ─────────────────────────────────────────────────────────

/** Finite number or 0. Strings are accepted because `numeric` columns arrive as strings. */
function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Token identity, and it is EXACTLY `composeTreasury`'s rule: contract address
 * first, lowercased; the uppercased symbol as the fallback; scoped by chain.
 *
 * Two keying schemes over the same holdings is not a style difference — it
 * silently mis-attributes a position. A treasury really does hold spam spoofing
 * real tickers (see `isOwnToken` in treasury-composition.ts), so symbol-first
 * keying would let a counterfeit USDC absorb the genuine position's transfers
 * and walk the real balance back to something that never existed.
 */
function tokenKey(
  chain: string,
  symbol: string,
  contractAddress: string | null
): string {
  const address = contractAddress ? contractAddress.toLowerCase() : "";
  return `${chain}:${address || symbol.toUpperCase()}`;
}

/**
 * The weaker, storage-format-independent identity: what `tokenKey` would have
 * returned had no contract been recorded.
 *
 * It exists because the two sides of this arithmetic come from DIFFERENT
 * providers. `balances_detail` gets its contract from Dune Sim; a transfer leg
 * gets its contract from Alchemy, and a native-asset leg (plain ETH, or an
 * `internal` call) has none at all while Dune still names the asset. Keying on
 * the strong form alone would file the ETH balance and the ETH transfers as two
 * unrelated positions — the balance would never be walked back, and the
 * transfers would materialise a phantom second ETH position out of nothing.
 * Same failure, same fix, as the alias matching in treasury-attribution.ts.
 *
 * Empty when there is no symbol, which callers must read as "no alias".
 */
function tokenFallbackKey(chain: string, symbol: string): string {
  return symbol ? `${chain}:${symbol.toUpperCase()}` : "";
}

function walletKey(chain: string, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

interface Position {
  key: string;
  fallbackKey: string;
  chain: string;
  wallet: string;
  symbol: string;
  name: string;
  contractAddress: string | null;
  /** Quantity at `t` — the known end of the newer period. */
  qtyCurr: number;
  inbound: number;
  outbound: number;
  legs: number;
  /** True when this position exists only because of legs (gone by `t`). */
  created: boolean;
  sourcePriceUsd: number;
}

interface WalletBucket {
  chain: string;
  address: string;
  positions: Map<string, Position>;
  /** `chain:SYMBOL` → canonical key. Absent when two positions share a symbol. */
  aliases: Map<string, string>;
  /** Symbols seen more than once, so their alias is ambiguous and unusable. */
  ambiguousSymbols: Set<string>;
}

function registerAlias(bucket: WalletBucket, position: Position) {
  if (!position.fallbackKey) return;
  if (bucket.ambiguousSymbols.has(position.fallbackKey)) return;
  const existing = bucket.aliases.get(position.fallbackKey);
  if (existing !== undefined && existing !== position.key) {
    // Two different contracts calling themselves the same thing. Neither may
    // claim the alias — resolving through it would attribute one token's
    // transfers to the other, which on a spoofed ticker is a fabricated
    // balance rather than a rounding error.
    bucket.aliases.delete(position.fallbackKey);
    bucket.ambiguousSymbols.add(position.fallbackKey);
    return;
  }
  bucket.aliases.set(position.fallbackKey, position.key);
}

// ─── the walk-back ─────────────────────────────────────────────────────────

export interface ReconstructInput {
  /** `balances_detail`-shaped holdings at the END of the period being walked back. */
  balances: unknown;
  /** Every transfer leg INSIDE that period, for every tracked wallet. */
  transfers: readonly ReconstructionTransfer[] | null | undefined;
  /** The day the reconstructed balances are as of — the previous period's last day. */
  asOf: string;
  /** The day of the live reading this chain started from. */
  observedAsOf: string;
  /** 1 for the first walk-back off the live read, 2 for the next, and so on. */
  stepsFromObserved: number;
  /**
   * Wallets with no usable transfer feed — Solana in v1. Their holdings are
   * carried forward unchanged and the wallet is disclosed in the meta.
   */
  carriedForwardWallets?: readonly CarriedForwardWallet[];
}

/**
 * Walks one period's balances back to the start of that period.
 *
 * Returns QUANTITIES ONLY. Pricing is a separate, impure step — see the header
 * and `priceReconstruction`.
 *
 * Positions are materialised from three sources and all three matter:
 *   • present at `t` and touched by legs — the ordinary case;
 *   • present at `t` and untouched — carried forward at the same quantity,
 *     which is the CORRECT answer, not a fallback: no transfers means no
 *     quantity change (modulo the unobservable credits in the header);
 *   • absent at `t` but referenced by legs — a position fully disposed of
 *     during the period. `qty(t−1) = 0 − inbound + outbound`, which is
 *     positive exactly when more left than arrived. Omitting this case is the
 *     easiest way to under-report a past treasury, because the tokens a team
 *     spent are precisely the ones missing from today's balance.
 */
export function reconstructBalances(
  input: ReconstructInput
): ReconstructionResult {
  const buckets = new Map<string, WalletBucket>();
  const carriedForwardKeys = new Set<string>();
  for (const w of input.carriedForwardWallets ?? []) {
    if (!w) continue;
    carriedForwardKeys.add(walletKey(str(w.chain), str(w.address)));
  }

  // 1. Seed from the known (newer) balances.
  const balances = Array.isArray(input.balances)
    ? (input.balances as StoredWallet[])
    : [];
  for (const wallet of balances) {
    if (!wallet || typeof wallet !== "object") continue;
    const chain = str(wallet.chain);
    const address = str(wallet.walletAddress);
    const wk = walletKey(chain, address);
    let bucket = buckets.get(wk);
    if (!bucket) {
      bucket = {
        chain,
        address,
        positions: new Map(),
        aliases: new Map(),
        ambiguousSymbols: new Set(),
      };
      buckets.set(wk, bucket);
    }
    if (!Array.isArray(wallet.tokens)) continue;

    for (const token of wallet.tokens) {
      if (!token || typeof token !== "object") continue;
      const symbol = str(token.symbol);
      const contractAddress = str(token.contractAddress) || null;
      if (!symbol && !contractAddress) continue;
      const key = tokenKey(chain, symbol, contractAddress);
      const amount = num(token.amount);

      const existing = bucket.positions.get(key);
      if (existing) {
        // Same token twice in one wallet's payload. Sum rather than overwrite —
        // the alternative silently discards half a position.
        existing.qtyCurr += amount;
        if (existing.sourcePriceUsd === 0) {
          existing.sourcePriceUsd = num(token.priceUsd);
        }
        continue;
      }
      const position: Position = {
        key,
        fallbackKey: tokenFallbackKey(chain, symbol),
        chain,
        wallet: address,
        symbol,
        name: str(token.name) || symbol,
        contractAddress,
        qtyCurr: amount,
        inbound: 0,
        outbound: 0,
        legs: 0,
        created: false,
        sourcePriceUsd: num(token.priceUsd),
      };
      bucket.positions.set(key, position);
      registerAlias(bucket, position);
    }
  }

  // 2. Fold in the period's legs.
  let legsApplied = 0;
  let legsIgnored = 0;
  const legs = Array.isArray(input.transfers) ? input.transfers : [];
  for (const leg of legs) {
    if (!leg || typeof leg !== "object") {
      legsIgnored++;
      continue;
    }
    const chain = str(leg.chain);
    const wallet = str(leg.wallet);
    const symbol = str(leg.symbol);
    const contractAddress = str(leg.contractAddress) || null;
    const amount = num(leg.amount);
    const direction = leg.direction === "in" || leg.direction === "out" ? leg.direction : null;
    // A leg with no wallet cannot be attributed, a leg with no identity cannot
    // be keyed, a leg with no direction has no sign, and a non-positive amount
    // is either a no-op or corrupt. All four are counted rather than dropped
    // silently, because a large `legsIgnored` is itself a finding.
    if (!wallet || (!symbol && !contractAddress) || !direction || !(amount > 0)) {
      legsIgnored++;
      continue;
    }

    const wk = walletKey(chain, wallet);
    // A carried-forward wallet has no usable feed BY DEFINITION; anything that
    // reaches here for one would be applied against holdings that were never
    // walked back, producing a half-reconstructed position.
    if (carriedForwardKeys.has(wk)) {
      legsIgnored++;
      continue;
    }

    let bucket = buckets.get(wk);
    if (!bucket) {
      // A tracked wallet that holds nothing today but moved money during the
      // period. It held something at t−1.
      bucket = {
        chain,
        address: wallet,
        positions: new Map(),
        aliases: new Map(),
        ambiguousSymbols: new Set(),
      };
      buckets.set(wk, bucket);
    }

    const key = tokenKey(chain, symbol, contractAddress);
    let position = bucket.positions.get(key);
    if (!position) {
      const alias = tokenFallbackKey(chain, symbol);
      const aliasedKey = alias ? bucket.aliases.get(alias) : undefined;
      const candidate = aliasedKey ? bucket.positions.get(aliasedKey) : undefined;
      // The alias resolves a SYMBOL to a position, so it must only be consulted
      // where the symbol is the best identity either side has. When this leg
      // carries a contract AND the position it would resolve to carries a
      // DIFFERENT one, both sides have named the asset unambiguously and they
      // disagree — that is a definitive non-match, exactly as `isOwnToken` in
      // treasury-composition.ts treats it, and the symbol gets no vote.
      //
      // Without this guard the alias reintroduces the very failure this
      // module's `tokenKey` comment says it exists to prevent: a counterfeit
      // token spoofing a real ticker resolves onto the genuine position and
      // walks its balance back to a quantity that never existed. The fixture
      // treasury holds exactly that kind of spam.
      //
      // A position with NO contract still matches: there the position side is
      // ambiguous (Dune did not record one), so the symbol is the only
      // identity available and the alias is doing its intended job.
      if (candidate && (!contractAddress || !candidate.contractAddress)) {
        position = candidate;
      }
    }
    if (!position) {
      position = {
        key,
        fallbackKey: tokenFallbackKey(chain, symbol),
        chain,
        wallet,
        symbol,
        name: symbol,
        contractAddress,
        qtyCurr: 0,
        inbound: 0,
        outbound: 0,
        legs: 0,
        created: true,
        sourcePriceUsd: 0,
      };
      bucket.positions.set(key, position);
      registerAlias(bucket, position);
    }

    if (direction === "in") position.inbound += amount;
    else position.outbound += amount;
    position.legs++;
    legsApplied++;
  }

  // 3. Apply the arithmetic, clamp, and account for it.
  const wallets: ReconstructedWallet[] = [];
  const clamps: ReconstructionClamp[] = [];
  let positions = 0;
  let positionsChanged = 0;
  let positionsCarriedForward = 0;
  let positionsCreated = 0;
  let clampedQtyTotal = 0;

  for (const bucket of buckets.values()) {
    const tokens: ReconstructedWallet["tokens"] = [];
    for (const p of bucket.positions.values()) {
      positions++;
      if (p.legs === 0) {
        positionsCarriedForward++;
      } else {
        positionsChanged++;
      }
      if (p.created) positionsCreated++;

      // The one line this module exists for.
      let qtyPrev = p.qtyCurr - p.inbound + p.outbound;
      if (qtyPrev < 0) {
        const shortfall = -qtyPrev;
        clampedQtyTotal += shortfall;
        clamps.push({
          chain: p.chain,
          wallet: p.wallet,
          symbol: p.symbol || "unknown",
          contractAddress: p.contractAddress,
          shortfall,
          shortfallUsd: null,
        });
        qtyPrev = 0;
      }

      // A position that walks back to exactly zero held nothing at t−1. Drop
      // it rather than storing a 0-quantity row: `composeTreasury` skips
      // non-positive values anyway, and a zero row in `balances_detail` would
      // show up in month-over-month as a token that "appeared" the next period.
      if (!(qtyPrev > 0)) continue;

      tokens.push({
        symbol: p.symbol || "unknown",
        name: p.name || p.symbol || "unknown",
        amount: qtyPrev,
        contractAddress: p.contractAddress,
        sourcePriceUsd: p.sourcePriceUsd,
      });
    }
    // A wallet with nothing left at t−1 still belongs in the payload: dropping
    // it makes `treasury-attribution.ts` read the NEXT period as "a wallet
    // joined coverage", which it explicitly must never report as an inflow.
    wallets.push({
      walletAddress: bucket.address,
      chain: bucket.chain,
      tokens,
    });
  }

  clamps.sort((a, b) => b.shortfall - a.shortfall);

  const notes: string[] = [
    "Balances are reconstructed, not observed: quantities are today's holdings walked back through this period's transfer history, and USD values are priced at the period's own close.",
  ];
  if (clamps.length > 0) {
    notes.push(
      `${clamps.length} token position(s) walked back below zero and were clamped to zero. A negative walk-back is the visible signal of a credit this reconstruction cannot see — rebasing, staking accrual, a mint, or a transfer type the provider does not serve — so the reconstructed quantity for those positions is a FLOOR, not an estimate.`
    );
  }
  if ((input.carriedForwardWallets?.length ?? 0) > 0) {
    notes.push(
      `${input.carriedForwardWallets?.length} wallet(s) have no usable transfer feed and are carried at their present holdings. Their figures are NOT reconstructed and must not be read as a measurement of this period.`
    );
  }
  if (input.stepsFromObserved > 1) {
    notes.push(
      `These balances are ${input.stepsFromObserved} walk-back steps from the observed reading of ${input.observedAsOf}. Each step compounds the error of the one before it.`
    );
  }
  notes.push(
    "Native-token gas spend is not a transfer and is therefore invisible to this walk-back, so a native balance reconstructed here is understated by the gas burned in the period."
  );

  return {
    wallets,
    meta: {
      method: "transfer-walkback",
      asOf: input.asOf,
      observedAsOf: input.observedAsOf,
      stepsFromObserved: input.stepsFromObserved,
      legsApplied,
      legsIgnored,
      positions,
      positionsChanged,
      positionsCarriedForward,
      positionsCreated,
      clampedPositions: clamps.length,
      clampedQtyTotal,
      clampedUsd: null,
      clamps: clamps.slice(0, MAX_CLAMP_SAMPLES),
      unpricedPositions: 0,
      unpricedSymbols: [],
      unpricedShareOfTotal: null,
      carriedForwardWallets: [...(input.carriedForwardWallets ?? [])],
      notes,
    },
  };
}

// ─── pricing ───────────────────────────────────────────────────────────────

/**
 * Every symbol the caller has to resolve a historical price for, uppercased and
 * deduped — the input to `getHistoricalPrice` (price-resolver.ts).
 *
 * Uppercase because that is what `getHistoricalPrice` normalises to, and the
 * map handed back to `priceReconstruction` has to key the same way.
 */
export function reconstructionSymbols(
  result: ReconstructionResult
): string[] {
  const seen = new Set<string>();
  for (const wallet of result.wallets) {
    for (const token of wallet.tokens) {
      const symbol = token.symbol.trim().toUpperCase();
      if (symbol && symbol !== "UNKNOWN") seen.add(symbol);
    }
  }
  return [...seen];
}

/**
 * Puts USD on a reconstructed set of quantities, AT THE RECONSTRUCTION DATE.
 *
 * WHY HISTORICAL PRICING RATHER THAN LEAVING THE ROW UNPRICED. A snapshot with
 * no USD is not a neutral abstention: `total_balance_usd` is the report's
 * headline, the dashboard tile and the month-over-month denominator, and a
 * NULL or zero there renders as a treasury that was empty — a louder false
 * statement than any estimate. The machinery already exists and is already
 * trusted for exactly this: `transferToRaw` prices every transfer at its own
 * block timestamp through the same resolver, and the resolved prices persist in
 * `token_prices`, so a reconstructed month and the transactions inside it are
 * denominated identically.
 *
 * WHAT IS NOT ALLOWED, AND IS THE WHOLE POINT: a token that cannot be priced at
 * this date is left at `priceUsd: 0` and counted in `unpricedPositions` /
 * `unpricedShareOfTotal`. It is NEVER valued at today's price. Carrying today's
 * price backwards is the precise bug this stage exists to remove, and it would
 * be indistinguishable from the old behaviour for exactly the tokens most
 * likely to have moved.
 *
 * `prices` maps UPPERCASE symbol → USD, with `null` for "no price at this date".
 * Missing keys are treated as null.
 */
export function priceReconstruction(
  result: ReconstructionResult,
  prices: ReadonlyMap<string, number | null>,
  identity: ProjectTokenIdentity | null | undefined
): PricedReconstruction {
  const unpricedSymbols = new Set<string>();
  let unpricedPositions = 0;
  let unpricedProxyUsd = 0;
  let pricedUsd = 0;

  const balancesDetail: PricedReconstruction["balancesDetail"] = [];

  for (const wallet of result.wallets) {
    const tokens = wallet.tokens.map((token) => {
      const symbol = token.symbol.trim().toUpperCase();
      const resolved = prices.get(symbol);
      const priceUsd =
        typeof resolved === "number" && Number.isFinite(resolved) && resolved > 0
          ? resolved
          : 0;
      const valueUsd = priceUsd > 0 ? token.amount * priceUsd : 0;
      if (priceUsd > 0) {
        pricedUsd += valueUsd;
      } else if (token.amount > 0) {
        unpricedPositions++;
        if (symbol) unpricedSymbols.add(symbol);
        // Sizing proxy only — see `unpricedShareOfTotal`. Never written.
        unpricedProxyUsd += token.amount * token.sourcePriceUsd;
      }
      return {
        symbol: token.symbol,
        name: token.name,
        amount: token.amount,
        priceUsd,
        valueUsd,
        contractAddress: token.contractAddress,
      };
    });

    // The four per-wallet columns go through the SAME classifier every other
    // surface uses, so a reconstructed wallet and an observed one are bucketed
    // by one predicate rather than two. See treasury-composition.ts.
    const buckets = composeTreasury([{ chain: wallet.chain, tokens }], identity);
    const legacy = bucketsToLegacyColumns(buckets);
    balancesDetail.push({
      walletAddress: wallet.walletAddress,
      chain: wallet.chain,
      tokens,
      totalUsd: tokens.reduce((sum, t) => sum + t.valueUsd, 0),
      ...legacy,
    });
  }

  const project = composeTreasury(balancesDetail, identity);
  const projectLegacy = bucketsToLegacyColumns(project);

  // Clamp shortfalls in USD, using the same resolved prices. Excludes clamps on
  // unpriced tokens rather than valuing them at zero — a zero would read as
  // "nothing was clamped", which is the opposite of what happened.
  let clampedUsd: number | null = null;
  const clamps = result.meta.clamps.map((clamp) => {
    const resolved = prices.get(clamp.symbol.trim().toUpperCase());
    const price =
      typeof resolved === "number" && Number.isFinite(resolved) && resolved > 0
        ? resolved
        : null;
    if (price === null) return { ...clamp, shortfallUsd: null };
    const shortfallUsd = clamp.shortfall * price;
    clampedUsd = (clampedUsd ?? 0) + shortfallUsd;
    return { ...clamp, shortfallUsd };
  });

  const proxyTotal = pricedUsd + unpricedProxyUsd;

  const notes = [...result.meta.notes];
  if (unpricedPositions > 0) {
    notes.push(
      `${unpricedPositions} position(s) have no price feed at ${result.meta.asOf} and are carried at zero USD. They are NOT valued at today's price, so every USD total on this row EXCLUDES them and is a floor.`
    );
  }

  return {
    totalBalanceUsd: balancesDetail.reduce((sum, w) => sum + w.totalUsd, 0),
    ...projectLegacy,
    balancesDetail,
    meta: {
      ...result.meta,
      clamps,
      clampedUsd,
      unpricedPositions,
      unpricedSymbols: [...unpricedSymbols].slice(0, MAX_UNPRICED_SYMBOLS),
      unpricedShareOfTotal:
        proxyTotal > 0 ? unpricedProxyUsd / proxyTotal : null,
      notes,
    },
  };
}

/**
 * Above this share of the treasury being unpriceable at the reconstruction
 * date, a snapshot is excluded from month-over-month rather than
 * disclosed-and-used.
 *
 * A caveat scales with the reader's attention, not with the size of the error.
 * At 5% unpriced, "these totals are a floor" is a caveat a reader can hold in
 * their head next to the number. At 40% the number is not a treasury total with
 * a caveat attached — it is a different quantity wearing the same label, and no
 * sentence placed near it prevents the comparison from being drawn. The line
 * has to sit somewhere; 20% is where the plan put it.
 */
export const MAX_UNPRICED_SHARE_FOR_COMPARISON = 0.2;
