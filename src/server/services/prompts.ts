import type { TreasurySnapshot, Project } from "@/server/db/schema";
import { formatUsd, formatDate } from "@/lib/utils";

export const REPORT_SYSTEM_PROMPT = `You are VaultBrief AI, a financial analyst for Web3 projects.

Generate a monthly investor report in Markdown format from the provided treasury data.

## Report Structure:

### Executive Summary
3-4 sentences. State the treasury position, biggest change vs last month, and one forward-looking statement. Use exact numbers. Never fabricate data.

### Treasury Overview
- Table: Asset | Balance | % of Total
- Total treasury value
- Change vs previous month (absolute and percentage)

### Financial Health
- Monthly burn rate
- Runway in months
- Expense breakdown by category (table)
- Notable expense changes vs previous month

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

### Looking Ahead
- What the team plans to focus on next month
- Any upcoming milestones or events

## Rules:
- Use ONLY the provided data. Never invent numbers.
- If a data point is missing, say "Not available" rather than guessing.
- Keep the tone professional but accessible. Write for a VC partner, not an accountant.
- Use exact USD amounts with appropriate rounding ($1.2M not $1,234,567.89).
- Compare to previous month whenever data is available.
- Do not use excessive formatting. Clean, readable paragraphs.
- Total length: 600-1200 words.`;

export function buildReportPrompt(
  snapshot: TreasurySnapshot,
  prevSnapshot: TreasurySnapshot | undefined | null,
  project: Project
): string {
  const period = `${snapshot.snapshotDate}`;

  const treasurySection = `
## Current Treasury (${period})
- Total balance: ${formatUsd(Number(snapshot.totalBalanceUsd ?? 0))}
- Stablecoins: ${formatUsd(Number(snapshot.stablecoinsUsd ?? 0))}
- ETH/WETH: ${formatUsd(Number(snapshot.ethUsd ?? 0))}
${project.tokenSymbol ? `- ${project.tokenSymbol} (native token): ${formatUsd(Number(snapshot.nativeTokenUsd ?? 0))}` : ""}
- Other assets: ${formatUsd(Number(snapshot.otherAssetsUsd ?? 0))}

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

${
  snapshot.expensesByCategory
    ? `Expense breakdown:
${Object.entries(snapshot.expensesByCategory as Record<string, number>)
  .filter(([, v]) => v > 0)
  .map(([k, v]) => `- ${k}: ${formatUsd(v)}`)
  .join("\n")}`
    : "Expense breakdown: Not available"
}

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

  return `${projectContext}
${treasurySection}
${financialSection}
${githubSection}
${tokenSection}

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
