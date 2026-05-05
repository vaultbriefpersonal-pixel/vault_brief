import type {
  TreasurySnapshot,
  Project,
  Milestone,
  Grant,
  GovernanceProposal,
  Partner,
  Ask,
  QaHighlight,
} from "@/server/db/schema";
import { formatUsd, formatDate } from "@/lib/utils";

/**
 * Report section library — single source of truth for every block the
 * LLM can produce. The constructor UI toggles + reorders these; the
 * prompt builder composes user+system prompts from the enabled list.
 *
 * Each section is self-contained:
 *   • `requires(ctx)` — gate predicate. If false, the section is skipped
 *     even when enabled (e.g. "Token Metrics" with no token symbol).
 *     Different from disabled-via-config: the user wanted the section,
 *     but data isn't there yet.
 *   • `userPromptFragment(ctx)` — the chunk that goes into the user
 *     prompt block. Empty string ⇒ skip silently.
 *   • `systemPromptFragment` — instructions appended to the system
 *     prompt. Per-section "shape rules" live here.
 *
 * Why one file: a centralized library makes the constructor UI trivial
 * (iterate the array, render toggles). It also forces every section to
 * carry both halves of its rendering — there's no place to leave a
 * dangling section title in prompts.ts that the system prompt forgot to
 * reference.
 */

export interface ReportSectionContext {
  snapshot: TreasurySnapshot;
  prevSnapshot: TreasurySnapshot | undefined | null;
  project: Project;
  milestones: Milestone[];
  /** 'YYYY-MM' derived from snapshot.snapshotDate; used for period match. */
  period: string;
  grants: Grant[];
  governanceProposals: GovernanceProposal[];
  partners: Partner[];
  asks: Ask[];
  qaHighlights: QaHighlight[];
  /** Total balance in USD, computed once. */
  total: number;
  /** Minimum balance to be worth mentioning (0.1% of total). */
  minSignificant: number;
}

export interface ReportSection {
  id: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
  /** When false on the latest snapshot, skip even if enabled. */
  requires: (ctx: ReportSectionContext) => boolean;
  /**
   * Returns the chunk that goes into the user prompt. Empty string ⇒
   * silent skip. Most sections use this to feed the LLM their slice of
   * the input data.
   */
  userPromptFragment: (ctx: ReportSectionContext) => string;
  /**
   * Instructions appended to the system prompt for this section's
   * shape rules. Always included when the section is enabled (even if
   * `requires` is false — the system prompt is just rules, no data).
   */
  systemPromptFragment: string;
  /**
   * Human-readable reason why a section won't render with current
   * data. Shown in the constructor UI as a chip when `requires()` is
   * false. Two common shapes:
   *   • "Coming soon — no <X> pipeline yet" for sections gated on
   *     features we haven't built yet
   *   • "Needs <Y>" for sections waiting on user data
   * If omitted, the editor falls back to a generic "Not yet ready".
   */
  notReadyHint?: string;
}

// ─── individual sections ───────────────────────────────────────────────────

const executiveSummary: ReportSection = {
  id: "executive_summary",
  title: "Executive Summary",
  description:
    "3-4 sentence opening: where the treasury sits, biggest change vs. last month, one forward-looking statement.",
  defaultEnabled: true,
  requires: () => true,
  userPromptFragment: () => "", // handled implicitly by snapshot context
  systemPromptFragment: `### Executive Summary
3-4 sentences. State the treasury position, biggest change vs last month, and one forward-looking statement. Use exact numbers. Never fabricate data.`,
};

const wins: ReportSection = {
  id: "wins",
  title: "Wins this period",
  description:
    "2-3 bullets calling out positive developments — milestones hit, key partnerships, treasury growth, dev velocity.",
  defaultEnabled: true,
  requires: () => true,
  userPromptFragment: () => "",
  systemPromptFragment: `### Wins
2-3 bullet points of positive developments this period. Pull from milestones completed, treasury growth, dev activity spikes, partnerships, or anomaly detector hits flagged as positive. Be specific — "treasury grew 8% on a $4.9M funding inflow" beats "treasury growth was strong."`,
};

const lowsConcerns: ReportSection = {
  id: "lows_concerns",
  title: "Lows / Concerns",
  description:
    "1-2 bullets honestly naming risks, missed targets, or unexplained metric movements.",
  defaultEnabled: true,
  requires: () => true,
  userPromptFragment: () => "",
  systemPromptFragment: `### Lows / Concerns
1-2 bullet points naming real concerns: missed milestones (status='delayed'), runway shrinking, unexplained outflows, anomaly hits with negative direction. If there's nothing material to flag, write a single sentence acknowledging it ("No material concerns this period — burn and runway tracking to plan."). Don't manufacture a concern.`,
};

const treasuryOverview: ReportSection = {
  id: "treasury_overview",
  title: "Treasury Overview",
  description:
    "Asset breakdown table: stablecoins, native ETH, project token, other holdings.",
  defaultEnabled: true,
  requires: (ctx) => ctx.total > 0,
  userPromptFragment: (ctx) => {
    const { snapshot, project, total, minSignificant } = ctx;
    const lines: string[] = [`- Total balance: ${formatUsd(total)}`];
    const stables = Number(snapshot.stablecoinsUsd ?? 0);
    if (stables > minSignificant) lines.push(`- Stablecoins: ${formatUsd(stables)}`);
    const ethUsd = Number(snapshot.ethUsd ?? 0);
    if (ethUsd > minSignificant) lines.push(`- ETH/WETH: ${formatUsd(ethUsd)}`);
    const nativeUsd = Number(snapshot.nativeTokenUsd ?? 0);
    if (project.tokenSymbol && nativeUsd > minSignificant) {
      lines.push(`- ${project.tokenSymbol} (native token): ${formatUsd(nativeUsd)}`);
    }
    const otherUsd = Number(snapshot.otherAssetsUsd ?? 0);
    if (otherUsd > minSignificant) lines.push(`- Other assets: ${formatUsd(otherUsd)}`);
    return `\n## Current Treasury (${snapshot.snapshotDate})\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Treasury Overview
- Table: Asset | Balance | % of Total
- **Only include rows where Balance > $0.** Skip categories the project does not currently hold — do NOT emit "$0 / 0%" placeholder rows. If the input doesn't list a balance for an asset, that asset doesn't exist in this treasury; pretend it's not even on the menu.
- Total treasury value
- Change vs previous month (absolute and percentage) — only if a Previous Month section appears in the input.`,
  notReadyHint: "Run a sync to fetch wallet balances first.",
};

const treasuryByChain: ReportSection = {
  id: "treasury_by_chain",
  title: "Treasury by Chain",
  description:
    "How balances split across Ethereum, L2s, Solana, etc. Auto-skips for single-chain projects.",
  defaultEnabled: true,
  requires: (ctx) => {
    const byChain =
      (ctx.snapshot.balancesByChain as Record<string, number> | null) ?? null;
    if (!byChain) return false;
    return (
      Object.values(byChain).filter((v) => Number(v) > ctx.minSignificant)
        .length >= 2
    );
  },
  userPromptFragment: (ctx) => {
    const byChain =
      (ctx.snapshot.balancesByChain as Record<string, number> | null) ?? null;
    if (!byChain) return "";
    const entries = Object.entries(byChain).filter(
      ([, v]) => Number(v) > ctx.minSignificant
    );
    if (entries.length < 2) return "";
    const sorted = entries.sort((a, b) => Number(b[1]) - Number(a[1]));
    return `\n## Treasury by chain\n${sorted
      .map(
        ([chain, v]) =>
          `- ${chain}: ${formatUsd(Number(v))} (${(
            (Number(v) / ctx.total) *
            100
          ).toFixed(1)}%)`
      )
      .join("\n")}`;
  },
  systemPromptFragment: `### Treasury by Chain (CONDITIONAL)
- Only render if the input contains a "## Treasury by chain" block with 2+ chains.
- One or two sentences explaining the split. Example: "85% sits on Ethereum mainnet; the remaining 15% is split across Optimism and Base for L2 ops."
- Skip when only one chain is present — "100% on Ethereum" is noise, not analysis.`,
  notReadyHint: "Add wallets on ≥2 chains.",
};

const previousMonthComparison: ReportSection = {
  id: "previous_month_comparison",
  title: "Month-over-Month",
  description:
    "Direct comparison: total treasury delta + percentage change vs. last snapshot.",
  defaultEnabled: true,
  requires: (ctx) => Boolean(ctx.prevSnapshot),
  userPromptFragment: (ctx) => {
    if (!ctx.prevSnapshot) return "";
    const cur = Number(ctx.snapshot.totalBalanceUsd ?? 0);
    const prev = Number(ctx.prevSnapshot.totalBalanceUsd ?? 0);
    const delta = cur - prev;
    const pct = prev > 0 ? ((delta / prev) * 100).toFixed(1) : "N/A";
    return `\n## Previous Month Treasury\n- Total balance: ${formatUsd(prev)}\n- Change: ${formatUsd(delta)} (${pct}%)`;
  },
  systemPromptFragment: `### Month-over-Month (CONDITIONAL)
- Only render if a "## Previous Month Treasury" block appears in the input.
- Single sentence summarising the delta with a directional verb ("grew", "shrank by", "held steady at"). Don't dramatize a 0.5% move.`,
  notReadyHint: "Needs at least one prior monthly snapshot.",
};

const financialHealth: ReportSection = {
  id: "financial_health",
  title: "Financial Health",
  description:
    "Burn rate, runway in months, total inflows/outflows for the period.",
  defaultEnabled: true,
  requires: (ctx) =>
    Number(ctx.snapshot.burnRateUsd ?? 0) > 0 ||
    Number(ctx.snapshot.totalInflowsUsd ?? 0) > 0 ||
    Number(ctx.snapshot.totalOutflowsUsd ?? 0) > 0,
  userPromptFragment: (ctx) => {
    const lines: string[] = [];
    const { snapshot } = ctx;
    if (snapshot.burnRateUsd) {
      lines.push(`- Monthly burn rate: ${formatUsd(Number(snapshot.burnRateUsd))}`);
    }
    if (snapshot.runwayMonths) {
      lines.push(`- Runway: ${Number(snapshot.runwayMonths).toFixed(1)} months`);
    }
    if (snapshot.totalInflowsUsd) {
      lines.push(`- Total inflows: ${formatUsd(Number(snapshot.totalInflowsUsd))}`);
    }
    if (snapshot.totalOutflowsUsd) {
      lines.push(`- Total outflows: ${formatUsd(Number(snapshot.totalOutflowsUsd))}`);
    }
    if (lines.length === 0) return "";
    return `\n## Financial Metrics\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Financial Health
- Monthly burn rate (only if available).
- Runway in months (only if available).
- Inflows and outflows totals — only the ones the input provides.
- Do NOT echo "Not available" for missing fields. Drop the bullet.`,
  notReadyHint: "Needs at least one period with inflows or outflows.",
};

const expenseBreakdown: ReportSection = {
  id: "expense_breakdown",
  title: "Operating Expenses",
  description:
    "Per-category expense table (payroll, infra, audits, marketing, etc.).",
  defaultEnabled: true,
  requires: (ctx) => {
    if (!ctx.snapshot.expensesByCategory) return false;
    const all = ctx.snapshot.expensesByCategory as Record<string, number>;
    return Object.entries(all).some(([k, v]) => v > 0 && k !== "token_sale");
  },
  userPromptFragment: (ctx) => {
    if (!ctx.snapshot.expensesByCategory) return "";
    const all = ctx.snapshot.expensesByCategory as Record<string, number>;
    const operating = Object.entries(all).filter(
      ([k, v]) => v > 0 && k !== "token_sale"
    );
    if (operating.length === 0) return "";
    return `\nOperating expenses (excludes treasury reallocation):\n${operating
      .map(([k, v]) => `- ${k}: ${formatUsd(v)}`)
      .join("\n")}`;
  },
  systemPromptFragment: `### Operating Expenses (CONDITIONAL)
- Render as a category table only when the input lists at least one operating expense category.
- Notable changes vs previous month — only if a previous month was provided AND there's a real delta to discuss. Otherwise skip.`,
  notReadyHint: "Needs operating outflows in this period (rebalances don't count).",
};

const treasuryOperations: ReportSection = {
  id: "treasury_operations",
  title: "Treasury Operations",
  description:
    "token_sale rebalances kept separate from operating expenses (so they don't inflate burn).",
  defaultEnabled: true,
  requires: (ctx) => {
    if (!ctx.snapshot.expensesByCategory) return false;
    const all = ctx.snapshot.expensesByCategory as Record<string, number>;
    return (all.token_sale ?? 0) > 0;
  },
  userPromptFragment: (ctx) => {
    if (!ctx.snapshot.expensesByCategory) return "";
    const all = ctx.snapshot.expensesByCategory as Record<string, number>;
    const tokenSale = all.token_sale ?? 0;
    if (tokenSale <= 0) return "";
    return `\n\nTreasury operations (NOT operating expenses — stablecoin/native-token rebalancing):\n- token_sale: ${formatUsd(tokenSale)}`;
  },
  systemPromptFragment: `### Treasury Operations (CONDITIONAL)
- Render this section ONLY when the input lists a non-zero "token_sale" line in Treasury operations.
- token_sale outflows are treasury reallocations (e.g. swapping native token for stablecoins or vice versa), NOT operating expenses. Never include them in the expense breakdown table; show them separately here with a one-sentence explanation of what was rebalanced.`,
  notReadyHint: "Only renders when there's a token_sale rebalance in the period.",
};

const grantsDistributed: ReportSection = {
  id: "grants_distributed",
  title: "Grants Distributed",
  description:
    "Grant commitments and disbursements for the period. Foundation-shaped projects.",
  defaultEnabled: false,
  requires: (ctx) =>
    ctx.grants.some((g) => g.period === ctx.period),
  userPromptFragment: (ctx) => {
    const list = ctx.grants.filter((g) => g.period === ctx.period);
    if (list.length === 0) return "";
    const committed = list
      .filter((g) => g.status === "committed")
      .reduce((s, g) => s + Number(g.amountUsd), 0);
    const disbursed = list
      .filter((g) => g.status === "disbursed")
      .reduce((s, g) => s + Number(g.amountUsd), 0);
    const lines = list.map(
      (g) =>
        `- ${g.recipient}: ${formatUsd(Number(g.amountUsd))} (${g.status}${
          g.category ? `, ${g.category}` : ""
        })${g.notes ? ` — ${g.notes}` : ""}`
    );
    return `\n## Grants this period\n- Committed: ${formatUsd(committed)}\n- Disbursed: ${formatUsd(disbursed)}\n\nGrant list:\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Grants Distributed (CONDITIONAL)
- Only render when the input includes a "## Grants this period" block.
- Lead with two sub-bullets: total committed this period, total disbursed this period (use the figures verbatim from the input).
- If 5+ grants are listed, group by category (when present) into a short table; otherwise render as bullets.
- Don't editorialize — state recipients, amounts, status. Investors compare deployment efficiency, not narrative.`,
  notReadyHint: "Click Edit data to add grants for this period.",
};

const tokenMetrics: ReportSection = {
  id: "token_metrics",
  title: "Token Metrics",
  description:
    "Price, market cap, holders, circulating supply for the project's native token.",
  defaultEnabled: true,
  requires: (ctx) => Boolean(ctx.project.tokenSymbol),
  userPromptFragment: (ctx) => {
    const { snapshot, project } = ctx;
    const lines: string[] = [];
    if (snapshot.tokenPriceUsd) {
      lines.push(`- Price: $${Number(snapshot.tokenPriceUsd).toFixed(4)}`);
    }
    if (snapshot.tokenMarketCapUsd) {
      lines.push(
        `- Market cap: ${formatUsd(Number(snapshot.tokenMarketCapUsd))}`
      );
    }
    if (snapshot.tokenHoldersCount) {
      lines.push(`- Holders: ${snapshot.tokenHoldersCount.toLocaleString()}`);
    }
    if (snapshot.tokenCirculatingSupply) {
      lines.push(
        `- Circulating supply: ${Number(snapshot.tokenCirculatingSupply).toLocaleString()}`
      );
    }
    if (lines.length === 0) return "";
    return `\n## Token Metrics (${project.tokenSymbol ?? "Token"})\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Token Metrics (CONDITIONAL — only render if input includes a Token Metrics section)
- Holder count and change — only render the bullet if a number is provided.
- Price and market cap — only if provided.
- Circulating vs total supply — only if BOTH numbers are provided. Don't write "Circulating: X, total: Not available".
- If the entire Token Metrics block has only one or two data points, render those without listing the missing ones. Never echo "Not available" to investors.`,
  notReadyHint: "Set 'Token symbol' in Project settings.",
};

const governanceUpdates: ReportSection = {
  id: "governance_updates",
  title: "Governance Updates",
  description:
    "Proposals voted, voting turnout, key governance forum activity. DAO-shaped projects.",
  defaultEnabled: false,
  requires: (ctx) =>
    ctx.governanceProposals.some((p) => p.period === ctx.period),
  userPromptFragment: (ctx) => {
    const list = ctx.governanceProposals.filter(
      (p) => p.period === ctx.period
    );
    if (list.length === 0) return "";
    const lines = list.map((p) => {
      const tag = `[${p.status}]`;
      const link = p.url ? ` (${p.url})` : "";
      const tail = p.voteResult
        ? ` — ${p.voteResult}`
        : p.notes
          ? ` — ${p.notes}`
          : "";
      return `- ${tag} ${p.title}${link}${tail}`;
    });
    return `\n## Governance this period\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Governance Updates (CONDITIONAL)
- Only render when the input includes a "## Governance this period" block.
- 2-3 bullets max: proposals submitted, proposals passed/rejected, notable active debates.
- Quote vote results verbatim if provided. Don't speculate on outcomes for active proposals.
- Link out via the URL when present (founder may have provided Snapshot/Tally permalinks).`,
  notReadyHint: "Click Edit data to add proposals for this period.",
};

const developmentProgress: ReportSection = {
  id: "development_progress",
  title: "Development Progress",
  description:
    "GitHub activity: commits, PRs merged, active contributors this period.",
  defaultEnabled: true,
  requires: (ctx) => {
    const c = ctx.snapshot.githubCommitsCount ?? 0;
    const p = ctx.snapshot.githubPrsMerged ?? 0;
    const r = ctx.snapshot.githubContributorsActive ?? 0;
    return c + p + r > 0;
  },
  userPromptFragment: (ctx) => {
    const c = ctx.snapshot.githubCommitsCount ?? 0;
    const p = ctx.snapshot.githubPrsMerged ?? 0;
    const r = ctx.snapshot.githubContributorsActive ?? 0;
    if (c + p + r === 0) return "";
    return `\n## Development Activity\n- Commits: ${c}\n- PRs merged: ${p}\n- Active contributors: ${r}`;
  },
  systemPromptFragment: `### Development Progress (CONDITIONAL)
- GitHub activity summary (commits, PRs, contributors) — ONLY if the input's "Development Activity" block lists numbers > 0.
- If the block shows all zeros, OMIT this entire section. Don't echo zeros or "Not available".`,
  notReadyHint: "Connect a GitHub org in Project settings.",
};

const milestonesCompleted: ReportSection = {
  id: "milestones_completed",
  title: "Milestones Completed",
  description:
    "Milestones marked completed during the reporting period.",
  defaultEnabled: true,
  requires: (ctx) =>
    ctx.milestones.some((m) => m.status === "completed" && m.completedDate),
  userPromptFragment: (ctx) => {
    const recently = ctx.milestones
      .filter((m) => m.status === "completed" && m.completedDate)
      .sort((a, b) =>
        String(b.completedDate ?? "").localeCompare(
          String(a.completedDate ?? "")
        )
      )
      .slice(0, 5);
    if (recently.length === 0) return "";
    return `\n## Milestones Completed\n${recently
      .map(
        (m) =>
          `- ${m.title}${m.completedDate ? ` (${m.completedDate})` : ""}${m.description ? ` — ${m.description}` : ""}`
      )
      .join("\n")}`;
  },
  systemPromptFragment: `### Milestones Completed (CONDITIONAL)
- Only render if the input includes a "## Milestones Completed" block.
- One bullet per milestone with the date and a tight one-sentence description.
- Don't editorialize ("massive achievement!"); just state what shipped.`,
  notReadyHint: "Mark a milestone as completed in Project settings.",
};

const partnersIntegrations: ReportSection = {
  id: "partners_integrations",
  title: "Partners & Integrations",
  description:
    "New partnerships, integrations, exchange listings, bridges. Off by default — user opts in.",
  defaultEnabled: false,
  requires: (ctx) => ctx.partners.some((p) => p.period === ctx.period),
  userPromptFragment: (ctx) => {
    const list = ctx.partners.filter((p) => p.period === ctx.period);
    if (list.length === 0) return "";
    const lines = list.map((p) => {
      const type = p.type ? ` (${p.type})` : "";
      const link = p.url ? ` — ${p.url}` : "";
      const tail = p.notes ? ` · ${p.notes}` : "";
      return `- ${p.name}${type}${link}${tail}`;
    });
    return `\n## Partners this period\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Partners & Integrations (CONDITIONAL)
- Only render when the input includes a "## Partners this period" block.
- Bullets only. No marketing prose ("excited to announce", "thrilled to partner with"). Just: who, what kind, link.
- Group consecutively when multiple share a type (e.g. several listings, several bridges).`,
  notReadyHint: "Click Edit data to add partners announced this period.",
};

const anomalies: ReportSection = {
  id: "anomalies",
  title: "Anomalies",
  description:
    "Statistical anomalies vs. trailing average — sudden cost spikes, dev-activity drops, etc.",
  defaultEnabled: true,
  // gated by the anomaly detector — handled in report-generator, not here
  requires: () => true,
  userPromptFragment: () => "",
  systemPromptFragment: `### Anomalies (CONDITIONAL)
- If the input contains an "Anomalies" section listing metric deltas vs trailing average, mention each one in the Executive Summary with one short sentence per anomaly.
- Don't fabricate causes — if no contextual reason is available, write "warrants investigation" or "see breakdown below". Never invent reasons.
- Critical-severity anomalies (>100% change) deserve a sentence in their own; minor anomalies can be combined ("payroll up 35%, marketing down 40%").
- If no Anomalies section is provided in input, do NOT add this commentary.`,
};

const lookingAhead: ReportSection = {
  id: "looking_ahead",
  title: "Looking Ahead",
  description:
    "Forward-looking commentary tied to active milestones or recent funding round.",
  defaultEnabled: true,
  requires: (ctx) => {
    const hasActive = ctx.milestones.some(
      (m) =>
        m.status === "in_progress" ||
        m.status === "planned" ||
        m.status === "delayed"
    );
    return hasActive || Boolean(ctx.project.lastFundingRound);
  },
  userPromptFragment: (ctx) => {
    const active = ctx.milestones.filter(
      (m) =>
        m.status === "in_progress" ||
        m.status === "planned" ||
        m.status === "delayed"
    );
    if (active.length === 0) return "";
    return `\n## Active / Upcoming Milestones\n${active
      .map(
        (m) =>
          `- [${m.status}] ${m.title}${m.targetDate ? ` (target: ${m.targetDate})` : ""}${m.description ? ` — ${m.description}` : ""}`
      )
      .join("\n")}`;
  },
  systemPromptFragment: `### Looking Ahead (CONDITIONAL)
- Include this section ONLY when the input contains either active milestones or a recent funding round.
- If neither is present, OMIT the section entirely. Never write generic placeholders like "the team plans to focus on continuing core development" or "specific milestones are not available at this time" — silence is better than filler.
- When included: name specific milestones (with target dates if known) or tie next-month focus to the funding round just raised.`,
  notReadyHint: "Add an active milestone or recent funding round.",
};

const asks: ReportSection = {
  id: "asks",
  title: "Asks",
  description:
    "Specific requests to investors (intros, governance votes, hiring help). Off by default — opt in when relevant.",
  defaultEnabled: false,
  // Asks are NOT period-bound — they live until founder marks resolved.
  // Open asks ride along with every report until closed.
  requires: (ctx) => ctx.asks.some((a) => a.status === "open"),
  userPromptFragment: (ctx) => {
    const list = ctx.asks.filter((a) => a.status === "open");
    if (list.length === 0) return "";
    const lines = list.map(
      (a) => `- ${a.request}${a.category ? ` _(${a.category})_` : ""}`
    );
    return `\n## Asks (open)\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Asks (CONDITIONAL)
- Only render when the input contains an "## Asks (open)" block.
- One bullet per ask with the specific action required (intro to X, vote on proposal Y, hire Z role).
- Preserve the founder's wording. Don't paraphrase.
- Don't write "no asks this period" — silence beats placeholder.`,
  notReadyHint: "Click Edit data to add open asks.",
};

const qaHighlights: ReportSection = {
  id: "qa_highlights",
  title: "Q&A Highlights",
  description:
    "Curated questions + answers from a tokenholder call or AMA. Manually entered.",
  defaultEnabled: false,
  requires: (ctx) =>
    ctx.qaHighlights.some((q) => q.period === ctx.period),
  userPromptFragment: (ctx) => {
    const list = ctx.qaHighlights
      .filter((q) => q.period === ctx.period)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    if (list.length === 0) return "";
    const blocks = list.map(
      (q) =>
        `Q: ${q.question}\nA: ${q.answer}${q.askedBy ? ` _— ${q.askedBy}_` : ""}`
    );
    return `\n## Q&A this period\n${blocks.join("\n\n")}`;
  },
  systemPromptFragment: `### Q&A Highlights (CONDITIONAL)
- Only render when the input contains a "## Q&A this period" block.
- Format: "Q: ..." / "A: ..." pairs. Two-three pairs max — pick the most substantive.
- Don't paraphrase the founder's answers heavily; preserve their voice.
- Attribute the asker only when provided (\`_— @username_\` style is fine).`,
  notReadyHint: "Click Edit data to add Q&A from this period's call.",
};

// ─── library + helpers ────────────────────────────────────────────────────

/**
 * The canonical ordered list. Constructor renders this in this order;
 * stored configs override only the enabled flag and (optionally) the
 * order when user reorders.
 */
export const SECTION_LIBRARY: readonly ReportSection[] = [
  executiveSummary,
  wins,
  lowsConcerns,
  treasuryOverview,
  treasuryByChain,
  previousMonthComparison,
  financialHealth,
  expenseBreakdown,
  treasuryOperations,
  grantsDistributed,
  tokenMetrics,
  governanceUpdates,
  developmentProgress,
  milestonesCompleted,
  partnersIntegrations,
  anomalies,
  lookingAhead,
  asks,
  qaHighlights,
];

const SECTION_BY_ID: Record<string, ReportSection> = Object.fromEntries(
  SECTION_LIBRARY.map((s) => [s.id, s])
);

/**
 * Plain-data view of the library. Safe to ship to the client (no closures,
 * no server-only deps). The constructor UI iterates this; the resolver +
 * prompt builders stay server-side and consume the full `SECTION_LIBRARY`.
 */
export interface ReportSectionMeta {
  id: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
  /** Static fallback hint surfaced when readiness data isn't loaded yet. */
  notReadyHint?: string;
}

export const SECTION_LIBRARY_META: readonly ReportSectionMeta[] =
  SECTION_LIBRARY.map(({ id, title, description, defaultEnabled, notReadyHint }) => ({
    id,
    title,
    description,
    defaultEnabled,
    notReadyHint,
  }));

/** Per-section readiness verdict for the constructor UI. */
export interface SectionReadiness {
  id: string;
  ready: boolean;
  /** Human reason — present when `ready` is false. */
  reason?: string;
}

/**
 * Run every section's `requires(ctx)` against the current data and
 * pair the verdict with a human-readable reason. Powers the editor's
 * status chips ("Ready", "Needs ≥2 chains", "Coming soon"). The
 * editor itself can't run requires() — those closures live in the
 * server module — so the readiness map flows through tRPC.
 */
export function evaluateReadiness(
  ctx: ReportSectionContext
): SectionReadiness[] {
  return SECTION_LIBRARY.map((s) => {
    const ready = s.requires(ctx);
    return {
      id: s.id,
      ready,
      reason: ready ? undefined : s.notReadyHint ?? "Not yet ready",
    };
  });
}

export function getSectionById(id: string): ReportSection | undefined {
  return SECTION_BY_ID[id];
}

/** Stored config shape — what `projects.reportSections` JSONB holds. */
export interface SectionConfigEntry {
  id: string;
  enabled: boolean;
}

/**
 * Resolve the effective section list for a project. When the stored
 * config is null (legacy projects + freshly created), use the library
 * defaults. When stored, walk the stored array in its order, drop
 * disabled entries, ignore unknown ids (forward/backward-compat).
 *
 * Sections in the library that aren't in the stored config are
 * appended at the end with their default enabled flag — so adding a
 * new section to the library doesn't silently disappear from existing
 * reports.
 */
export function resolveSections(
  stored: SectionConfigEntry[] | null
): ReportSection[] {
  if (!stored || stored.length === 0) {
    return SECTION_LIBRARY.filter((s) => s.defaultEnabled);
  }
  const seenIds = new Set<string>();
  const result: ReportSection[] = [];
  for (const entry of stored) {
    if (!entry.enabled) {
      seenIds.add(entry.id);
      continue;
    }
    const section = SECTION_BY_ID[entry.id];
    if (!section) continue; // ignore unknown ids (e.g. removed in a deploy)
    seenIds.add(entry.id);
    result.push(section);
  }
  // Append library sections that the stored config doesn't mention,
  // honoring their defaultEnabled.
  for (const s of SECTION_LIBRARY) {
    if (!seenIds.has(s.id) && s.defaultEnabled) result.push(s);
  }
  return result;
}

export function buildSystemPrompt(enabled: ReportSection[]): string {
  const sectionRules = enabled
    .map((s) => s.systemPromptFragment)
    .filter(Boolean)
    .join("\n\n");
  return `You are Vault Brief AI, a financial analyst for Web3 projects.

Generate a monthly investor report in Markdown format from the provided treasury data.

## Report Structure (only render the sections below, in the order shown):

${sectionRules}

## Rules:
- Use ONLY the provided data. Never invent numbers.
- **Silence beats placeholders.** If a data point is missing, OMIT the bullet/row/sub-section entirely. Never write "Not available", "N/A", "—", "(no data)", "TBD", or any equivalent filler in the final report. Investors should not see traces of missing data — they should see a tighter report instead.
- The only exception: top-level numbered KPIs (treasury total, monthly burn) where dropping the number would leave the section blank. In that one case, write "Not yet available — first sync" with a brief explanation.
- Keep the tone professional but accessible. Write for a VC partner, not an accountant.
- **Never include cents.** No ".00", no ".50". Round and abbreviate:
  - Amounts >= $1,000,000 → "$1.2M" (one decimal)
  - Amounts >= $1,000 → "$48K" (no decimals, K-suffix)
  - Amounts < $1,000 → "$420" (whole dollars)
  Inputs in this prompt are already pre-formatted — copy that style verbatim.
- Compare to previous month whenever data is available.
- Do not use excessive formatting. Clean, readable paragraphs.
- Total length: 600-1200 words.`;
}

export function buildUserPrompt(
  ctx: ReportSectionContext,
  enabled: ReportSection[]
): string {
  // Project context comes first regardless of section order — the model
  // needs to know who it's writing about before reading any data.
  const ctxLines: string[] = [`- Project: ${ctx.project.name}`];
  if (ctx.project.teamSize) ctxLines.push(`- Team size: ${ctx.project.teamSize}`);
  if (ctx.project.foundedDate) ctxLines.push(`- Founded: ${ctx.project.foundedDate}`);
  if (ctx.project.lastFundingRound) {
    ctxLines.push(`- Last funding round: ${ctx.project.lastFundingRound}`);
  }
  if (ctx.project.lastFundingAmount) {
    ctxLines.push(
      `- Amount raised: ${formatUsd(Number(ctx.project.lastFundingAmount))}`
    );
  }
  ctxLines.push(`- Report period: ${formatDate(ctx.snapshot.snapshotDate)}`);

  const dataBlocks = enabled
    .filter((s) => s.requires(ctx))
    .map((s) => s.userPromptFragment(ctx))
    .filter((s) => s && s.trim().length > 0);

  return `\n## Project Context\n${ctxLines.join("\n")}${dataBlocks.join("")}

Generate the investor report now.`;
}
