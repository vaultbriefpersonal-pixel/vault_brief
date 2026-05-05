// Smoke verification for the report-template constructor + manual-entry
// sections (Phase 6). No LLM calls — we exercise buildReportPrompts()
// with synthetic data and assert the resolved prompt reflects:
//
//   - Per-project section config (toggle off/on, reorder)
//   - Silence rules (single-chain, missing prev snapshot, no token)
//   - Manual-entry sections render only when matching-period data exists
//     (grants, governance, partners, qa) or open status (asks)
//
// Run: npx tsx scripts/smoke-report-sections.mjs

const { buildReportPrompts } = await import(
  "../src/server/services/prompts.ts"
);
const { SECTION_LIBRARY_META } = await import(
  "../src/server/services/report-sections.ts"
);

// ─── fixtures ──────────────────────────────────────────────────────────────

const PERIOD = "2026-04";

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

// Period-bound manual data (matches PERIOD = "2026-04")
const grants = [
  {
    id: "g1",
    projectId: "p1",
    recipient: "Acme Research",
    amountUsd: "50000",
    status: "committed",
    category: "research",
    period: "2026-04",
    notes: null,
    createdAt: new Date(),
  },
  {
    id: "g2",
    projectId: "p1",
    recipient: "Beta Tooling",
    amountUsd: "25000",
    status: "disbursed",
    category: null,
    period: "2026-04",
    notes: "delivered SDK v2",
    createdAt: new Date(),
  },
];

const governanceProposals = [
  {
    id: "gp1",
    projectId: "p1",
    title: "EP-12: Treasury rebalance to 60/40 stables",
    status: "passed",
    url: "https://snapshot.org/x",
    voteResult: "78% / 22% with 14M tokens",
    period: "2026-04",
    notes: null,
    createdAt: new Date(),
  },
];

const partnersList = [
  {
    id: "pa1",
    projectId: "p1",
    name: "Coinbase Custody",
    type: "integration",
    url: "https://example.com",
    period: "2026-04",
    notes: null,
    createdAt: new Date(),
  },
];

const asksList = [
  {
    id: "a1",
    projectId: "p1",
    request: "Intro to L2 BD lead at any major DEX",
    category: "intros",
    status: "open",
    createdAt: new Date(),
  },
  {
    id: "a2",
    projectId: "p1",
    request: "Already-resolved historical ask",
    category: "hiring",
    status: "resolved",
    createdAt: new Date(),
  },
];

const qaHighlights = [
  {
    id: "q1",
    projectId: "p1",
    question: "Why the L2 push now?",
    answer: "Gas costs eat into smaller transactions and we want broader reach.",
    askedBy: "@frens",
    period: "2026-04",
    displayOrder: 0,
    createdAt: new Date(),
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

const baseInput = {
  snapshot,
  prevSnapshot,
  project,
  milestones,
  grants,
  governanceProposals,
  partners: partnersList,
  asks: asksList,
  qaHighlights,
};

// 1) null config = product defaults (manual sections off-by-default)
{
  const { system, user, enabled } = buildReportPrompts({ ...baseInput });
  const ids = enabled.map((s) => s.id);
  const defaults = SECTION_LIBRARY_META.filter((m) => m.defaultEnabled).map(
    (m) => m.id
  );
  check(
    "null config resolves to defaultEnabled sections",
    JSON.stringify(ids) === JSON.stringify(defaults),
    `got [${ids.join(",")}] expected [${defaults.join(",")}]`
  );
  check("system prompt mentions Executive Summary", system.includes("### Executive Summary"));
  check("system prompt mentions Wins", system.includes("### Wins"));
  check("system prompt mentions Treasury Overview", system.includes("### Treasury Overview"));
  check("user prompt has Project Context", user.includes("## Project Context"));
  check("user prompt has Treasury by chain", user.includes("## Treasury by chain"));
  check("user prompt has Token Metrics", user.includes("## Token Metrics"));
  check("user prompt has Development Activity", user.includes("## Development Activity"));
  check("user prompt has Treasury operations block", user.includes("Treasury operations"));

  // Manual sections OFF by default — neither user nor system blocks render
  check(
    "default config: NO Grants Distributed in system prompt",
    !system.includes("### Grants Distributed")
  );
  check(
    "default config: NO Asks in system prompt",
    !system.includes("### Asks")
  );
}

// 2) Enable all 5 manual sections WITH data → all 5 render in user prompt
{
  const config = SECTION_LIBRARY_META.map((m) => ({
    id: m.id,
    enabled:
      m.defaultEnabled ||
      [
        "grants_distributed",
        "governance_updates",
        "partners_integrations",
        "asks",
        "qa_highlights",
      ].includes(m.id),
  }));
  const { system, user } = buildReportPrompts({
    ...baseInput,
    storedSections: config,
  });

  check("system prompt includes Grants rules when enabled", system.includes("### Grants Distributed"));
  check("system prompt includes Governance rules when enabled", system.includes("### Governance Updates"));
  check("system prompt includes Partners rules when enabled", system.includes("### Partners & Integrations"));
  check("system prompt includes Asks rules when enabled", system.includes("### Asks"));
  check("system prompt includes Q&A rules when enabled", system.includes("### Q&A Highlights"));

  check(
    "user prompt has Grants this period block",
    user.includes("## Grants this period") &&
      user.includes("Acme Research") &&
      user.includes("Beta Tooling")
  );
  check(
    "user prompt has Grants totals (committed + disbursed)",
    user.includes("Committed:") && user.includes("Disbursed:")
  );
  check(
    "user prompt has Governance this period block",
    user.includes("## Governance this period") &&
      user.includes("EP-12") &&
      user.includes("[passed]")
  );
  check(
    "user prompt has Partners this period block",
    user.includes("## Partners this period") &&
      user.includes("Coinbase Custody") &&
      user.includes("(integration)")
  );
  check(
    "user prompt has Asks (open) block",
    user.includes("## Asks (open)") && user.includes("Intro to L2 BD lead")
  );
  check(
    "user prompt does NOT include resolved asks",
    !user.includes("Already-resolved historical ask")
  );
  check(
    "user prompt has Q&A this period block",
    user.includes("## Q&A this period") &&
      user.includes("Why the L2 push now?") &&
      user.includes("Q: ") &&
      user.includes("A: ")
  );
}

// 3) Toggle off treasury_operations (regression check from Phase 5)
{
  const config = SECTION_LIBRARY_META.map((m) => ({
    id: m.id,
    enabled: m.id === "treasury_operations" ? false : m.defaultEnabled,
  }));
  const { system, user } = buildReportPrompts({
    ...baseInput,
    storedSections: config,
  });
  check(
    "system prompt has no Treasury Operations rules when disabled",
    !system.includes("### Treasury Operations")
  );
  check(
    "user prompt has no Treasury operations block when disabled",
    !user.includes("Treasury operations")
  );
}

// 4) Period mismatch — grants for a different period don't render
{
  const wrongPeriodGrants = grants.map((g) => ({ ...g, period: "2026-01" }));
  const config = SECTION_LIBRARY_META.map((m) => ({
    id: m.id,
    enabled: m.defaultEnabled || m.id === "grants_distributed",
  }));
  const { user } = buildReportPrompts({
    ...baseInput,
    grants: wrongPeriodGrants,
    storedSections: config,
  });
  check(
    "Grants from a different period are filtered out",
    !user.includes("## Grants this period")
  );
}

// 5) silence rules from Phase 5 (still pass)
{
  const noToken = { ...project, tokenSymbol: null };
  const { user } = buildReportPrompts({ ...baseInput, project: noToken });
  check("Token Metrics omitted when no tokenSymbol", !user.includes("## Token Metrics"));
}
{
  const { user } = buildReportPrompts({ ...baseInput, prevSnapshot: null });
  check(
    "Previous Month Treasury omitted when prevSnapshot is null",
    !user.includes("## Previous Month Treasury")
  );
}
{
  const single = { ...snapshot, balancesByChain: { ethereum: 8500000 } };
  const { user } = buildReportPrompts({ ...baseInput, snapshot: single });
  check(
    "Treasury by chain omitted for single-chain treasury",
    !user.includes("## Treasury by chain")
  );
}

// 6) reorder governance above financial_health (still works)
{
  const order = [
    "executive_summary",
    "wins",
    "lows_concerns",
    "treasury_overview",
    "treasury_by_chain",
    "previous_month_comparison",
    "governance_updates",
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
  const { system } = buildReportPrompts({ ...baseInput, storedSections: config });
  const govIdx = system.indexOf("### Governance Updates");
  const finIdx = system.indexOf("### Financial Health");
  check(
    "governance section appears before financial health in system prompt",
    govIdx > -1 && finIdx > -1 && govIdx < finIdx,
    `gov=${govIdx}, fin=${finIdx}`
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
