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
  sectionIdsWithContent,
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
): {
  system: string;
  user: string;
  enabled: ReportSection[];
  /** Ids of `enabled` sections that had real content this generation — see `sectionIdsWithContent`. */
  sectionsWithContent: Set<string>;
} {
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
    sectionsWithContent: sectionIdsWithContent(ctx, enabled),
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

/**
 * Calibrated against a real production incident: a 473-character completion
 * (cut off mid-sentence at "### Financial Health\n\nRun") passed every other
 * check here and was cached forever by `callLLM` (report-generator.ts),
 * replaying the same broken text on every subsequent Regenerate. A real
 * report renders roughly one Markdown block per enabled section, so length
 * scales with section count. Both constants are deliberately far below what
 * any real section actually produces (a realistic section runs several
 * hundred characters) to keep false positives near zero while still catching
 * an obviously-truncated completion — same "simple, documented heuristic
 * floor" shape as `MAX_REASONABLE_TX_USD` in transfer-fetch-policy.ts.
 */
const MIN_REPORT_CHARS = 250;
const MIN_CHARS_PER_ENABLED_SECTION = 60;

/**
 * Extract one Markdown section's body by heading, from `### <heading>...` to
 * the next `##`/`###` heading or end of document. Whitespace- and
 * trailing-text-tolerant, so a rendered "### Key Takeaways" heading and an
 * instruction-style "### Key Takeaways (CONDITIONAL)" both match. Returns
 * null when the heading is absent, never an empty string, so callers can
 * tell "section missing" from "section present but blank."
 *
 * No markdown parser needed for a document this codebase already generates
 * in a fixed heading shape — same lightweight regex-based inspection style
 * as the rest of this function.
 */
function extractMarkdownSection(
  markdown: string,
  headingPattern: string
): string | null {
  const re = new RegExp(
    `###\\s*${headingPattern}[^\\n]*\\n+([\\s\\S]+?)(?=\\n##|$)`,
    "i"
  );
  const match = markdown.match(re);
  return match ? match[1].trim() : null;
}

export function validateReportContent(
  markdown: string,
  snapshot: TreasurySnapshot,
  enabledSectionCount?: number,
  sectionsWithContent?: Set<string>
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

  if (enabledSectionCount !== undefined) {
    const floor = Math.max(
      MIN_REPORT_CHARS,
      enabledSectionCount * MIN_CHARS_PER_ENABLED_SECTION
    );
    const len = markdown.trim().length;
    if (len < floor) {
      issues.push(
        `Report is implausibly short (${len} chars) for ${enabledSectionCount} enabled section(s) — expected at least ${floor}, likely a truncated completion`
      );
    }
  }

  // Structural guard against "no material concerns" beside a real,
  // evidence-gated concern. Only checked when the caller tells us
  // Lows/Concerns actually carried evidence this generation (via
  // `sectionsWithContent` — see `sectionIdsWithContent` in report-sections.ts)
  // — an omitted `sectionsWithContent` (every pre-existing caller/test) or a
  // `lows_concerns` fragment that was genuinely empty both skip this
  // entirely, because "no material concerns" is the CORRECT sentence when
  // the evidence ledger really has nothing.
  if (sectionsWithContent?.has("lows_concerns")) {
    const lows = extractMarkdownSection(markdown, "Lows\\s*/\\s*Concerns");
    if (lows && /no material concerns/i.test(lows)) {
      issues.push(
        `Lows/Concerns says "no material concerns" despite verified concern evidence for this period — contradicts the rest of the report`
      );
    }
  }

  // Key Takeaways must carry a figure on every bullet, and must not render
  // as zero bullets, whenever the input evidence was non-empty. Does NOT
  // enforce a bullet-count range — the section's own rule explicitly allows
  // fewer than 3 bullets when the data is thin ("If the block supports only
  // three bullets, write three").
  if (sectionsWithContent?.has("key_takeaways")) {
    const takeaways = extractMarkdownSection(markdown, "Key Takeaways");
    const bulletLines = (takeaways ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s/.test(l));

    if (bulletLines.length === 0) {
      issues.push(
        "Key Takeaways rendered with zero bullets despite non-empty input evidence for this period"
      );
    } else {
      const noFigure = bulletLines.filter((l) => !/\d/.test(l));
      if (noFigure.length > 0) {
        issues.push(
          `Key Takeaways has ${noFigure.length} bullet(s) with no figure: "${noFigure[0]}"`
        );
      }
    }
  }

  return { passed: issues.length === 0, issues };
}
