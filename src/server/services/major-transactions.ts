// Picks the handful of transactions from a snapshot that an investor would
// actually want named, out of the `treasury_snapshots.transactions_raw` blob
// that data-sync.ts has been writing on every sync and nothing has ever read.
//
// Like treasury-attribution.ts and counterparty-labels.ts, this derives
// everything from data already on the row — no sync-time pipeline, no schema
// column, no backfill. Every snapshot already in the database gets the section
// retroactively.
//
// Dependency discipline, same as those two files: the ONLY import permitted
// here is `./counterparty-labels`, itself import-free. No `@/server/db`, no
// `openai`, no `node:*`, no `process.env`. report-sections.ts imports this, and
// report-sections.ts is imported by ReportTemplateEditor.tsx which is
// "use client" — so anything reachable from here ships to the browser. A
// server-only import would break `npm run build` in a way that is tedious to
// trace back to this line.
//
// ─── The sampling caveat, stated once, here ────────────────────────────────
//
// data-sync.ts stores the 200 MOST RECENT transactions, not the 200 largest:
//
//     const sampledTx = [...allTx].sort((a, b) => b.timestamp - a.timestamp)
//                                 .slice(0, TX_SAMPLE_SIZE);
//
// So "the largest transactions" is only ever "the largest among the most
// recent N". When the sync capped the list, a transaction bigger than
// everything below may sit outside the sample entirely, and this module has no
// way to know. `capped` carries that fact out to the caller so the report can
// say so out loud. Changing the sampling would only help snapshots taken after
// the change and cannot repair a single row already written — the honest fix
// is disclosure, not a silently different sort.
//
// Everything here is defensive: `transactionsRaw` spans two stored shapes
// (the current object with metadata, and a legacy bare array), plus rows
// written before `priceUnknown` existed, plus whatever a hand-edited or
// half-migrated JSONB payload happens to contain. Nothing in this file throws.

import { labelCounterparty } from "./counterparty-labels";

/** One row of the Major Transactions table. Every field is render-ready. */
export interface MajorTransaction {
  hash: string;
  /** Epoch milliseconds, as stored. 0 when the payload had no usable timestamp. */
  timestamp: number;
  /** 'YYYY-MM-DD', or an empty string when the timestamp was unusable. */
  date: string;
  direction: "in" | "out";
  /** Absolute USD value. Always finite and > 0 — zero-value rows never qualify. */
  valueUsd: number;
  /** Asset symbol as recorded at sync time, uppercased. "UNKNOWN" when absent. */
  token: string;
  /** Classifier category verbatim (`payroll`, `revenue`, …). "" when absent. */
  category: string;
  /** The other side of the transfer: `to` for outflows, `from` for inflows. */
  counterpartyAddress: string;
  /** Known name ("Binance") or a truncated address ("0x1234…abcd"). */
  counterparty: string;
  /** True when `counterparty` is a recognised name rather than an address. */
  counterpartyKnown: boolean;
}

export interface MajorTransactionsResult {
  /** Qualifying transactions, largest USD value first. At most `MAX_ROWS`. */
  rows: MajorTransaction[];
  /**
   * True when the stored transaction list was a capped sample of a larger
   * set. Rows are then "largest among the most recent N", NOT "largest of the
   * period" — the report MUST disclose this. See the header.
   */
  capped: boolean;
  /** The USD floor a transaction had to clear. */
  thresholdUsd: number;
  /** How many transactions cleared the threshold before the row cap applied. */
  qualifyingCount: number;
  /** Transactions in the stored sample (post-exclusions denominator context). */
  sampleSize: number;
  /** Total transactions the sync saw, when the payload recorded it. */
  totalCount: number | null;
}

/** Absolute floor. Below this a transfer is not "major" for any treasury. */
export const MIN_THRESHOLD_USD = 25_000;

/** Relative floor: 0.5% of the treasury. Scales the section to the project. */
export const THRESHOLD_TREASURY_FRACTION = 0.005;

/**
 * Row cap. A table an investor reads in one glance, not an audit log — and a
 * hard bound on how much of the prompt budget this section can eat.
 */
export const MAX_ROWS = 8;

/**
 * Categories that are never events in their own right. An internal transfer is
 * a treasury moving money between wallets it already owns (hot → cold, ops
 * multisig → payroll multisig); reporting it as a transaction implies value
 * left or arrived when the treasury total did not move at all.
 *
 * Literal rather than an import of INTERNAL_TRANSFER_CATEGORY: that constant
 * lives in expense-classifier.ts, which imports the OpenAI SDK at module top.
 * The value is asserted against the classifier's export in the tests, so the
 * two cannot drift silently.
 */
const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set(["internal_transfer"]);

/** Shape of one stored row. Every field optional — legacy payloads vary. */
interface StoredTransaction {
  hash?: unknown;
  from?: unknown;
  to?: unknown;
  token?: unknown;
  valueUsd?: unknown;
  timestamp?: unknown;
  direction?: unknown;
  category?: unknown;
  priceUnknown?: unknown;
}

/** Current stored shape, written by data-sync.ts. */
interface StoredTransactionsEnvelope {
  sample?: unknown;
  totalCount?: unknown;
  capped?: unknown;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The USD floor for this treasury: the larger of a flat $25K and 0.5% of the
 * total. The flat floor stops a $200K treasury from calling every $1K transfer
 * major; the relative floor stops a $2B treasury from listing rounding errors.
 * A missing or nonsense total falls back to the flat floor rather than to zero.
 */
export function majorTransactionThreshold(totalTreasuryUsd: number): number {
  const total = num(totalTreasuryUsd);
  return Math.max(MIN_THRESHOLD_USD, total * THRESHOLD_TREASURY_FRACTION);
}

/**
 * `0x1234…abcd` — enough of both ends that a reader can match it against an
 * explorer, short enough to sit in a table cell. Anything too short to
 * truncate meaningfully is returned as-is; there is nothing to hide.
 */
export function truncateAddress(address: string): string {
  const value = str(address).trim();
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** Known name for a counterparty, or null. Empty addresses skip the lookup. */
function labelFor(address: string): string | null {
  return address ? labelCounterparty(address) : null;
}

/** 'YYYY-MM-DD' from epoch ms. Empty string for anything unusable. */
function toDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const d = new Date(timestamp);
  const iso = Number.isNaN(d.getTime()) ? "" : d.toISOString();
  return iso ? iso.slice(0, 10) : "";
}

/**
 * Normalise the two stored shapes into one. The envelope is what data-sync.ts
 * writes today; the bare array is what a legacy row (or a hand-imported
 * snapshot) may hold. Anything else — null, a string, a number, an object with
 * no `sample` — yields an empty sample rather than an exception.
 *
 * `capped` is inferred when the flag itself is missing but the recorded total
 * exceeds what was stored: a payload that lost its flag is still a sample, and
 * defaulting to "not capped" would suppress exactly the disclosure that
 * matters.
 */
function readEnvelope(transactionsRaw: unknown): {
  sample: StoredTransaction[];
  totalCount: number | null;
  capped: boolean;
} {
  if (Array.isArray(transactionsRaw)) {
    const sample = transactionsRaw.filter(
      (t): t is StoredTransaction => typeof t === "object" && t !== null
    );
    return { sample, totalCount: sample.length, capped: false };
  }

  if (typeof transactionsRaw !== "object" || transactionsRaw === null) {
    return { sample: [], totalCount: null, capped: false };
  }

  const envelope = transactionsRaw as StoredTransactionsEnvelope;
  const sample = Array.isArray(envelope.sample)
    ? envelope.sample.filter(
        (t): t is StoredTransaction => typeof t === "object" && t !== null
      )
    : [];

  const totalCount =
    typeof envelope.totalCount === "number" &&
    Number.isFinite(envelope.totalCount)
      ? envelope.totalCount
      : null;

  const capped =
    typeof envelope.capped === "boolean"
      ? envelope.capped
      : totalCount !== null && totalCount > sample.length;

  return { sample, totalCount, capped };
}

/**
 * Extract the transactions worth naming in a report.
 *
 * Exclusions, in order of how badly each would mislead:
 *   • `internal_transfer` — the treasury paying itself. Not an event.
 *   • `priceUnknown` — sync could not resolve a historical price, so
 *     `valueUsd` was left at 0 (or filled with a poisoned figure that was then
 *     zeroed). Ranking by a value we know to be wrong would put fake numbers
 *     at the top of the table.
 *   • non-positive or non-finite `valueUsd` — nothing to rank.
 *
 * Never throws. A malformed payload is an empty result, which the caller reads
 * as "no section", not as an error.
 */
export function extractMajorTransactions(
  transactionsRaw: unknown,
  totalTreasuryUsd: number
): MajorTransactionsResult {
  const thresholdUsd = majorTransactionThreshold(totalTreasuryUsd);
  const { sample, totalCount, capped } = readEnvelope(transactionsRaw);

  const qualifying: MajorTransaction[] = [];
  for (const tx of sample) {
    if (tx.priceUnknown === true) continue;

    const category = str(tx.category);
    if (EXCLUDED_CATEGORIES.has(category)) continue;

    const valueUsd = Math.abs(num(tx.valueUsd));
    if (valueUsd <= 0 || valueUsd < thresholdUsd) continue;

    const direction = tx.direction === "in" ? "in" : "out";
    const counterpartyAddress = str(direction === "in" ? tx.from : tx.to).trim();
    const known = labelFor(counterpartyAddress);
    const timestamp = num(tx.timestamp);
    const token = str(tx.token).toUpperCase();

    qualifying.push({
      hash: str(tx.hash),
      timestamp,
      date: toDate(timestamp),
      direction,
      valueUsd,
      token: token || "UNKNOWN",
      category,
      counterpartyAddress,
      counterparty: known ?? truncateAddress(counterpartyAddress),
      counterpartyKnown: known !== null,
    });
  }

  // Value descending. Timestamp then hash break ties so the same payload
  // always produces the same table — a report regenerated twice should not
  // shuffle its rows.
  qualifying.sort(
    (a, b) =>
      b.valueUsd - a.valueUsd ||
      b.timestamp - a.timestamp ||
      a.hash.localeCompare(b.hash)
  );

  return {
    rows: qualifying.slice(0, MAX_ROWS),
    capped,
    thresholdUsd,
    qualifyingCount: qualifying.length,
    sampleSize: sample.length,
    totalCount,
  };
}
