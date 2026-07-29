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
} from "@/server/db/schema";
import { formatUsd } from "@/lib/utils";
import type { Anomaly } from "./anomalies";
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
    anomalies = [],
    storedSections = null,
  } = input;
  const total = Number(snapshot.totalBalanceUsd ?? 0);
  // 'YYYY-MM' for matching against per-row period text. Snapshot date is
  // a YYYY-MM-DD string from a date column; sliced cleanly.
  const period = String(snapshot.snapshotDate).slice(0, 7);
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
    anomalies,
    period,
    total,
    minSignificant: total > 0 ? total * 0.001 : 0,
  };
  const enabled = resolveSections(storedSections);
  return {
    system: buildSystemPrompt(enabled),
    user: buildUserPrompt(ctx, enabled),
    enabled,
  };
}

export function validateReportNumbers(
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

  return { passed: issues.length === 0, issues };
}
