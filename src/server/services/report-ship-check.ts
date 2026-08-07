// What stands between a generated report and a funder's inbox.
//
// The product has always known these things and never told anyone who could
// act on them. `validateReportContent` runs seven checks and, after two failed
// correction rounds, `generateReport` returns the broken markdown anyway with
// no flag and nothing persisted. `sync_warnings` records every wallet whose
// balance or transfer read failed, and until Stage 16 only the project
// dashboard rendered it — never the report page, never the send path.
//
// One function, two callers, on purpose: the banner the founder reads and the
// gate the mutation enforces must be computed from the same rule, or the
// product ends up showing one thing and enforcing another.

import { summarizeSyncWarnings } from "./sync-warnings";

export interface ShipCheckInput {
  /**
   * `reports.validation_issues`. THREE states, and the difference matters:
   * `null`/absent means the report was never checked (generated before the
   * column existed) and must produce NO blocker — an unknown verdict is not
   * a bad one. `[]` means checked and clean. A non-empty array is the issues.
   */
  validationIssues: unknown;
  /** `treasury_snapshots.sync_warnings` for the snapshot this report is built on. */
  syncWarnings: unknown;
}

/**
 * Reasons a founder should look again before this ships. Empty means nothing
 * known is wrong — NOT that the report is good, only that no check objected.
 *
 * Phrased as complete sentences because they surface verbatim in a banner and
 * in a confirm dialog, where a terse code would leave the reader to guess.
 */
export function reportShipBlockers(input: ShipCheckInput): string[] {
  const blockers: string[] = [];

  // Only an ARRAY is a verdict. `null` is "never checked" and says nothing.
  if (Array.isArray(input.validationIssues) && input.validationIssues.length > 0) {
    for (const issue of input.validationIssues) {
      if (typeof issue === "string" && issue.trim()) blockers.push(issue.trim());
    }
  }

  const coverage = summarizeSyncWarnings(input.syncWarnings);
  if (coverage.balancesIncomplete) {
    blockers.push(
      "The treasury total and composition in this report are incomplete — " +
        "at least one wallet's balances were not fully read for this snapshot."
    );
  }
  if (coverage.flowsIncomplete) {
    blockers.push(
      "Burn, inflows and outflows in this report are incomplete — " +
        "at least one wallet's transfer history was not fully read for this snapshot."
    );
  }

  return blockers;
}
