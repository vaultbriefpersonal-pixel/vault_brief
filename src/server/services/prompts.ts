import type { TreasurySnapshot, Project, Milestone } from "@/server/db/schema";
import { formatUsd } from "@/lib/utils";
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
 * Pre-Phase-2 this file owned a hand-written monolithic system prompt and
 * a 200-line `buildReportPrompt`. Both have moved into the section library
 * (`report-sections.ts`) — this module now exists to (a) provide the
 * `{ system, user }` pair the generator wants, and (b) keep
 * `validateReportNumbers` (a pure post-LLM check unrelated to the prompt
 * shape) co-located with the prompt code that callers reach for.
 */
export function buildReportPrompts(
  snapshot: TreasurySnapshot,
  prevSnapshot: TreasurySnapshot | undefined | null,
  project: Project,
  projectMilestones: Milestone[] = [],
  storedSections: SectionConfigEntry[] | null = null
): { system: string; user: string; enabled: ReportSection[] } {
  const total = Number(snapshot.totalBalanceUsd ?? 0);
  const ctx: ReportSectionContext = {
    snapshot,
    prevSnapshot,
    project,
    milestones: projectMilestones,
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
