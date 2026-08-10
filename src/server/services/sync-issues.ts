/**
 * Turns a snapshot's `sync_warnings` into the alertable unit: one issue per
 * (chain, scope, severity), with the affected wallets folded in.
 *
 * WHY THIS EXISTS. Stage 16 taught the product to RECORD that a snapshot was
 * incomplete and to show it on surfaces a founder might visit. Nothing ever
 * pushed it. Base Mainnet was disabled on the Alchemy app for nine days:
 * every Base read returned nothing, `sync_warnings` said so on every snapshot,
 * the syncs reported success, and it was found only because someone went
 * looking by hand. Same shape as the Dune Sim sunset before it — the failure
 * arrives as plausible data, not as an error.
 *
 * GROUPED BY CHAIN, NOT BY WALLET, on purpose. The fault being reported is
 * almost always a provider or a network being unreachable, which hits every
 * wallet on that chain at once. One alert per wallet would turn a single
 * outage into a mailbox full of identical mail, and a founder who learns to
 * filter these has been given a worse signal than none. The wallets appear
 * inside the alert, where they inform without multiplying it.
 *
 * Pure and dependency-free apart from the warning types, so the decision of
 * what counts as an issue is testable without a database, a mailer, or a
 * snapshot.
 */

import type {
  StoredSyncWarning,
  WarningScope,
  WarningSeverity,
} from "./sync-warnings";

/**
 * `unknown` is a real value here, not a fallback. Warnings written before the
 * Stage 16 taxonomy carry no scope or severity, and claiming one would be
 * inventing history — the same rule `summarizeSyncWarnings` already follows.
 */
export type IssueScope = WarningScope | "unknown";
export type IssueSeverity = WarningSeverity | "unknown";

export interface SyncIssueGroup {
  chain: string;
  scope: IssueScope;
  severity: IssueSeverity;
  /** Distinct wallet addresses, lowercased, in first-seen order. */
  wallets: string[];
  /** Distinct error messages, verbatim, in first-seen order. */
  messages: string[];
}

/** Worst first — a failed read is a bigger claim than a truncated one. */
const SEVERITY_RANK: Record<IssueSeverity, number> = {
  failed: 0,
  unknown: 1,
  partial: 2,
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function scopeOf(w: StoredSyncWarning): IssueScope {
  return w.scope === "balance" || w.scope === "transfers" ? w.scope : "unknown";
}

function severityOf(w: StoredSyncWarning): IssueSeverity {
  return w.severity === "failed" || w.severity === "partial"
    ? w.severity
    : "unknown";
}

/**
 * Folds a stored `sync_warnings` payload into distinct alertable issues.
 *
 * Returns `[]` for null, a non-array, or an empty array — a snapshot with
 * nothing wrong and a snapshot that predates the field are both "no issues",
 * and neither should produce an alert.
 */
export function syncIssueGroups(raw: unknown): SyncIssueGroup[] {
  if (!Array.isArray(raw)) return [];

  const byKey = new Map<string, SyncIssueGroup>();

  for (const entry of raw as StoredSyncWarning[]) {
    if (!entry || typeof entry !== "object") continue;

    const chain = str(entry.chain) || "unknown";
    const scope = scopeOf(entry);
    const severity = severityOf(entry);
    const key = `${chain}:${scope}:${severity}`;

    let group = byKey.get(key);
    if (!group) {
      group = { chain, scope, severity, wallets: [], messages: [] };
      byKey.set(key, group);
    }

    const wallet = str(entry.walletAddress).toLowerCase();
    if (wallet && !group.wallets.includes(wallet)) group.wallets.push(wallet);

    const message = str(entry.error);
    if (message && !group.messages.includes(message)) {
      group.messages.push(message);
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.scope.localeCompare(b.scope) ||
      a.chain.localeCompare(b.chain)
  );
}

/** Stable identity of an issue, independent of how many wallets it hit. */
export function syncIssueKey(group: SyncIssueGroup): string {
  return `${group.chain}:${group.scope}:${group.severity}`;
}

/**
 * The dedup handle, encoded into the notification's `href`.
 *
 * Reuses the `notifications` table as the record of what has already been
 * said, exactly as `anomaly-alerts.ts` does — a new table would be a
 * Forbidden-Area migration for a bookkeeping detail.
 *
 * `periodTag` (a snapshot's `YYYY-MM`) is part of the handle deliberately, and
 * it is what sets the cadence:
 *
 *   - re-syncing the same month, however many times, stays silent after the
 *     first alert — including a multi-period backfill, which writes many
 *     snapshots in one run;
 *   - a problem still unfixed next month alerts once more, because silence
 *     after a single message is how a nine-day outage goes unnoticed;
 *   - a problem that returns a year later alerts again, which a
 *     "have we ever mentioned this" check would not.
 */
export function syncIssueHref(
  projectId: string,
  key: string,
  periodTag: string
): string {
  return `/projects/${projectId}/wallets?syncIssue=${encodeURIComponent(
    `${key}@${periodTag}`
  )}`;
}

/** `2026-08` from a snapshot date, without a timezone in the way. */
export function periodTagOf(snapshotDate: Date | string): string {
  if (typeof snapshotDate === "string") {
    const m = /^(\d{4})-(\d{2})/.exec(snapshotDate);
    if (m) return `${m[1]}-${m[2]}`;
  }
  const d = new Date(snapshotDate);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const SCOPE_EFFECT: Record<IssueScope, string> = {
  balance: "the treasury total and composition exclude these wallets",
  transfers: "burn, inflows and outflows exclude these wallets",
  unknown: "some figures on this snapshot may be incomplete",
};

/**
 * One sentence a founder can act on: what broke, where, and what it costs
 * them. Deliberately states the CONSEQUENCE rather than only the fault —
 * "balance read failed" does not tell anyone their treasury total is wrong.
 */
export function describeSyncIssue(group: SyncIssueGroup): string {
  const wallets =
    group.wallets.length === 1
      ? "1 wallet"
      : `${group.wallets.length} wallets`;

  const verb =
    group.severity === "failed"
      ? "could not be read at all"
      : group.severity === "partial"
        ? "were read only in part"
        : "reported a problem";

  // "Balances" for an UNKNOWN scope would be inventing the very fact the
  // taxonomy refuses to guess — a legacy warning records that something went
  // wrong, not which family of figures it cost. Say the vague true thing.
  const what =
    group.scope === "transfers"
      ? "Transfers"
      : group.scope === "balance"
        ? "Balances"
        : "Some data";

  return `${what} on ${group.chain} ${verb} for ${wallets} — ${SCOPE_EFFECT[group.scope]}.`;
}
