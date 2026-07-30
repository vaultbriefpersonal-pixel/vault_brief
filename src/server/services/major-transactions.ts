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
// ─── Legs are not transactions ─────────────────────────────────────────────
//
// The stored sample holds one row per transfer LEG. A batch distribution to
// eight recipients, both sides of a swap, a multi-asset payout — each is ONE
// transaction that produced several rows sharing one `hash`. Ranking legs
// individually is wrong in both directions: eight legs of $4.7M crowd every
// other row out of an 8-row table, while a hundred $500 legs that are really
// one $50K transfer clear no threshold at all and vanish.
//
// So rows here are aggregated by `(hash, direction)` and the threshold is
// applied to the AGGREGATE, never to a leg. `legCount` on each row carries
// how many transfers the transaction comprised, so the report can say "one
// transaction comprising eight transfers" rather than "eight transactions".
//
// ─── The sampling caveat, stated once, here ────────────────────────────────
//
// data-sync.ts stores a SAMPLE of the period's legs, not all of them — the
// union of the 50 largest by value and the 150 most recent (see
// transaction-sample.ts, which owns that rule and writes `sampleBasis` onto
// the envelope). When the period had more legs than that union could hold,
// the sync sets `capped` and a larger transfer may sit outside the sample
// entirely; nothing here can detect it. `capped` carries that fact out to the
// caller so the report can say so out loud, and it is inferred from the
// STORED sample size — never from the aggregated row count, which is legitimately
// smaller than the sample whenever legs group.
//
// Note that `capped` was wrong in production until 2026-07: the sync compared
// against a hash-deduped length, so collapsing legs alone raised the flag on
// periods where nothing had been truncated. A snapshot written before then may
// claim truncation that never happened.
//
// Everything here is defensive: `transactionsRaw` spans two stored shapes
// (the current object with metadata, and a legacy bare array), plus rows
// written before `priceUnknown` existed, plus whatever a hand-edited or
// half-migrated JSONB payload happens to contain. Nothing in this file throws.

import { labelCounterparty } from "./counterparty-labels";

/**
 * One row of the Major Transactions table — ONE transaction, not one transfer
 * leg. Every field is render-ready.
 */
export interface MajorTransaction {
  hash: string;
  /** Epoch milliseconds, as stored. 0 when the payload had no usable timestamp. */
  timestamp: number;
  /** 'YYYY-MM-DD', or an empty string when the timestamp was unusable. */
  date: string;
  direction: "in" | "out";
  /**
   * Absolute USD value of the whole transaction: the sum of its priced legs.
   * Always finite and > 0 — zero-value rows never qualify.
   */
  valueUsd: number;
  /**
   * Asset symbol, uppercased, when every counted leg moved the same one.
   * "multiple assets" when they did not. "UNKNOWN" when absent.
   */
  token: string;
  /**
   * Classifier category verbatim (`payroll`, `revenue`, …) when the legs
   * agree, "multiple categories" when they do not, "" when absent.
   */
  category: string;
  /**
   * The other side of the transfer — `to` for outflows, `from` for inflows —
   * when there is exactly one. Empty when the transaction had several.
   */
  counterpartyAddress: string;
  /**
   * Known name ("Binance"), a truncated address ("0x1234…abcd"), or
   * "N counterparties" when the transaction paid out to several.
   */
  counterparty: string;
  /** True when `counterparty` is a recognised name rather than an address. */
  counterpartyKnown: boolean;
  /**
   * How many transfer legs this row's value is the sum of. 1 for an ordinary
   * transfer, 8 for a batch distribution. NEVER a count of transactions.
   */
  legCount: number;
  /**
   * True when at least one leg of this transaction was dropped for having no
   * resolvable price. `valueUsd` is then a FLOOR, not the transaction's value.
   * The alternative — silently adding a known-wrong $0 — would understate it
   * with no signal at all.
   */
  partial: boolean;
}

/** Why legs that were stored are not in the table. */
export interface MajorTransactionExclusions {
  /** Legs the treasury sent to itself. Not events. */
  internal: number;
  /** Legs whose USD value the sync could not resolve. */
  priceUnknown: number;
  /** Aggregated transactions that came in under the threshold. */
  belowThreshold: number;
}

export interface MajorTransactionsResult {
  /** Qualifying transactions, largest USD value first. At most `MAX_ROWS`. */
  rows: MajorTransaction[];
  /**
   * True when the stored leg list was a capped sample of a larger set. Rows
   * are then "largest of what was sampled", NOT "largest of the period" — the
   * report MUST disclose this. See the header.
   */
  capped: boolean;
  /** The USD floor a transaction had to clear, applied AFTER aggregation. */
  thresholdUsd: number;
  /** How many transactions cleared the threshold before the row cap applied. */
  qualifyingCount: number;
  /**
   * Transfer LEGS in the stored sample. This is the denominator the `capped`
   * inference uses, and it is deliberately not the row count — rows are
   * fewer whenever legs group, and reading a legitimate grouping as
   * truncation would make every multi-leg period claim data was lost.
   */
  sampleSize: number;
  /** Total legs the sync saw, when the payload recorded it. */
  totalCount: number | null;
  /** Distinct legs the sync recorded, when the envelope carries it. */
  storedLegCount: number | null;
  /** How the sync chose the sample, when the envelope carries it. */
  sampleBasis: string | null;
  /** Accounting for the gap between `sampleSize` and `rows.length`. */
  excluded: MajorTransactionExclusions;
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
  /** Added 2026-07. Absent on every earlier snapshot. */
  legCount?: unknown;
  /** Added 2026-07. Absent on every earlier snapshot. */
  sampleBasis?: unknown;
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
  legCount: number | null;
  sampleBasis: string | null;
} {
  if (Array.isArray(transactionsRaw)) {
    const sample = transactionsRaw.filter(
      (t): t is StoredTransaction => typeof t === "object" && t !== null
    );
    return {
      sample,
      totalCount: sample.length,
      capped: false,
      legCount: null,
      sampleBasis: null,
    };
  }

  if (typeof transactionsRaw !== "object" || transactionsRaw === null) {
    return {
      sample: [],
      totalCount: null,
      capped: false,
      legCount: null,
      sampleBasis: null,
    };
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

  const legCount =
    typeof envelope.legCount === "number" && Number.isFinite(envelope.legCount)
      ? envelope.legCount
      : null;

  const sampleBasis =
    typeof envelope.sampleBasis === "string" && envelope.sampleBasis
      ? envelope.sampleBasis
      : null;

  return { sample, totalCount, capped, legCount, sampleBasis };
}

/** One normalised transfer leg, before any grouping. */
export interface TransactionLeg {
  hash: string;
  direction: "in" | "out";
  token: string;
  category: string;
  valueUsd: number;
  timestamp: number;
  counterpartyAddress: string;
  priceUnknown: boolean;
}

/** Normalise one stored row. Never throws; missing fields get safe defaults. */
function toLeg(tx: StoredTransaction): TransactionLeg {
  const direction = tx.direction === "in" ? "in" : "out";
  return {
    hash: str(tx.hash),
    direction,
    token: str(tx.token).toUpperCase(),
    category: str(tx.category),
    valueUsd: Math.abs(num(tx.valueUsd)),
    timestamp: num(tx.timestamp),
    counterpartyAddress: str(direction === "in" ? tx.from : tx.to).trim(),
    priceUnknown: tx.priceUnknown === true,
  };
}

/**
 * Group transfer legs into transactions by `(hash, direction)`, summing USD.
 *
 * Direction is part of the key, not just the hash: a swap routed through the
 * treasury has an in-leg and an out-leg under one hash, and adding them
 * together would report a transaction that both arrived and left as a single
 * doubled inflow.
 *
 * A leg with no resolvable price is EXCLUDED from the sum and marks its
 * transaction `partial`, so the row can be presented as a floor. Summing its
 * stored 0 would silently understate the transaction; dropping the whole
 * transaction would hide a real transfer because one of its legs was
 * unpriceable. `legCount` therefore counts the legs the value is the sum of.
 *
 * Rows with no priced leg at all produce nothing — there is no number to show.
 * Callers apply the threshold to the returned rows, never to a leg.
 */
export function aggregateLegs(legs: readonly TransactionLeg[]): {
  rows: MajorTransaction[];
  priceUnknownLegs: number;
} {
  interface Group {
    hash: string;
    direction: "in" | "out";
    valueUsd: number;
    timestamp: number;
    legCount: number;
    unpricedLegs: number;
    tokens: Set<string>;
    categories: Set<string>;
    counterparties: Map<string, string>;
  }

  const groups = new Map<string, Group>();
  let priceUnknownLegs = 0;

  legs.forEach((leg, index) => {
    if (leg.priceUnknown) priceUnknownLegs += 1;

    // A row with no hash cannot be grouped with anything — a malformed or
    // hand-edited payload must not have unrelated rows fused together just
    // because both are missing the field. Such rows stay one row each.
    const key = leg.hash
      ? `${leg.hash.toLowerCase()}|${leg.direction}`
      : `__nohash__${index}|${leg.direction}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        hash: leg.hash,
        direction: leg.direction,
        valueUsd: 0,
        timestamp: 0,
        legCount: 0,
        unpricedLegs: 0,
        tokens: new Set<string>(),
        categories: new Set<string>(),
        counterparties: new Map<string, string>(),
      };
      groups.set(key, group);
    }

    if (leg.priceUnknown) {
      group.unpricedLegs += 1;
      return;
    }
    // A leg priced at exactly zero is not a floor — its value is known and it
    // is nothing. It contributes no sum and no `partial` flag.
    if (leg.valueUsd <= 0) return;

    group.valueUsd += leg.valueUsd;
    group.legCount += 1;
    group.timestamp = Math.max(group.timestamp, leg.timestamp);
    group.tokens.add(leg.token);
    group.categories.add(leg.category);
    group.counterparties.set(
      leg.counterpartyAddress.toLowerCase(),
      leg.counterpartyAddress
    );
  });

  const rows: MajorTransaction[] = [];
  for (const group of groups.values()) {
    if (group.legCount === 0 || group.valueUsd <= 0) continue;

    const tokens = [...group.tokens];
    const categories = [...group.categories];
    const counterparties = [...group.counterparties.values()];

    const single = counterparties.length === 1 ? counterparties[0] : "";
    const known = counterparties.length === 1 ? labelFor(single) : null;

    rows.push({
      hash: group.hash,
      timestamp: group.timestamp,
      date: toDate(group.timestamp),
      direction: group.direction,
      valueUsd: group.valueUsd,
      token: tokens.length === 1 ? tokens[0] || "UNKNOWN" : "multiple assets",
      category: categories.length === 1 ? categories[0] : "multiple categories",
      counterpartyAddress: single,
      counterparty:
        counterparties.length === 1
          ? (known ?? truncateAddress(single))
          : `${counterparties.length} counterparties`,
      counterpartyKnown: known !== null,
      legCount: group.legCount,
      partial: group.unpricedLegs > 0,
    });
  }

  // Value descending. Timestamp then hash break ties so the same payload
  // always produces the same table — a report regenerated twice should not
  // shuffle its rows.
  rows.sort(
    (a, b) =>
      b.valueUsd - a.valueUsd ||
      b.timestamp - a.timestamp ||
      a.hash.localeCompare(b.hash)
  );

  return { rows, priceUnknownLegs };
}

/**
 * Extract the transactions worth naming in a report.
 *
 * Order of operations matters and is the whole fix:
 *   1. Drop `internal_transfer` legs — the treasury paying itself is not an
 *      event, and it must not contribute to any transaction's total either.
 *   2. Aggregate the remaining legs into transactions by `(hash, direction)`,
 *      excluding unpriced legs from the sum and flagging those rows `partial`.
 *   3. THEN apply the threshold, to the aggregate.
 *
 * Thresholding a leg was wrong in both directions: three legs of a $37.8M
 * distribution at $1.49M / $1.37M / $0.46M each failed a $5.28M floor while
 * their own transaction cleared it seven times over, and a hundred $500 legs
 * of one $50K transfer cleared nothing at all.
 *
 * Never throws. A malformed payload is an empty result, which the caller reads
 * as "no section", not as an error.
 */
export function extractMajorTransactions(
  transactionsRaw: unknown,
  totalTreasuryUsd: number
): MajorTransactionsResult {
  const thresholdUsd = majorTransactionThreshold(totalTreasuryUsd);
  const { sample, totalCount, capped, legCount, sampleBasis } =
    readEnvelope(transactionsRaw);

  const legs: TransactionLeg[] = [];
  let internal = 0;
  for (const tx of sample) {
    const leg = toLeg(tx);
    if (EXCLUDED_CATEGORIES.has(leg.category)) {
      internal += 1;
      continue;
    }
    legs.push(leg);
  }

  const { rows: aggregated, priceUnknownLegs } = aggregateLegs(legs);

  const qualifying = aggregated.filter((row) => row.valueUsd >= thresholdUsd);

  return {
    rows: qualifying.slice(0, MAX_ROWS),
    capped,
    thresholdUsd,
    qualifyingCount: qualifying.length,
    // Deliberately the stored LEG count, not `qualifying.length`: see the
    // header. Aggregation legitimately shrinks the row count and must never
    // be read as the sync having truncated something.
    sampleSize: sample.length,
    totalCount,
    storedLegCount: legCount,
    sampleBasis,
    excluded: {
      internal,
      priceUnknown: priceUnknownLegs,
      belowThreshold: aggregated.length - qualifying.length,
    },
  };
}
