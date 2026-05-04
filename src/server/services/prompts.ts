import type { TreasurySnapshot, Project, Milestone } from "@/server/db/schema";
import { formatUsd, formatDate } from "@/lib/utils";

export const REPORT_SYSTEM_PROMPT = `You are Vault Brief AI, a financial analyst for Web3 projects.

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
- Monthly burn rate (only if available)
- Runway in months (only if available)
- Operating expense breakdown by category as a table — but ONLY if the input lists at least one operating expense category. If the input says "(no operating expenses in period)" or "Not available", omit the table and that bullet entirely.
- Notable expense changes vs previous month — ONLY if a previous month's data was provided AND there's a real delta to discuss. If no previous month exists, skip this bullet; do not write "Not available".

### Treasury Operations (only if present in input)
- Render this section ONLY when the input lists "Treasury operations" with a non-zero amount.
- token_sale outflows are treasury reallocations (e.g. swapping native token for stablecoins or vice versa), NOT operating expenses. Never include them in the expense breakdown table; show them separately here with a one-sentence explanation of what was rebalanced.

### Token Metrics (CONDITIONAL — only render if input includes a Token Metrics section)
- Holder count and change — only render the bullet if a number is provided
- Price and market cap — only if provided
- Circulating vs total supply — only if BOTH numbers are provided. Don't write "Circulating: X, total: Not available".
- If the entire Token Metrics block has only one or two data points, render those without listing the missing ones. Never echo "Not available" to investors.

### Development Progress
- GitHub activity summary (commits, PRs, contributors) — ONLY if the input's "Development Activity" block lists numbers. If the block says "Not available (GitHub not connected)" or shows all zeros, OMIT this entire section. Don't echo zeros or "Not available".
- Milestone status updates: only render this bullet if the input includes a "## Milestones" block. If absent, skip it silently — the "Looking Ahead" section already handles forward-looking commentary.

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

export function buildReportPrompt(
  snapshot: TreasurySnapshot,
  prevSnapshot: TreasurySnapshot | undefined | null,
  project: Project,
  projectMilestones: Milestone[] = []
): string {
  const period = `${snapshot.snapshotDate}`;

  // Only emit asset lines for balances the project actually holds.
  //
  // Two filters apply:
  //   1) Drop $0 categories — otherwise the LLM emits "$0 / 0%" rows that
  //      read like missing data.
  //   2) Drop categories that are < 0.1% of total — they round to "0.0%"
  //      in the table anyway, and dust ($79 of a $73M treasury) is a
  //      distraction in an investor narrative. The treasury total stays
  //      accurate; we just suppress the "Other assets | $79 | 0.0%" row.
  const total = Number(snapshot.totalBalanceUsd ?? 0);
  const minSignificant = total > 0 ? total * 0.001 : 0; // 0.1% of total
  const treasuryLines: string[] = [
    `- Total balance: ${formatUsd(total)}`,
  ];
  const stables = Number(snapshot.stablecoinsUsd ?? 0);
  if (stables > minSignificant) {
    treasuryLines.push(`- Stablecoins: ${formatUsd(stables)}`);
  }
  const ethUsd = Number(snapshot.ethUsd ?? 0);
  if (ethUsd > minSignificant) {
    treasuryLines.push(`- ETH/WETH: ${formatUsd(ethUsd)}`);
  }
  const nativeUsd = Number(snapshot.nativeTokenUsd ?? 0);
  if (project.tokenSymbol && nativeUsd > minSignificant) {
    treasuryLines.push(
      `- ${project.tokenSymbol} (native token): ${formatUsd(nativeUsd)}`
    );
  }
  const otherUsd = Number(snapshot.otherAssetsUsd ?? 0);
  if (otherUsd > minSignificant) {
    treasuryLines.push(`- Other assets: ${formatUsd(otherUsd)}`);
  }

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

  // Build financial bullets array — drop missing values so the model has
  // nothing to echo. The system prompt's "silence beats placeholders" rule
  // is reinforced by simply not feeding it strings to copy.
  const finLines: string[] = [];
  if (snapshot.burnRateUsd) {
    finLines.push(`- Monthly burn rate: ${formatUsd(Number(snapshot.burnRateUsd))}`);
  }
  if (snapshot.runwayMonths) {
    finLines.push(`- Runway: ${Number(snapshot.runwayMonths).toFixed(1)} months`);
  }
  if (snapshot.totalInflowsUsd) {
    finLines.push(`- Total inflows: ${formatUsd(Number(snapshot.totalInflowsUsd))}`);
  }
  if (snapshot.totalOutflowsUsd) {
    finLines.push(`- Total outflows: ${formatUsd(Number(snapshot.totalOutflowsUsd))}`);
  }

  const expensesBlock = (() => {
    if (!snapshot.expensesByCategory) return "";
    const all = snapshot.expensesByCategory as Record<string, number>;
    const tokenSale = all.token_sale ?? 0;
    const operating = Object.entries(all).filter(
      ([k, v]) => v > 0 && k !== "token_sale"
    );
    if (operating.length === 0 && tokenSale === 0) return "";
    const opLines = operating.length
      ? operating.map(([k, v]) => `- ${k}: ${formatUsd(v)}`).join("\n")
      : "";
    const opBlock = opLines
      ? `\nOperating expenses (excludes treasury reallocation):\n${opLines}`
      : "";
    const treasuryLine =
      tokenSale > 0
        ? `\n\nTreasury operations (NOT operating expenses — stablecoin/native-token rebalancing):\n- token_sale: ${formatUsd(tokenSale)}`
        : "";
    return `${opBlock}${treasuryLine}`;
  })();

  const incomeBlock = (() => {
    if (!snapshot.incomeByCategory) return "";
    const entries = Object.entries(
      snapshot.incomeByCategory as Record<string, number>
    ).filter(([, v]) => v > 0);
    if (entries.length === 0) return "";
    return `\nIncome breakdown:\n${entries
      .map(([k, v]) => `- ${k}: ${formatUsd(v)}`)
      .join("\n")}`;
  })();

  const financialSection =
    finLines.length > 0 || expensesBlock || incomeBlock
      ? `
## Financial Metrics${finLines.length ? "\n" + finLines.join("\n") : ""}${expensesBlock}${incomeBlock}`
      : "";

  // GitHub: only emit when there's actual activity. Zeros across the board
  // mean the org has no public repos OR sync hit a token wall — either way
  // we shouldn't tell the LLM to write about commits that don't exist.
  const ghCommits = snapshot.githubCommitsCount ?? 0;
  const ghPrs = snapshot.githubPrsMerged ?? 0;
  const ghContribs = snapshot.githubContributorsActive ?? 0;
  const githubSection =
    ghCommits + ghPrs + ghContribs > 0
      ? `
## Development Activity
- Commits: ${ghCommits}
- PRs merged: ${ghPrs}
- Active contributors: ${ghContribs}`
      : "";

  // Token Metrics: only emit lines we have. Don't pad with N/A.
  const tokenLines: string[] = [];
  if (snapshot.tokenPriceUsd) {
    tokenLines.push(`- Price: $${Number(snapshot.tokenPriceUsd).toFixed(4)}`);
  }
  if (snapshot.tokenMarketCapUsd) {
    tokenLines.push(
      `- Market cap: ${formatUsd(Number(snapshot.tokenMarketCapUsd))}`
    );
  }
  if (snapshot.tokenHoldersCount) {
    tokenLines.push(
      `- Holders: ${snapshot.tokenHoldersCount.toLocaleString()}`
    );
  }
  if (snapshot.tokenCirculatingSupply) {
    tokenLines.push(
      `- Circulating supply: ${Number(snapshot.tokenCirculatingSupply).toLocaleString()}`
    );
  }
  const tokenSection =
    tokenLines.length > 0
      ? `
## Token Metrics (${project.tokenSymbol ?? "Token"})
${tokenLines.join("\n")}`
      : "";

  // Project Context: drop "Not specified" placeholders for the same reason —
  // they're noise and the model dutifully echoes them in the report header.
  const ctxLines: string[] = [`- Project: ${project.name}`];
  if (project.teamSize) ctxLines.push(`- Team size: ${project.teamSize}`);
  if (project.foundedDate) ctxLines.push(`- Founded: ${project.foundedDate}`);
  if (project.lastFundingRound) {
    ctxLines.push(`- Last funding round: ${project.lastFundingRound}`);
  }
  if (project.lastFundingAmount) {
    ctxLines.push(
      `- Amount raised: ${formatUsd(Number(project.lastFundingAmount))}`
    );
  }
  ctxLines.push(`- Report period: ${formatDate(period)}`);
  const projectContext = `
## Project Context
${ctxLines.join("\n")}`;

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
