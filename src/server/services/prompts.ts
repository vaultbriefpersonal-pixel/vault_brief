import type { TreasurySnapshot, Project, Milestone } from "@/server/db/schema";
import { formatUsd, formatDate } from "@/lib/utils";

export const REPORT_SYSTEM_PROMPT = `You are VaultBrief AI, a financial analyst for Web3 projects.

Generate a monthly investor report in Markdown format from the provided treasury data.

## Report Structure:

### Executive Summary
3-4 sentences. State the treasury position, biggest change vs last month, and one forward-looking statement. Use exact numbers. Never fabricate data.

### Treasury Overview
- Table: Asset | Balance | % of Total
- **Only include rows where Balance > $0.** Skip categories the project does not currently hold — do NOT emit "$0 / 0%" placeholder rows. If the input doesn't list a balance for an asset, that asset doesn't exist in this treasury; pretend it's not even on the menu.
- Total treasury value
- Change vs previous month (absolute and percentage)

### Financial Health
- Monthly burn rate
- Runway in months
- Operating expense breakdown by category (table)
- Notable expense changes vs previous month

### Treasury Operations (only if present in input)
- Render this section ONLY when the input lists "Treasury operations" with a non-zero amount.
- token_sale outflows are treasury reallocations (e.g. swapping native token for stablecoins or vice versa), NOT operating expenses. Never include them in the expense breakdown table; show them separately here with a one-sentence explanation of what was rebalanced.

### Token Metrics (if applicable)
- Holder count and change
- Price and market cap
- Circulating vs total supply

### Development Progress
- GitHub activity summary (commits, PRs, contributors)
- Milestone status updates

### Key Highlights
- 2-3 bullet points of positive developments
- 1-2 bullet points of concerns or risks (be honest)

### Looking Ahead (CONDITIONAL — see rules)
- Include this section ONLY when the input contains either active milestones or a recent funding round.
- If neither is present, OMIT the section entirely. Never write generic placeholders like "the team plans to focus on continuing core development" or "specific milestones are not available at this time" — silence is better than filler.
- When included: name specific milestones (with target dates if known) or tie next-month focus to the funding round just raised.

### Anomalies (CONDITIONAL)
- If the input contains an "Anomalies" section listing metric deltas vs trailing average, mention each one in the Executive Summary with one short sentence per anomaly.
- Don't fabricate causes — if no contextual reason is available, write "warrants investigation" or "see breakdown below". Never invent reasons.
- Critical-severity anomalies (>100% change) deserve a sentence in their own; minor anomalies can be combined ("payroll up 35%, marketing down 40%").
- If no Anomalies section is provided in input, do NOT add this commentary — just the standard Executive Summary.

## Rules:
- Use ONLY the provided data. Never invent numbers.
- If a data point is missing, say "Not available" rather than guessing.
- Keep the tone professional but accessible. Write for a VC partner, not an accountant.
- **Never include cents.** No ".00", no ".50". Round and abbreviate:
  - Amounts >= $1,000,000 → "$1.2M" (one decimal)
  - Amounts >= $1,000 → "$48K" (no decimals, K-suffix)
  - Amounts < $1,000 → "$420" (whole dollars)
  Inputs in this prompt are already pre-formatted — copy that style verbatim.
- Compare to previous month whenever data is available.
- Do not use excessive formatting. Clean, readable paragraphs.
- Total length: 600-1200 words.`;

export function buildReportPrompt(
  snapshot: TreasurySnapshot,
  prevSnapshot: TreasurySnapshot | undefined | null,
  project: Project,
  projectMilestones: Milestone[] = []
): string {
  const period = `${snapshot.snapshotDate}`;

  // Only emit asset lines for balances the project actually holds. Sending
  // "Other assets: $0.00" or a $0 native-token line was causing the model to
  // dutifully render those rows in the Markdown table, leading to "$0 / 0%"
  // entries that look like missing data. Empty categories: drop entirely.
  const treasuryLines: string[] = [
    `- Total balance: ${formatUsd(Number(snapshot.totalBalanceUsd ?? 0))}`,
  ];
  const stables = Number(snapshot.stablecoinsUsd ?? 0);
  if (stables > 0) treasuryLines.push(`- Stablecoins: ${formatUsd(stables)}`);
  const ethUsd = Number(snapshot.ethUsd ?? 0);
  if (ethUsd > 0) treasuryLines.push(`- ETH/WETH: ${formatUsd(ethUsd)}`);
  const nativeUsd = Number(snapshot.nativeTokenUsd ?? 0);
  if (project.tokenSymbol && nativeUsd > 0) {
    treasuryLines.push(
      `- ${project.tokenSymbol} (native token): ${formatUsd(nativeUsd)}`
    );
  }
  const otherUsd = Number(snapshot.otherAssetsUsd ?? 0);
  if (otherUsd > 0) treasuryLines.push(`- Other assets: ${formatUsd(otherUsd)}`);

  const treasurySection = `
## Current Treasury (${period})
${treasuryLines.join("\n")}

${
  prevSnapshot
    ? `## Previous Month Treasury
- Total balance: ${formatUsd(Number(prevSnapshot.totalBalanceUsd ?? 0))}
- Change: ${formatUsd(Number(snapshot.totalBalanceUsd ?? 0) - Number(prevSnapshot.totalBalanceUsd ?? 0))} (${(((Number(snapshot.totalBalanceUsd ?? 0) - Number(prevSnapshot.totalBalanceUsd ?? 0)) / Number(prevSnapshot.totalBalanceUsd || 1)) * 100).toFixed(1)}%)`
    : "## Previous Month: No data available (first report)"
}`;

  const financialSection = `
## Financial Metrics
- Monthly burn rate: ${snapshot.burnRateUsd ? formatUsd(Number(snapshot.burnRateUsd)) : "Not available"}
- Runway: ${snapshot.runwayMonths ? `${Number(snapshot.runwayMonths).toFixed(1)} months` : "Not available"}
- Total inflows: ${snapshot.totalInflowsUsd ? formatUsd(Number(snapshot.totalInflowsUsd)) : "Not available"}
- Total outflows: ${snapshot.totalOutflowsUsd ? formatUsd(Number(snapshot.totalOutflowsUsd)) : "Not available"}

${(() => {
  if (!snapshot.expensesByCategory) return "Operating expenses: Not available";
  const all = snapshot.expensesByCategory as Record<string, number>;
  const tokenSale = all.token_sale ?? 0;
  const operating = Object.entries(all).filter(
    ([k, v]) => v > 0 && k !== "token_sale"
  );
  const opLines = operating.length
    ? operating.map(([k, v]) => `- ${k}: ${formatUsd(v)}`).join("\n")
    : "- (no operating expenses in period)";
  const treasuryLine =
    tokenSale > 0
      ? `\n\nTreasury operations (NOT operating expenses — stablecoin/native-token rebalancing):\n- token_sale: ${formatUsd(tokenSale)}`
      : "";
  return `Operating expenses (excludes treasury reallocation):\n${opLines}${treasuryLine}`;
})()}

${
  snapshot.incomeByCategory
    ? `Income breakdown:
${Object.entries(snapshot.incomeByCategory as Record<string, number>)
  .filter(([, v]) => v > 0)
  .map(([k, v]) => `- ${k}: ${formatUsd(v)}`)
  .join("\n") || "- (no inflows in period)"}`
    : ""
}`;

  const githubSection =
    snapshot.githubCommitsCount !== null
      ? `
## Development Activity
- Commits: ${snapshot.githubCommitsCount}
- PRs merged: ${snapshot.githubPrsMerged ?? "N/A"}
- Active contributors: ${snapshot.githubContributorsActive ?? "N/A"}`
      : "\n## Development Activity\nNot available (GitHub not connected)";

  const tokenSection =
    snapshot.tokenPriceUsd || snapshot.tokenHoldersCount
      ? `
## Token Metrics (${project.tokenSymbol ?? "Token"})
${snapshot.tokenPriceUsd ? `- Price: $${Number(snapshot.tokenPriceUsd).toFixed(4)}` : ""}
${snapshot.tokenMarketCapUsd ? `- Market cap: ${formatUsd(Number(snapshot.tokenMarketCapUsd))}` : ""}
${snapshot.tokenHoldersCount ? `- Holders: ${snapshot.tokenHoldersCount.toLocaleString()}` : ""}
${snapshot.tokenCirculatingSupply ? `- Circulating supply: ${Number(snapshot.tokenCirculatingSupply).toLocaleString()}` : ""}`
      : "";

  const projectContext = `
## Project Context
- Project: ${project.name}
- Team size: ${project.teamSize ?? "Not specified"}
- Founded: ${project.foundedDate ?? "Not specified"}
- Last funding round: ${project.lastFundingRound ?? "Not specified"}
- Amount raised: ${project.lastFundingAmount ? formatUsd(Number(project.lastFundingAmount)) : "Not specified"}
- Report period: ${formatDate(period)}`;

  // Milestone block — only emit when there's something specific to say.
  // System prompt instructs the model to silence the "Looking Ahead" section
  // when neither milestones nor a fresh funding round are present, so an
  // empty block is fine; we just don't render the header.
  const milestoneSection = (() => {
    const active = projectMilestones.filter(
      (m) => m.status === "in_progress" || m.status === "planned" || m.status === "delayed"
    );
    const recentlyCompleted = projectMilestones
      .filter((m) => m.status === "completed" && m.completedDate)
      .sort((a, b) =>
        String(b.completedDate ?? "").localeCompare(String(a.completedDate ?? ""))
      )
      .slice(0, 3);
    if (active.length === 0 && recentlyCompleted.length === 0) return "";
    const fmt = (m: Milestone) => {
      const date = m.targetDate ? ` (target: ${m.targetDate})` : m.completedDate ? ` (completed: ${m.completedDate})` : "";
      const desc = m.description ? ` — ${m.description}` : "";
      return `- [${m.status}] ${m.title}${date}${desc}`;
    };
    return `
## Milestones
${active.length ? `Active / upcoming:\n${active.map(fmt).join("\n")}` : ""}
${recentlyCompleted.length ? `\nRecently completed:\n${recentlyCompleted.map(fmt).join("\n")}` : ""}`.trim();
  })();

  return `${projectContext}
${treasurySection}
${financialSection}
${githubSection}
${tokenSection}
${milestoneSection ? "\n" + milestoneSection : ""}

Generate the investor report now.`;
}

export function validateReportNumbers(
  markdown: string,
  snapshot: TreasurySnapshot
): { passed: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check that the total balance figure appears in some form in the report
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
