// Phase 5 smoke verification for the report-template constructor.
//
// No LLM calls — we just exercise buildReportPrompts() with synthetic
// snapshot/project/milestones data and assert the resolved prompt
// reflects the per-project config.
//
// Test cases:
//   1) null config              → product defaults (matches old prompt set)
//   2) toggle off treasury_ops  → that section absent from system prompt
//   3) toggle on asks for proj  → asks section present in system prompt
//   4) reorder governance ↑     → governance appears before financial_health
//
// Run:    node scripts/smoke-report-sections.mjs
//
// Uses tsx so we can import the TS module directly.

// We import the TS modules through a tsx-spawned child process via the
// shebang in the runner; here we just re-export the entry. To keep the
// runner self-contained, this script must be invoked with:
//   npx tsx scripts/smoke-report-sections.mjs
// (renamed to .ts loader path below if needed).

const { buildReportPrompts } = await import(
  "../src/server/services/prompts.ts"
);
const { SECTION_LIBRARY_META } = await import(
  "../src/server/services/report-sections.ts"
);

// ─── fixtures ──────────────────────────────────────────────────────────────

const project = {
  id: "p1",
  name: "Test Protocol",
  slug: "test",
  tokenSymbol: "TEST",
  teamSize: 12,
  foundedDate: "2023-01-15",
  lastFundingRound: "Seed",
  lastFundingAmount: "5000000",
  githubOrg: "test-org",
};

const snapshot = {
  id: "s1",
  projectId: "p1",
  snapshotDate: "2026-04-30",
  totalBalanceUsd: "8500000",
  stablecoinsUsd: "5200000",
  ethUsd: "2100000",
  nativeTokenUsd: "1100000",
  otherAssetsUsd: "100000",
  burnRateUsd: "320000",
  runwayMonths: "16.3",
  totalInflowsUsd: "120000",
  totalOutflowsUsd: "440000",
  expensesByCategory: { payroll: 280000, infra: 35000, token_sale: 150000 },
  incomeByCategory: { grants: 120000 },
  balancesByChain: { ethereum: 6800000, optimism: 1200000, base: 500000 },
  githubCommitsCount: 142,
  githubPrsMerged: 38,
  githubContributorsActive: 9,
  tokenPriceUsd: "0.42",
  tokenMarketCapUsd: "12500000",
  tokenHoldersCount: 4820,
  tokenCirculatingSupply: "29761904",
};

const prevSnapshot = {
  ...snapshot,
  id: "s0",
  snapshotDate: "2026-03-31",
  totalBalanceUsd: "8200000",
};

const milestones = [
  {
    id: "m1",
    projectId: "p1",
    title: "Mainnet v2 launch",
    status: "in_progress",
    targetDate: "2026-06-15",
    description: "Production deploy of v2 contracts",
  },
  {
    id: "m2",
    projectId: "p1",
    title: "Audit closed",
    status: "completed",
    completedDate: "2026-04-12",
  },
];

// ─── assertions ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name, cond, hint = "") {
  if (cond) {
    console.log(`✓ ${name}`);
    passed++;
  } else {
    console.error(`✗ ${name}${hint ? ` — ${hint}` : ""}`);
    failed++;
  }
}

// 1) null config = product defaults
{
  const { system, user, enabled } = buildReportPrompts(
    snapshot,
    prevSnapshot,
    project,
    milestones,
    null
  );
  const ids = enabled.map((s) => s.id);
  const defaults = SECTION_LIBRARY_META.filter((m) => m.defaultEnabled).map(
    (m) => m.id
  );
  check(
    "null config resolves to defaultEnabled sections",
    JSON.stringify(ids) === JSON.stringify(defaults),
    `got [${ids.join(",")}] expected [${defaults.join(",")}]`
  );
  check(
    "system prompt mentions Executive Summary",
    system.includes("### Executive Summary")
  );
  check(
    "system prompt mentions Wins (new section)",
    system.includes("### Wins")
  );
  check(
    "system prompt mentions Treasury Overview",
    system.includes("### Treasury Overview")
  );
  check(
    "user prompt has Project Context block",
    user.includes("## Project Context")
  );
  check(
    "user prompt has Treasury by chain (3 chains in fixture)",
    user.includes("## Treasury by chain")
  );
  check(
    "user prompt has Token Metrics (project has tokenSymbol)",
    user.includes("## Token Metrics")
  );
  check(
    "user prompt has Development Activity (commits > 0)",
    user.includes("## Development Activity")
  );
  check(
    "user prompt has Active / Upcoming Milestones",
    user.includes("## Active / Upcoming Milestones")
  );
  check(
    "user prompt has Milestones Completed",
    user.includes("## Milestones Completed")
  );
  // Default config: token_sale is set in fixture, treasury_operations is default-on
  check(
    "user prompt has Treasury operations block (token_sale=150000)",
    user.includes("Treasury operations")
  );
}

// 2) toggle off treasury_operations
{
  const config = SECTION_LIBRARY_META.map((m) => ({
    id: m.id,
    enabled: m.id === "treasury_operations" ? false : m.defaultEnabled,
  }));
  const { system, user } = buildReportPrompts(
    snapshot,
    prevSnapshot,
    project,
    milestones,
    config
  );
  check(
    "system prompt has no Treasury Operations rules when disabled",
    !system.includes("### Treasury Operations")
  );
  check(
    "user prompt has no Treasury operations block when disabled",
    !user.includes("Treasury operations")
  );
}

// 3) toggle on asks
{
  const config = SECTION_LIBRARY_META.map((m) => ({
    id: m.id,
    enabled: m.id === "asks" ? true : m.defaultEnabled,
  }));
  const { system } = buildReportPrompts(
    snapshot,
    prevSnapshot,
    project,
    milestones,
    config
  );
  check(
    "system prompt includes Asks section rules when enabled",
    system.includes("### Asks")
  );
}

// 4) reorder governance_updates above financial_health
{
  // governance is off-by-default; turn it on AND move it before financial_health
  const order = [
    "executive_summary",
    "wins",
    "lows_concerns",
    "treasury_overview",
    "treasury_by_chain",
    "previous_month_comparison",
    "governance_updates", // moved up
    "financial_health",
    "expense_breakdown",
    "treasury_operations",
    "token_metrics",
    "development_progress",
    "milestones_completed",
    "anomalies",
    "looking_ahead",
  ];
  const config = order.map((id) => ({ id, enabled: true }));
  const { system } = buildReportPrompts(
    snapshot,
    prevSnapshot,
    project,
    milestones,
    config
  );
  const govIdx = system.indexOf("### Governance Updates");
  const finIdx = system.indexOf("### Financial Health");
  check(
    "governance section appears before financial health in system prompt",
    govIdx > -1 && finIdx > -1 && govIdx < finIdx,
    `gov=${govIdx}, fin=${finIdx}`
  );
}

// 5) silence rule: project without tokenSymbol → no Token Metrics in user prompt
{
  const noToken = { ...project, tokenSymbol: null };
  const { user } = buildReportPrompts(
    snapshot,
    prevSnapshot,
    noToken,
    milestones,
    null
  );
  check(
    "Token Metrics omitted from user prompt when no tokenSymbol",
    !user.includes("## Token Metrics")
  );
}

// 6) silence rule: snapshot without prevSnapshot → no Previous Month block
{
  const { user } = buildReportPrompts(snapshot, null, project, milestones, null);
  check(
    "Previous Month Treasury omitted when prevSnapshot is null",
    !user.includes("## Previous Month Treasury")
  );
}

// 7) silence rule: single-chain treasury → no by-chain block
{
  const single = { ...snapshot, balancesByChain: { ethereum: 8500000 } };
  const { user } = buildReportPrompts(single, prevSnapshot, project, milestones, null);
  check(
    "Treasury by chain omitted for single-chain treasury",
    !user.includes("## Treasury by chain")
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
