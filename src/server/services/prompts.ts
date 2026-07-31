import type {
  TreasurySnapshot,
  Project,
  Milestone,
  Grant,
  GovernanceProposal,
  Partner,
  Ask,
  QaHighlight,
  ProjectBudget,
  GrantAward,
  GrantTranche,
} from "@/server/db/schema";
import { formatUsd } from "@/lib/utils";
import type { Anomaly } from "./anomalies";
import { changeSignificanceFloor } from "./report-derived";
import { periodFromSnapshot } from "./report-period";
import {
  buildSystemPrompt,
  buildUserPrompt,
  resolveSections,
  type ReportSection,
  type ReportSectionContext,
  type SectionConfigEntry,
} from "./report-sections";

/**
 * Composes both prompts for a report from a per-project section config.
 *
 * Refactored to an options bag in Phase 6 — five new manual-entry data
 * arrays (grants, governance, partners, asks, qa) inflate the parameter
 * list past what's readable as positional args. Callers now spread named
 * fields; required ones first in the JSDoc, optional default to empty.
 */
export interface BuildReportPromptsInput {
  snapshot: TreasurySnapshot;
  prevSnapshot?: TreasurySnapshot | null;
  /** Prior snapshots, most-recent-first, excluding `snapshot`. See ReportSectionContext. */
  trailing?: TreasurySnapshot[];
  project: Project;
  milestones?: Milestone[];
  grants?: Grant[];
  governanceProposals?: GovernanceProposal[];
  partners?: Partner[];
  asks?: Ask[];
  qaHighlights?: QaHighlight[];
  /**
   * Manually entered budget rows, all periods. The Plan vs Actual section
   * filters to the snapshot's period itself, same as `grants`. Omitted means
   * no plan exists, which gates the section off rather than rendering an
   * empty comparison.
   */
  budgets?: ProjectBudget[];
  /**
   * Grant awards this project RECEIVED, and their disbursement lines. Optional
   * and defaulting to empty for the same reason `budgets` is: every existing
   * caller, test and fixture compiles unchanged, and an omitted list means "no
   * grant on record", which gates both grant sections off rather than
   * rendering an award with no figures in it.
   *
   * Not `grants` above — that is money the project gave out. See the header on
   * `grantAwards` in schema.ts.
   */
  grantAwards?: GrantAward[];
  grantTranches?: GrantTranche[];
  /**
   * Output of `detectAnomalies(snapshot, trailing)`. Optional so existing
   * callers keep compiling; an omitted list means "no anomalies", which
   * gates the section off rather than smuggling data past it.
   */
  anomalies?: Anomaly[];
  storedSections?: SectionConfigEntry[] | null;
}

export function buildReportPrompts(
  input: BuildReportPromptsInput
): { system: string; user: string; enabled: ReportSection[] } {
  const {
    snapshot,
    prevSnapshot = null,
    trailing = [],
    project,
    milestones = [],
    grants = [],
    governanceProposals = [],
    partners = [],
    asks = [],
    qaHighlights = [],
    budgets = [],
    grantAwards = [],
    grantTranches = [],
    anomalies = [],
    storedSections = null,
  } = input;
  const total = Number(snapshot.totalBalanceUsd ?? 0);
  // The reporting window the snapshot describes. Falls back to the calendar
  // month ending on `snapshotDate` while `period_start` does not exist —
  // which reconstructs, rather than guesses, the period of every snapshot
  // written to date, since every write path has only ever produced a calendar
  // month. See `periodFromSnapshot`.
  //
  // `getSectionReadiness` in the projects router derives it the SAME way, for
  // the reason `changeSignificanceFloor` documents: two derivations can
  // disagree, and then the constructor UI's readiness chip promises a section
  // the report declines to render.
  const period = periodFromSnapshot(snapshot);
  const ctx: ReportSectionContext = {
    snapshot,
    prevSnapshot,
    trailing,
    project,
    milestones,
    grants,
    governanceProposals,
    partners,
    asks,
    qaHighlights,
    budgets,
    grantAwards,
    grantTranches,
    anomalies,
    period,
    total,
    // The floor for CHANGE components only — see the field's doc comment in
    // report-derived.ts. 0.1% of a $1.06B treasury is ~$1.06M, which is the
    // right bar for "is this delta worth a sentence?" and the wrong bar for
    // everything else, so composition reads DUST_FLOOR_USD and revenue reads
    // RECURRING_INCOME_FLOOR_USD instead.
    minSignificant: changeSignificanceFloor(total),
  };
  const enabled = resolveSections(storedSections);
  return {
    system: buildSystemPrompt(enabled, ctx),
    user: buildUserPrompt(ctx, enabled),
    enabled,
  };
}

/**
 * Phrases that violate the report's absolute guardrails (decision 2: the ban
 * on projecting a future token price/market cap/valuation, and the ban on
 * advising the reader to buy, sell, or hold the token, both stay non-negotiable
 * even after Recommendations was allowed to carry operational commentary).
 *
 * Word-boundary-aware and phrase-specific on purpose. Banning the bare word
 * "reach" would also catch "reserves would reach approximately $1.2M" — a
 * legitimate conditional projection the Next Period Projection section is
 * explicitly told to write. "will reach" (an assertion) and "would reach" (a
 * conditional) are different phrases; only the first is forbidden.
 */
const FORBIDDEN_PHRASES: readonly { pattern: RegExp; note: string }[] = [
  {
    pattern: /\bwill reach\b/i,
    note: "implies a confident future prediction, not a mechanical projection",
  },
  {
    pattern: /\bprojected market cap\b/i,
    note: "projects a future valuation, which is banned absolutely",
  },
  {
    pattern: /\binvestors should\b/i,
    note: "advises the reader directly — that is investment advice",
  },
  {
    pattern: /\bguaranteed\b/i,
    note: "asserts a certainty this report cannot support",
  },
  {
    pattern: /\bshould buy\b/i,
    note: "advises the reader to buy the token — the regulated line this report does not cross",
  },
  {
    pattern: /\bshould sell\b/i,
    note: "advises the reader to sell the token — the regulated line this report does not cross",
  },
  {
    pattern: /\bshould hold\b/i,
    note: "advises the reader to hold the token — the regulated line this report does not cross",
  },
];

export function validateReportContent(
  markdown: string,
  snapshot: TreasurySnapshot
): { passed: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check that the total balance figure appears in some form in the report.
  // Real reports vary in formatting ($1.2M vs $1,234,567); we accept any.
  if (snapshot.totalBalanceUsd) {
    const total = Number(snapshot.totalBalanceUsd);
    const totalMillions = (total / 1_000_000).toFixed(1);
    const totalK = (total / 1_000).toFixed(0);
    const hasTotal =
      markdown.includes(`$${totalMillions}M`) ||
      markdown.includes(`$${totalK}K`) ||
      markdown.includes(total.toFixed(0));
    if (!hasTotal && total > 1000) {
      issues.push(`Total balance ${formatUsd(total)} not found in report`);
    }
  }

  for (const { pattern, note } of FORBIDDEN_PHRASES) {
    const match = markdown.match(pattern);
    if (match) {
      issues.push(`Forbidden phrase found: "${match[0]}" — ${note}`);
    }
  }

  return { passed: issues.length === 0, issues };
}
