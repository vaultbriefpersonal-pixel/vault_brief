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

/**
 * `balances_detail` in the shape wallet-sync.ts stores. The evidence ledger,
 * the liquidity split and the attribution all derive from this payload rather
 * than from the aggregate columns, so a fixture without it exercises none of
 * them.
 */
function detail(rows, walletAddress = "0xaaa") {
  return [
    {
      walletAddress,
      chain: "ethereum",
      tokens: rows.map(({ symbol, amount, price }) => ({
        symbol,
        amount,
        priceUsd: price,
        valueUsd: amount * price,
        contractAddress: null,
      })),
    },
  ];
}

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
  netFlowUsd: "300000",
  expensesByCategory: { payroll: 280000, infra: 35000, token_sale: 150000 },
  incomeByCategory: { revenue: 150000 },
  balancesByChain: { ethereum: 6800000, optimism: 1200000, base: 500000 },
  githubCommitsCount: 142,
  githubPrsMerged: 38,
  githubContributorsActive: 9,
  tokenPriceUsd: "0.42",
  tokenMarketCapUsd: "12500000",
  tokenHoldersCount: 4820,
  tokenCirculatingSupply: "29761904",
  // 5.3M USDC + 1,000 WETH @ $2,100 + 1.1M TEST @ $1.
  balancesDetail: detail([
    { symbol: "USDC", amount: 5_300_000, price: 1 },
    { symbol: "WETH", amount: 1_000, price: 2_100 },
    { symbol: "TEST", amount: 1_100_000, price: 1 },
  ]),
};

const prevSnapshot = {
  ...snapshot,
  id: "s0",
  snapshotDate: "2026-03-31",
  totalBalanceUsd: "8200000",
  burnRateUsd: "300000",
  netFlowUsd: "-150000",
  incomeByCategory: { revenue: 100000 },
  tokenHoldersCount: 4200,
  githubCommitsCount: 90,
  githubPrsMerged: 24,
  // Same wallet, same tokens, 300K fewer USDC — a pure flow difference.
  balancesDetail: detail([
    { symbol: "USDC", amount: 5_000_000, price: 1 },
    { symbol: "WETH", amount: 1_000, price: 2_100 },
    { symbol: "TEST", amount: 1_100_000, price: 1 },
  ]),
};

/** Prior snapshots, most-recent-first, EXCLUDING the current one. */
const trailing = [
  prevSnapshot,
  {
    ...prevSnapshot,
    id: "s-1",
    snapshotDate: "2026-02-28",
    burnRateUsd: "280000",
    netFlowUsd: "-200000",
  },
  {
    ...prevSnapshot,
    id: "s-2",
    snapshotDate: "2026-01-31",
    burnRateUsd: "290000",
    netFlowUsd: "-100000",
  },
];

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
  // Completed, but two years ago. The evidence ledger derives its period match
  // from completedDate's 'YYYY-MM' prefix (milestones carry no period column),
  // so this one must NOT surface as a win for 2026-04.
  {
    id: "m3",
    projectId: "p1",
    title: "Testnet launched",
    status: "completed",
    completedDate: "2024-04-12",
  },
  {
    id: "m4",
    projectId: "p1",
    title: "Bridge integration",
    status: "delayed",
    targetDate: "2026-03-01",
    description: "Slipped a period behind the original target",
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
  trailing,
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

// 7) Anomalies ride the section switch — data and rules together.
//
// Regression for the bug where report-generator.ts appended the anomaly block
// to the finished user prompt: turning the section off removed its rules
// (including "Don't fabricate causes") from the SYSTEM prompt while the
// figures still reached the model through the USER prompt. Asserting on the
// system prompt alone would have missed the whole thing.
{
  const anomaliesFixture = [
    {
      metric: "Burn rate",
      current: 640000,
      baseline: 320000,
      changePct: 100,
      severity: "critical",
    },
    {
      metric: "Expense: payroll",
      current: 380000,
      baseline: 280000,
      changePct: 36,
      severity: "minor",
    },
  ];

  // Enabled (on by default) + anomalies present → block lands in the user prompt.
  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      anomalies: anomaliesFixture,
    });
    check(
      "anomalies enabled: user prompt has the Anomalies block",
      user.includes("## Anomalies") && user.includes("Burn rate:")
    );
    check(
      "anomalies enabled: system prompt has the anti-fabrication rule",
      system.includes("### Anomalies") && system.includes("Don't fabricate causes")
    );
    check(
      "anomalies header no longer claims a trailing-N baseline",
      user.includes("## Anomalies (vs trailing average)") &&
        !/trailing-\d/.test(user)
    );
  }

  // Disabled in the stored config + anomalies present → neither half renders.
  {
    const config = SECTION_LIBRARY_META.map((m) => ({
      id: m.id,
      enabled: m.id === "anomalies" ? false : m.defaultEnabled,
    }));
    const { system, user } = buildReportPrompts({
      ...baseInput,
      anomalies: anomaliesFixture,
      storedSections: config,
    });
    check(
      "anomalies disabled: NO anomaly data in the user prompt",
      !user.includes("## Anomalies") && !user.includes("Burn rate:"),
      "anomaly figures reached the model with its guardrails stripped"
    );
    check(
      "anomalies disabled: NO anomaly rules in the system prompt",
      !system.includes("### Anomalies")
    );
  }

  // Section on, but nothing detected → silence, not an empty header.
  {
    const { user } = buildReportPrompts({ ...baseInput, anomalies: [] });
    check(
      "no anomalies detected: no Anomalies block in the user prompt",
      !user.includes("## Anomalies")
    );
  }
}

// 8) Evidence pipelines — Wins and Lows now carry DATA, not just rules.
//
// Both sections shipped with `userPromptFragment: () => ""`, so the model was
// told to write wins with nothing to write them from. These assert the ledger
// actually reaches the prompt, that it rides the same section switch as its
// rules, and — the load-bearing one — that a price-driven treasury rise cannot
// enter it.
{
  const { system, user } = buildReportPrompts({ ...baseInput });

  check(
    "wins: user prompt carries the verified positive evidence block",
    user.includes("## Verified positive evidence"),
    "wins is back to improvising from whatever else is in the prompt"
  );
  check(
    "wins: evidence includes the in-period completed milestone",
    user.includes("Milestone completed this period: Audit closed")
  );
  check(
    "wins: evidence quotes a figure alongside every claim",
    user.includes("Recurring operating income") && user.includes("$100.0K → $150.0K")
  );
  check(
    "wins: system prompt binds the model to the evidence list",
    system.includes("select ONLY from that list")
  );
  check(
    "lows: user prompt carries the verified concerns block",
    user.includes("## Verified concerns")
  );
  check(
    "lows: evidence includes the delayed milestone",
    user.includes("Milestone currently marked delayed: Bridge integration")
  );
  check(
    "wins: a milestone completed in a PRIOR period is not a win for this one",
    !user.includes("Milestone completed this period: Testnet launched"),
    "milestones have no period column — the completedDate prefix is the filter"
  );

  // Flow-driven growth: +300K of USDC actually arrived, and netFlowUsd agrees.
  check(
    "wins: flow-driven treasury growth IS offered as evidence",
    user.includes("The treasury grew on money that actually arrived")
  );
}

// 8b) The gate. Same treasury rise, caused by price instead of flow.
{
  const priceDriven = {
    ...snapshot,
    totalBalanceUsd: "9600000",
    netFlowUsd: "0",
    // Identical quantities to prevSnapshot; only TEST's price moved, $1 → $2.
    balancesDetail: detail([
      { symbol: "USDC", amount: 5_000_000, price: 1 },
      { symbol: "WETH", amount: 1_000, price: 2_100 },
      { symbol: "TEST", amount: 1_100_000, price: 2 },
    ]),
  };
  const { user } = buildReportPrompts({ ...baseInput, snapshot: priceDriven });

  check(
    "GATE: a price-driven treasury rise is NOT offered as a win",
    !user.includes("The treasury grew on money that actually arrived"),
    "a market rally would reach the model labelled as an achievement"
  );
  check(
    "GATE: the price-driven rise still appears in Month-over-Month, attributed",
    user.includes("Price movement of assets already held"),
    "the figure must still be reported — just never as a win"
  );
}

// 8c) Wins/Lows still ride the section switch: data and rules together.
{
  const config = SECTION_LIBRARY_META.map((m) => ({
    id: m.id,
    enabled: m.id === "wins" || m.id === "lows_concerns" ? false : m.defaultEnabled,
  }));
  const { system, user } = buildReportPrompts({
    ...baseInput,
    storedSections: config,
  });
  check(
    "wins disabled: NO positive evidence block in the user prompt",
    !user.includes("## Verified positive evidence"),
    "evidence reached the model with its selection rules stripped"
  );
  check(
    "lows disabled: NO concerns block in the user prompt",
    !user.includes("## Verified concerns")
  );
  check(
    "wins disabled: NO Wins rules in the system prompt",
    !system.includes("### Wins")
  );
}

// 8d) An empty ledger is a correct output — no header, no padding.
{
  const bare = {
    id: "s1",
    projectId: "p1",
    snapshotDate: "2026-04-30",
    totalBalanceUsd: "8500000",
  };
  const { user } = buildReportPrompts({
    snapshot: bare,
    project,
    milestones: [],
  });
  check(
    "empty ledger: no positive evidence header is emitted",
    !user.includes("## Verified positive evidence")
  );
  check(
    "empty ledger: no concerns header is emitted",
    !user.includes("## Verified concerns")
  );
}

// 9) Key Takeaways — new section, library index 1.
{
  const { system, user, enabled } = buildReportPrompts({ ...baseInput });
  const ids = enabled.map((s) => s.id);

  check(
    "key_takeaways sits between executive_summary and wins",
    ids[0] === "executive_summary" &&
      ids[1] === "key_takeaways" &&
      ids[2] === "wins",
    `got [${ids.slice(0, 3).join(",")}]`
  );
  check(
    "key_takeaways: user prompt carries the evidence block",
    user.includes("## Key takeaways evidence")
  );
  check(
    "key_takeaways: block carries the headline treasury total",
    user.includes("- Total treasury (2026-04-30): $8.5M")
  );
  check(
    "key_takeaways: block carries the liquid runway, not the total-treasury one",
    user.includes("Runway (liquid reserves") && user.includes("trailing 3-mo avg burn")
  );
  check(
    "key_takeaways: block carries the dominant driver of the treasury change",
    user.includes("dominant driver: net asset flows")
  );
  check(
    "key_takeaways: system prompt demands a figure per bullet",
    system.includes("### Key Takeaways") &&
      system.includes("Every bullet must carry a figure")
  );
}

// 9b) Ordering edge case, asserted so it is deliberate rather than accidental.
// key_takeaways' only library predecessor is executive_summary, so a founder
// who disabled the exec summary gets takeaways at the very front of the report.
{
  const config = SECTION_LIBRARY_META.filter((m) => m.id !== "key_takeaways").map(
    (m) => ({
      id: m.id,
      enabled: m.id === "executive_summary" ? false : m.defaultEnabled,
    })
  );
  const { enabled } = buildReportPrompts({ ...baseInput, storedSections: config });
  const ids = enabled.map((s) => s.id);
  check(
    "executive_summary disabled: key_takeaways opens the report",
    ids[0] === "key_takeaways" && !ids.includes("executive_summary"),
    `got [${ids.slice(0, 2).join(",")}]`
  );
}

// 10) Next Period Projection — needs >= 2 trailing snapshots, and must be
// worded as arithmetic rather than as a forecast.
{
  const { system, user } = buildReportPrompts({ ...baseInput });

  check(
    "forecast: user prompt carries the projection block",
    user.includes("## Mechanical projection for the next period")
  );
  check(
    "forecast: block labels itself arithmetic, not a forecast",
    user.includes("arithmetic, NOT a forecast") &&
      user.includes("MECHANICAL PROJECTION")
  );
  check(
    "forecast: assumptions are stated in the block itself",
    user.includes("ASSUMPTIONS") &&
      user.includes("Asset prices stay exactly where they were")
  );
  check(
    "forecast: block refuses to project token price",
    user.includes("NOT PROJECTED, and not to be projected: token price")
  );
  check(
    "forecast: system prompt forbids confident forward language",
    system.includes("### Next Period Projection") &&
      system.includes("Forbidden verbs") &&
      system.includes("Never project, mention, or imply a future token price")
  );
}

// 10b) Gated off with too little history — one prior snapshot is not an average.
{
  const { user } = buildReportPrompts({ ...baseInput, trailing: [prevSnapshot] });
  check(
    "forecast: omitted with only one trailing snapshot",
    !user.includes("## Mechanical projection for the next period")
  );
}

// 11) The shared length budget rose with the section count.
{
  const { system } = buildReportPrompts({ ...baseInput });
  check(
    "system prompt carries the raised word budget",
    system.includes("Total length: 800-1600 words"),
    "two new sections plus data-bearing wins/concerns need the headroom"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
