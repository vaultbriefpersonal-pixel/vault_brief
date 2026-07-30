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
 */
export function buildTransactionSample<T extends SampleableTransaction>(
  allTx: readonly T[]
): TransactionSampleResult<T> {
  const legs = Array.isArray(allTx) ? dedupe(allTx) : [];
  const legCount = legs.length;

  const topByValue = [...legs]
    .sort((a, b) => Math.abs(num(b.valueUsd)) - Math.abs(num(a.valueUsd)))
    .slice(0, TOP_VALUE_SAMPLE_SIZE);
  const mostRecent = [...legs]
    .sort((a, b) => num(b.timestamp) - num(a.timestamp))
    .slice(0, RECENT_SAMPLE_SIZE);

  const sample = dedupe([...topByValue, ...mostRecent]);

  return {
    sample,
    capped: sample.length < legCount,
    legCount,
    basis: TRANSACTION_SAMPLE_BASIS,
  };
}
