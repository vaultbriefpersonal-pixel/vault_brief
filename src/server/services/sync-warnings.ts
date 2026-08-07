// The vocabulary a sync uses to say what it could not read.
//
// Before this module there were two structurally identical warning types —
// `BalanceWarning` in wallet-sync.ts and `SyncWarning` in transaction-sync.ts
// — each carrying `{walletAddress, chain, error}` and nothing else. With no
// field distinguishing one failure from another, the only consumer (the
// project dashboard) had to render every warning under one headline, and it
// chose "N wallets failed to sync". That sentence was wrong in two ways at
// once: a page-cap warning describes a wallet that DID return data, and a
// wallet that failed on both its incoming and outgoing reads counted twice.
//
// Two axes, because two different questions get asked of a snapshot:
//
//   • `scope`    — WHICH figures are affected. A failed balance read makes the
//                  treasury total wrong; a failed transfer read leaves the
//                  total correct and makes burn, inflows and outflows wrong.
//                  Collapsing them means a reader cannot tell which number to
//                  distrust.
//   • `severity` — whether anything at all was measured. `failed` means no
//                  data; `partial` means real data that is a FLOOR. Only the
//                  second may be quoted with a caveat; the first may not be
//                  quoted at all.
//
// Deliberately NO `code` field. It would be useful for triage and nothing
// would read it today, and this codebase's rule is that a column or field
// earns its place by having a consumer or a named, scheduled one. `error`
// already carries the specific cause in prose for a human reading the
// dashboard. Add `code` when something needs to branch on the cause
// programmatically.

import { walletKey } from "./treasury-attribution";

/** Which family of figures a warning casts doubt on. */
export type WarningScope = "balance" | "transfers";

/**
 * `failed` — nothing was read; the affected figures exclude this wallet.
 * `partial` — something was read, but not all of it; figures are a floor.
 */
export type WarningSeverity = "failed" | "partial";

export interface SyncWarning {
  walletAddress: string;
  chain: string;
  scope: WarningScope;
  severity: WarningSeverity;
  /** Human-readable cause, shown verbatim. Written at the failure site. */
  error: string;
}

/**
 * A warning as it may appear in a STORED snapshot.
 *
 * Rows written before this module carry only the three original fields, so
 * `scope` and `severity` are optional on the read path and their absence must
 * read as "unknown", never as a default. Claiming a legacy warning was a
 * balance failure would be inventing history.
 */
export interface StoredSyncWarning {
  walletAddress?: string;
  chain?: string;
  scope?: WarningScope;
  severity?: WarningSeverity;
  error?: string;
}

export interface SyncCoverageSummary {
  /** Distinct wallets, as `chain:address`, per bucket. */
  balanceFailed: string[];
  balancePartial: string[];
  transfersFailed: string[];
  transfersPartial: string[];
  /** Legacy warnings whose nature was never recorded. */
  unclassified: string[];
  /** Every warning message, in the order stored. */
  messages: string[];
  /** The treasury total and composition exclude, or understate, some wallet. */
  balancesIncomplete: boolean;
  /** Burn, inflows, outflows and net flow exclude, or understate, some wallet. */
  flowsIncomplete: boolean;
}

const EMPTY: SyncCoverageSummary = {
  balanceFailed: [],
  balancePartial: [],
  transfersFailed: [],
  transfersPartial: [],
  unclassified: [],
  messages: [],
  balancesIncomplete: false,
  flowsIncomplete: false,
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Folds a stored `sync_warnings` payload into per-dimension wallet sets.
 *
 * Counts DISTINCT wallets rather than warnings: one wallet whose incoming and
 * outgoing transfer reads both failed produces two warnings and is one wallet
 * with a problem. Reporting "2 wallets" there overstates the damage, which is
 * its own kind of dishonesty.
 *
 * Returns a summary with everything empty — never null — when there is
 * nothing wrong, so callers branch on `balancesIncomplete`/`flowsIncomplete`
 * rather than on nullness.
 */
export function summarizeSyncWarnings(raw: unknown): SyncCoverageSummary {
  if (!Array.isArray(raw) || raw.length === 0) return { ...EMPTY };

  const buckets = {
    balanceFailed: new Set<string>(),
    balancePartial: new Set<string>(),
    transfersFailed: new Set<string>(),
    transfersPartial: new Set<string>(),
    unclassified: new Set<string>(),
  };
  const messages: string[] = [];

  for (const w of raw as StoredSyncWarning[]) {
    if (!w || typeof w !== "object") continue;
    const message = str(w.error).trim();
    if (message) messages.push(message);

    const key = walletKey(str(w.chain), str(w.walletAddress));
    const scope = w.scope;
    const severity = w.severity;

    if (scope === "balance" && severity === "failed") buckets.balanceFailed.add(key);
    else if (scope === "balance" && severity === "partial") buckets.balancePartial.add(key);
    else if (scope === "transfers" && severity === "failed") buckets.transfersFailed.add(key);
    else if (scope === "transfers" && severity === "partial") buckets.transfersPartial.add(key);
    else buckets.unclassified.add(key);
  }

  const summary: SyncCoverageSummary = {
    balanceFailed: [...buckets.balanceFailed],
    balancePartial: [...buckets.balancePartial],
    transfersFailed: [...buckets.transfersFailed],
    transfersPartial: [...buckets.transfersPartial],
    unclassified: [...buckets.unclassified],
    messages,
    balancesIncomplete: false,
    flowsIncomplete: false,
  };

  // An unclassified legacy warning could have been either, so it taints both.
  // Over-flagging an old snapshot is the safe direction: it invites a re-sync,
  // whereas under-flagging lets an incomplete figure pass as a measured one.
  const legacy = summary.unclassified.length > 0;
  summary.balancesIncomplete =
    legacy || summary.balanceFailed.length > 0 || summary.balancePartial.length > 0;
  summary.flowsIncomplete =
    legacy || summary.transfersFailed.length > 0 || summary.transfersPartial.length > 0;

  return summary;
}

/**
 * One sentence naming what is wrong, or null when nothing is.
 *
 * Built here rather than at each surface so the dashboard, the report page and
 * anything added later cannot drift into describing the same snapshot
 * differently — the drift that produced "failed to sync" for a wallet that
 * had merely been truncated.
 */
export function describeSyncCoverage(
  summary: SyncCoverageSummary
): { title: string; detail: string } | null {
  if (!summary.balancesIncomplete && !summary.flowsIncomplete) return null;

  const wallets = (n: number) => `${n} wallet${n === 1 ? "" : "s"}`;
  const parts: string[] = [];

  if (summary.balanceFailed.length > 0) {
    parts.push(`balances could not be read for ${wallets(summary.balanceFailed.length)}`);
  }
  if (summary.balancePartial.length > 0) {
    parts.push(`balances are a floor for ${wallets(summary.balancePartial.length)}`);
  }
  if (summary.transfersFailed.length > 0) {
    parts.push(`transfer history is missing for ${wallets(summary.transfersFailed.length)}`);
  }
  if (summary.transfersPartial.length > 0) {
    parts.push(`transfer history is a floor for ${wallets(summary.transfersPartial.length)}`);
  }
  if (summary.unclassified.length > 0) {
    parts.push(`${wallets(summary.unclassified.length)} reported a problem of unrecorded kind`);
  }

  // Names the affected FIGURES, not just the wallets, because that is the
  // thing a reader is about to quote.
  const affected: string[] = [];
  if (summary.balancesIncomplete) affected.push("the treasury total and composition");
  if (summary.flowsIncomplete) affected.push("burn, inflows and outflows");

  return {
    title: "Snapshot is incomplete",
    detail: `${parts.join("; ")}. This affects ${affected.join(", and ")}.`,
  };
}
