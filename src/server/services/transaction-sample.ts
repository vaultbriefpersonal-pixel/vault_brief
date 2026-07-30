// Chooses which transfer legs of a period get persisted onto
// `treasury_snapshots.transactions_raw`, and says honestly whether anything
// was left out.
//
// Extracted out of data-sync.ts for one reason: data-sync.ts imports
// `@/server/db`, so nothing in it can be unit-tested without a database. The
// sampling rule is the part that was wrong in production and the part that
// needs regression tests, so it lives here, pure and import-free.
//
// ─── What "one transaction" is not ─────────────────────────────────────────
//
// `fetchAndClassify` returns one element per transfer LEG, not per
// transaction. A single on-chain transaction routinely produces several:
// a batch distribution to eight recipients, both sides of a swap, a transfer
// between two wallets this project tracks (returned once by the `fromAddress`
// query and once by the `toAddress` query). All of them share `hash`.
//
// This module deduped on `hash` alone until 2026-07. On the June 2026
// Uniswap Governance Timelock snapshot that collapsed eight UNI legs —
// 12,500,001.188 UNI, the entire month's inflow — into one leg worth
// $7.55M, while `total_inflows_usd` (computed elsewhere, over the
// un-deduped list) correctly read $37.77M. $30.2M of real inflow was
// dropped from the stored sample and nothing downstream could tell.
//
// So the dedup key is Alchemy's `uniqueId` (`hash:log:N`) — the only
// identifier that is per-leg — falling back to a composite when it is
// absent. Aggregating legs into transactions is deliberately NOT done here:
// a write-time aggregate permanently destroys per-recipient detail that no
// later question can recover. Aggregation is a presentation concern and
// lives in major-transactions.ts.

import { STABLECOIN_SYMBOLS } from "@/lib/chains";

/**
 * The subset of a transaction row this module needs. Both `RawTransaction`
 * and `ClassifiedTransaction` (expense-classifier.ts) satisfy it structurally;
 * the shape is restated rather than imported because that module opens with
 * `import OpenAI from "openai"`.
 */
export interface SampleableTransaction {
  /**
   * Alchemy's per-leg identifier, `hash:log:N`. Optional: Solana rows and
   * every row written before 2026-07 have none.
   */
  uniqueId?: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  token: string;
  valueUsd: number;
  timestamp: number;
  direction: "in" | "out";
  /** True when no historical price could be resolved for this leg. Absent on legacy rows. */
  priceUnknown?: boolean;
}

export interface TransactionSampleResult<T> {
  /** The legs to persist. Deduped, in no particular order. */
  sample: T[];
  /**
   * True ONLY when a leg the sync saw could not fit in the sample budget.
   * Dedup can never set this — see `buildTransactionSample`.
   */
  capped: boolean;
  /** Distinct transfer legs the sync saw, after dedup. */
  legCount: number;
  /** Machine-stable description of how the sample was chosen. */
  basis: string;
}

/** Largest-by-value slice: a big transfer is worth keeping whenever it happened. */
export const TOP_VALUE_SAMPLE_SIZE = 50;

/** Most-recent slice: keeps "what happened lately" answerable. */
export const RECENT_SAMPLE_SIZE = 150;

/**
 * Stored on the envelope as `sampleBasis` so a report generated years from
 * now can state how its rows were selected instead of guessing. Change this
 * string only when the selection rule itself changes.
 */
export const TRANSACTION_SAMPLE_BASIS =
  "top-50-by-value + 150-most-recent, per transfer leg";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Threshold for flagging a suspiciously-cheap inbound transfer as spam. Kept
 * as a LOCAL literal rather than importing DUST_FLOOR_USD from
 * treasury-composition.ts, to avoid coupling this file's sampling concern to
 * that file's holding-classification concern. Asserted equal to
 * DUST_FLOOR_USD in transaction-sample.test.ts so the two cannot drift
 * silently — same discipline as EXCLUDED_CATEGORIES in major-transactions.ts.
 */
const SPAM_DUST_FLOOR_USD = 100;

/**
 * A transfer leg that looks like unsolicited spam rather than a real event:
 * inbound, and either unpriceable or worth less than the dust floor.
 *
 * Stablecoins are exempt at ANY value or price state — Dune Sim's `pool_size`
 * field looked like a spam signal and was rejected (see treasury-composition.ts's
 * header) specifically because it was absent for USDC/USDT while present for
 * real spam; this predicate must not reintroduce that same false positive by a
 * different route. A $5 USDC transfer is real, tiny income, never spam.
 *
 * Outbound legs are never suspects: this treasury sending value out is never
 * unsolicited by definition.
 */
export function isSpamSuspect(tx: SampleableTransaction): boolean {
  if (tx.direction !== "in") return false;
  const symbol = str(tx.token).trim().toUpperCase();
  if (STABLECOIN_SYMBOLS.has(symbol)) return false;
  return tx.priceUnknown === true || Math.abs(num(tx.valueUsd)) < SPAM_DUST_FLOOR_USD;
}

/**
 * The dedup key, in strict precedence order:
 *
 *   1. `uniqueId` — Alchemy's own per-leg identifier. Two rows carrying the
 *      same one ARE the same leg, whichever query returned them.
 *   2. `hash|direction|token|from|to|value` — for Solana (Helius has no
 *      equivalent id) and for legacy rows written before `uniqueId` was
 *      captured. Every component is needed: eight legs of one batch share
 *      hash, direction, token and sender, and differ only in recipient and
 *      amount.
 *
 * The two forms are prefixed differently so a composite key can never
 * collide with a `uniqueId`. `hash` is lowercased (hex is case-insensitive);
 * addresses are NOT, because Solana addresses are base58 and case-carrying.
 */
export function transactionLegKey(tx: SampleableTransaction): string {
  const uniqueId = str(tx.uniqueId).trim();
  if (uniqueId) return `uid:${uniqueId.toLowerCase()}`;
  return [
    "leg",
    str(tx.hash).toLowerCase(),
    str(tx.direction),
    str(tx.token).toUpperCase(),
    str(tx.from),
    str(tx.to),
    str(tx.value),
  ].join("|");
}

function dedupe<T extends SampleableTransaction>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const key = transactionLegKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Pick the legs to persist: the union of the 50 largest by absolute USD value
 * and the 150 most recent.
 *
 * Capping the blob is what keeps a snapshot row at ~60KB instead of 1MB+, and
 * the union (rather than recency alone) is what stops a genuinely large
 * transfer early in a busy period from being invisible to the report forever
 * — that section only ever sees this stored sample.
 *
 * `capped` compares the sample against `legCount`, which is itself
 * post-dedup. That is the whole point: dedup shrinks both sides equally and
 * therefore cannot set the flag, so `capped: true` means one thing only —
 * a leg the sync saw did not fit. (The comparison is `sample.length <
 * legCount` rather than `legCount > 200`, because the two slices can overlap:
 * 200 legs whose largest are also its newest still leave some leg in neither
 * slice, and that IS truncation.)
 *
 * Both sorts deprioritise `isSpamSuspect` legs first, value/recency second: a
 * spam suspect can never occupy a slot ahead of a non-suspect leg, regardless
 * of its nominal value or recency, and only fills a slot once no non-suspect
 * leg is left contesting it. This is what stops a burst of unsolicited spam
 * transfers (the AQ0/ZIK airdrops, `valueUsd: 0, priceUnknown: true`) from
 * displacing real transfers out of the stored sample — the failure mode this
 * module's header describes as a storage problem, not just a display one.
 */
export function buildTransactionSample<T extends SampleableTransaction>(
  allTx: readonly T[]
): TransactionSampleResult<T> {
  const legs = Array.isArray(allTx) ? dedupe(allTx) : [];
  const legCount = legs.length;

  const topByValue = [...legs]
    .sort((a, b) => {
      const aSpam = isSpamSuspect(a);
      const bSpam = isSpamSuspect(b);
      if (aSpam !== bSpam) return aSpam ? 1 : -1;
      return Math.abs(num(b.valueUsd)) - Math.abs(num(a.valueUsd));
    })
    .slice(0, TOP_VALUE_SAMPLE_SIZE);
  const mostRecent = [...legs]
    .sort((a, b) => {
      const aSpam = isSpamSuspect(a);
      const bSpam = isSpamSuspect(b);
      if (aSpam !== bSpam) return aSpam ? 1 : -1;
      return num(b.timestamp) - num(a.timestamp);
    })
    .slice(0, RECENT_SAMPLE_SIZE);

  const sample = dedupe([...topByValue, ...mostRecent]);

  return {
    sample,
    capped: sample.length < legCount,
    legCount,
    basis: TRANSACTION_SAMPLE_BASIS,
  };
}
