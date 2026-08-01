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
  // The default fixture is parseable (balancesDetail present) but neither
  // trigger holds: TEST is ~12.9% of the treasury (below the 20% floor) and
  // stablecoins cover ~18 months of trailing burn (above the 3-month floor).
  // This is the exact class of false positive the treasury_concentration
  // bug produced — the section firing for any parseable-but-not-actually-
  // concentrated treasury — so its absence here is load-bearing.
  check(
    "user prompt does NOT include Treasury concentration when neither trigger holds",
    !user.includes("## Treasury concentration and liquidity")
  );
  // The core fix this smoke test locks in: buildSystemPrompt used to include
  // every enabled section's rule text unconditionally, even when (as here)
  // the section's own data block is absent from the user prompt above. A
  // model reading the "(CONDITIONAL)" rule with no block to satisfy it could
  // reconstruct the section's narrative from figures borrowed out of another,
  // unconditionally-present section. The rule must now go silent right along
  // with the data block it describes.
  check(
    "system prompt does NOT include the Treasury Concentration rule when neither trigger holds",
    !system.includes("### Treasury Concentration")
  );

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

// 12) Plan vs Actual — off by default, and renders only from a typed plan.
//
// The section is the only one in the library that ships disabled. These
// assertions pin both halves of that: it must not appear for a founder who
// never opted in, and it must not appear for one who did but has no plan.
{
  const budgetRow = (over = {}) => ({
    id: "bud-1",
    projectId: "p1",
    period: "2026-04",
    kind: "expense",
    category: "__total__",
    plannedUsd: "250000",
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date("2026-04-18T00:00:00Z"),
    ...over,
  });

  // Off by default: neither the rules nor the data reach the prompt.
  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      budgets: [budgetRow()],
    });
    check(
      "budgets: section is off by default even with a plan entered",
      !system.includes("### Plan vs Actual") &&
        !user.includes("## Plan vs actual")
    );
  }

  const enableBudget = SECTION_LIBRARY_META.map((m) => ({
    id: m.id,
    enabled: m.defaultEnabled || m.id === "actual_vs_budget",
  }));

  // Enabled but no plan: neither the rule nor the data block travels.
  // `actual_vs_budget` is a CONDITIONAL section with no special exception —
  // its rule is gated by the same fragment-non-empty signal as its data
  // block, so an absent plan silences both. (Before the
  // system-prompt-rule-gating fix, the rule travelled unconditionally
  // regardless of whether a plan existed — exactly the bug class this
  // section would otherwise still exhibit.)
  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      storedSections: enableBudget,
    });
    check(
      "budgets: enabled with no plan renders no rule and no data block",
      !system.includes("### Plan vs Actual") &&
        !user.includes("## Plan vs actual")
    );
  }

  // A '__total__'-only plan: one row, compared against operating spend.
  // The fixture snapshot spends 280K payroll + 35K infra (the 150K
  // token_sale is a reallocation and must stay out of the comparison).
  {
    const { user } = buildReportPrompts({
      ...baseInput,
      budgets: [budgetRow()],
      storedSections: enableBudget,
    });
    check(
      "budgets: '__total__' plan renders a single total row",
      user.includes("## Plan vs actual (2026-04)") &&
        user.includes("planned ONE total for the period")
    );
    check(
      "budgets: '__total__' actual is operating spend, not the reallocation",
      user.includes(
        "Total operating spend: planned $250.0K, actual $315.0K, variance +$65.0K (+26.0%)"
      ),
      "the 150K token_sale bucket must not be swept in"
    );
  }

  // An itemised plan: per-category rows plus a total, and the variance
  // filter applied per line.
  {
    const { user } = buildReportPrompts({
      ...baseInput,
      budgets: [
        budgetRow({ id: "b-pay", category: "payroll", plannedUsd: "200000" }),
        budgetRow({ id: "b-inf", category: "infra", plannedUsd: "40000" }),
      ],
      storedSections: enableBudget,
    });
    check(
      "budgets: itemised plan renders per-category rows",
      user.includes(
        "payroll: planned $200.0K, actual $280.0K, variance +$80.0K (+40.0%)"
      )
    );
    check(
      "budgets: a >20% AND >$5K variance is marked MATERIAL",
      user.includes(
        "payroll: planned $200.0K, actual $280.0K, variance +$80.0K (+40.0%) — spent more than planned — MATERIAL"
      )
    );
    check(
      "budgets: a within-tolerance line is told not to be called out",
      user.includes(
        "infra: planned $40.0K, actual $35.0K, variance -$5.0K (-12.5%) — spent less than planned — within tolerance — do NOT call this out"
      ),
      "-12.5% clears neither floor"
    );
    check(
      "budgets: the itemised table closes with its own total row",
      user.includes("Total operating spend: planned $240.0K, actual $315.0K")
    );
  }

  // A plan for a period the report does not cover changes nothing.
  {
    const { user } = buildReportPrompts({
      ...baseInput,
      budgets: [budgetRow({ period: "2026-03" })],
      storedSections: enableBudget,
    });
    check(
      "budgets: a prior period's plan does not leak into this report",
      !user.includes("## Plan vs actual")
    );
  }

  // The rules the section exists to enforce. A real plan must be present —
  // now that the rule is gated by the same fragment-non-empty signal as the
  // data block, an empty plan (as above) would silence this rule too.
  {
    const { system } = buildReportPrompts({
      ...baseInput,
      budgets: [budgetRow()],
      storedSections: enableBudget,
    });
    check(
      "budgets: under-spend is explicitly not framed as good news",
      system.includes("Under-spend is not automatically good news") &&
        system.includes(
          "never be framed as a win, a saving, efficiency, or discipline"
        )
    );
    check(
      "budgets: only MATERIAL lines may be called out",
      system.includes("Call out ONLY the lines the input marks MATERIAL")
    );
    check(
      "budgets: variances may not be attributed to a cause",
      system.includes("Do not attribute any variance to a cause")
    );
  }
}

// 13) The grant-report blocks — leftover funds, plan deviation, live
// dashboard — plus the Source of Truth field threaded through three existing
// sections.
//
// All three sections ship OFF, so every assertion below that expects output
// has to opt in explicitly; the first assertion in each group pins the
// off-by-default half, which is what keeps an existing project's resolved
// section list unchanged by this deploy.
{
  const AWARD_ID = "aw1";

  const award = (over = {}) => ({
    id: AWARD_ID,
    projectId: "p1",
    grantor: "Optimism Foundation",
    program: "Grants Council S6",
    awardAmountUsd: "500000",
    awardAmountToken: null,
    awardTokenSymbol: null,
    amountUsdAtReceipt: null,
    awardDate: "2026-01-15",
    reportingStartDate: null,
    reportingCadence: "quarterly",
    nextReportDue: null,
    status: "active",
    leftoverFundsPlan: null,
    planDeviation: null,
    agreementUrl: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  const tranche = (over = {}) => ({
    id: "tr1",
    grantAwardId: AWARD_ID,
    projectId: "p1",
    label: "Tranche 1 — on signature",
    amountUsd: "100000",
    expectedDate: "2026-02-01",
    receivedDate: "2026-02-03",
    utilizedUsd: null,
    txHash: null,
    sourceOfTruth: null,
    notes: null,
    createdAt: new Date(),
    ...over,
  });

  /** Product defaults, plus the named sections switched on. */
  const enabling = (...ids) =>
    SECTION_LIBRARY_META.map((m) => ({
      id: m.id,
      enabled: m.defaultEnabled || ids.includes(m.id),
    }));

  // ── leftover_funds ──────────────────────────────────────────────────────

  // Off by default even with a fully populated award.
  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award({ leftoverFundsPlan: "Returned to the grantor." })],
      grantTranches: [tranche({ utilizedUsd: "40000" })],
    });
    check(
      "leftover: section is off by default even with utilisation and a plan",
      !system.includes("### Leftover Grant Funds") &&
        !user.includes("## Leftover grant funds")
    );
  }

  // Enabled, but neither half recorded: the gate is false, so the RULE must
  // go silent too. `buildSystemPrompt` selects rules by whether the fragment
  // is non-empty, not by `requires` — this is the assertion that proves the
  // new section did not reintroduce the leak that has bitten this file twice.
  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [tranche()],
      storedSections: enabling("leftover_funds"),
    });
    check(
      "leftover: enabled with no utilisation and no plan renders no rule and no data",
      !system.includes("### Leftover Grant Funds") &&
        !user.includes("## Leftover grant funds")
    );
  }

  // The ordinary case: $100K received, $40K utilised, $60K left, plan stated.
  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [
        award({ leftoverFundsPlan: "Rolls into the Q3 audit engagement." }),
      ],
      grantTranches: [tranche({ utilizedUsd: "40000" })],
      storedSections: enabling("leftover_funds"),
    });
    check(
      "leftover: received minus utilised is computed at grant scope",
      user.includes("- Grant funds received to date: $100.0K") &&
        user.includes("- Recorded as utilised: $40.0K") &&
        user.includes(
          "- Leftover (grant funds received minus grant funds utilised, for this award only): $60.0K"
        )
    );
    check(
      "leftover: the founder's plan travels with the figure",
      user.includes(
        "Plan for the leftover funds, as stated by the project (reproduce its substance, do not embellish it): Rolls into the Q3 audit engagement."
      )
    );
    check(
      "leftover: the rule forbids calling the leftover a treasury balance",
      system.includes("### Leftover Grant Funds") &&
        system.includes("It is NOT a treasury balance") &&
        system.includes("The treasury is fungible and holds no identifiable")
    );
  }

  // A plan with no utilisation figure: the section still renders, states the
  // figure is not computable, and must NOT treat the whole receipt as leftover.
  {
    const { user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award({ leftoverFundsPlan: "Returned to the grantor." })],
      grantTranches: [tranche()],
      storedSections: enabling("leftover_funds"),
    });
    check(
      "leftover: unrecorded utilisation is not computable, and is not zero",
      user.includes("- Recorded as utilised: NOT RECORDED") &&
        user.includes("That is NOT the same as zero utilised") &&
        user.includes("- Leftover: NOT COMPUTABLE without a utilisation figure")
    );
  }

  // A figure with no plan: reported as unstated, never invented.
  {
    const { user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [tranche({ utilizedUsd: "40000" })],
      storedSections: enabling("leftover_funds"),
    });
    check(
      "leftover: an unstated plan is reported as unstated, never invented",
      user.includes("- Plan for the leftover funds: NOT STATED") &&
        user.includes("Do NOT propose one")
    );
  }

  // ── figures that do not reconcile are WARNED ABOUT, never rejected ──────
  //
  // The 81,000-against-75,000 case from the research corpus. A tool that
  // hard-fails here rejects a report the grant program accepted.
  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [
        tranche({ amountUsd: "75000", utilizedUsd: "81000" }),
      ],
      storedSections: enabling("leftover_funds"),
    });
    check(
      "leftover: utilisation exceeding receipts renders both numbers, not an error",
      user.includes("- Grant funds received to date: $75.0K") &&
        user.includes("- Recorded as utilised: $81.0K") &&
        user.includes("Recorded utilisation ($81.0K) EXCEEDS recorded receipts ($75.0K) by $6.0K"),
      "real accepted grant reports do not balance"
    );
    check(
      "leftover: the overspend is a records discrepancy, not a finding about the project",
      user.includes(
        "do not present the shortfall as an overspend finding about the project"
      ) && user.includes("WARNING — this caveat MUST appear in the rendered section")
    );
    check(
      "leftover: the rule requires every warning to survive into the report",
      system.includes("Reproduce every WARNING line as a caveat") &&
        system.includes("Figures that do not reconcile are reported, not resolved")
    );
  }

  // Partial utilisation: two received tranches, one figure. The leftover is an
  // upper bound and must be labelled as one.
  {
    const { user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [
        tranche({ utilizedUsd: "40000" }),
        tranche({
          id: "tr2",
          label: "Tranche 2 — on milestone 1",
          amountUsd: "150000",
          expectedDate: "2026-03-01",
          receivedDate: "2026-03-04",
        }),
      ],
      storedSections: enabling("leftover_funds"),
    });
    check(
      "leftover: partial utilisation is disclosed as an upper bound",
      user.includes("from 1 of the 2 tranche(s) received to date") &&
        user.includes("the leftover figure is an UPPER BOUND, not a balance")
    );
  }

  // Utilisation booked against a tranche that has not arrived.
  {
    const { user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [
        tranche({ receivedDate: null, utilizedUsd: "40000" }),
      ],
      storedSections: enabling("leftover_funds"),
    });
    check(
      "leftover: utilisation on an unreceived tranche is flagged, not reconciled",
      user.includes(
        "1 tranche(s) carry a utilisation figure but are NOT recorded as received"
      ) && user.includes("do not reconcile them")
    );
  }

  // THE BOUNDARY. `grant_fund_usage` must still never see or state a leftover
  // figure — its absolute ban is not relaxed by the section next door.
  {
    const { user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award({ leftoverFundsPlan: "Returned." })],
      grantTranches: [tranche({ utilizedUsd: "40000" })],
      storedSections: enabling("grant_fund_usage"),
    });
    const usageBlock = user.slice(
      user.indexOf("## Grant funding received and its use")
    );
    check(
      "boundary: Grant Funding Received still carries no leftover or utilised figure",
      usageBlock.length > 0 &&
        !usageBlock.includes("Leftover") &&
        !usageBlock.includes("utilised") &&
        usageBlock.includes("NEVER subtract spending from an award"),
      "the treasury-scope ban is untouched by the grant-scope section"
    );
  }

  // ── plan_deviation ──────────────────────────────────────────────────────

  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [tranche()],
    });
    check(
      "deviation: section is off by default even with an award on record",
      !system.includes("### Deviation from the Plan") &&
        !user.includes("## Deviation from the plan")
    );
  }

  // THE MECHANIC: nothing typed still produces an affirmative statement. This
  // is the one section in the library whose fragment is non-empty with no data,
  // and it is the whole reason the block exists.
  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [tranche()],
      storedSections: enabling("plan_deviation"),
    });
    check(
      "deviation: an unrecorded deviation still states 'No changes to the original plan.'",
      user.includes(
        "- Optimism Foundation — Grants Council S6: No changes to the original plan."
      ),
      "a blank optional box is exactly what this block replaces"
    );
    check(
      "deviation: the standing-statement provenance is marked for the model, not for the reader",
      user.includes(
        "(this is the standing statement the project reports when it has recorded no change)"
      ) &&
        system.includes(
          "The parenthetical about a standing statement is provenance for you, not copy for the report"
        )
    );
    check(
      "deviation: the rule forbids dropping the no-change lines",
      system.includes(
        "Render a statement for every award the input lists, including the ones that report no change"
      )
    );
  }

  {
    const { user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [
        award({
          planDeviation:
            "Swapped the second audit vendor after their Q1 capacity fell through.",
        }),
      ],
      grantTranches: [tranche()],
      storedSections: enabling("plan_deviation"),
    });
    check(
      "deviation: a stated deviation replaces the standing statement, unhedged",
      user.includes(
        "- Optimism Foundation — Grants Council S6: Swapped the second audit vendor after their Q1 capacity fell through."
      ) &&
        !user.includes("standing statement the project reports")
    );
  }

  // No award at all: the section has nothing to speak for and goes fully
  // silent, rule included.
  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      storedSections: enabling("plan_deviation"),
    });
    check(
      "deviation: with no grant award, the rule and the data block both vanish",
      !system.includes("### Deviation from the Plan") &&
        !user.includes("## Deviation from the plan")
    );
  }

  // ── external_dashboard ──────────────────────────────────────────────────

  const DASHBOARD = "https://dune.com/example/treasury";

  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      project: { ...project, externalDashboardUrl: DASHBOARD },
    });
    check(
      "dashboard: section is off by default even with a URL on the project",
      !system.includes("### Live Dashboard") &&
        !user.includes("## Live dashboard")
    );
  }

  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      storedSections: enabling("external_dashboard"),
    });
    check(
      "dashboard: enabled with no URL renders no rule and no data block",
      !system.includes("### Live Dashboard") &&
        !user.includes("## Live dashboard")
    );
  }

  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      project: { ...project, externalDashboardUrl: DASHBOARD },
      storedSections: enabling("external_dashboard"),
    });
    check(
      "dashboard: the URL travels verbatim with the period it qualifies",
      user.includes(`Dashboard URL, to be reproduced exactly as given: ${DASHBOARD}`) &&
        user.includes("the dashboard is the source of truth, not this document")
    );
    check(
      "dashboard: the model is forbidden from describing a page it cannot see",
      system.includes("### Live Dashboard") &&
        system.includes("Do not describe, summarise or characterise what the dashboard shows") &&
        system.includes("Reproduce the URL character for character")
    );
  }

  // ── Source of Truth — a field, not a section ────────────────────────────
  //
  // It must never appear in SECTION_LIBRARY, and it must ADD to a line rather
  // than placeholder one: an item with nothing recorded renders exactly as it
  // did before the field existed, which is what leaves cached prompts valid.
  {
    check(
      "source of truth: is a field, not a section in the library",
      !SECTION_LIBRARY_META.some((m) => m.id === "source_of_truth")
    );
  }

  {
    const { user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [tranche()],
      storedSections: enabling("grant_fund_usage"),
    });
    check(
      "source of truth: an item without one renders no placeholder",
      user.includes("Tranche 1 — on signature: $100.0K") &&
        !user.includes("Source of Truth")
    );
  }

  {
    const { system, user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [
        tranche({ sourceOfTruth: "https://etherscan.io/tx/0xfeed" }),
      ],
      storedSections: enabling("grant_fund_usage"),
    });
    check(
      "source of truth: a tranche's pointer rides on the tranche's own line",
      user.includes(
        "Tranche 1 — on signature: $100.0K, expected 2026-02-01, received 2026-02-03 — Source of Truth: https://etherscan.io/tx/0xfeed"
      )
    );
    check(
      "source of truth: the rule says reproduce verbatim and never invent one",
      system.includes("reproduce that value verbatim") &&
        system.includes("Never invent one")
    );
  }

  // The fallback: a tranche recorded before the field existed still surfaces
  // its evidence through the older, narrower `txHash`.
  {
    const { user } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award()],
      grantTranches: [tranche({ txHash: "0xdeadbeef" })],
      storedSections: enabling("grant_fund_usage"),
    });
    check(
      "source of truth: falls back to txHash so pre-existing evidence is not lost",
      user.includes("received 2026-02-03 — Source of Truth: 0xdeadbeef")
    );
  }

  {
    const { user } = buildReportPrompts({
      ...baseInput,
      grants: [
        { ...grants[0], sourceOfTruth: "0xallocation" },
        grants[1],
      ],
      storedSections: enabling("grants_distributed"),
    });
    check(
      "source of truth: an outbound allocation carries its pointer, and one without stays bare",
      user.includes(
        "- Acme Research: $50.0K (committed, research) — Source of Truth: 0xallocation"
      ) && user.includes("- Beta Tooling: $25.0K (disbursed) — delivered SDK v2\n")
    );
  }

  {
    const { user } = buildReportPrompts({
      ...baseInput,
      milestones: [
        {
          id: "gm1",
          projectId: "p1",
          title: "Audit report published",
          status: "completed",
          targetDate: "2026-03-01",
          completedDate: "2026-03-20",
          grantAwardId: AWARD_ID,
          sourceOfTruth: "https://github.com/test-org/audits/pull/12",
        },
      ],
      grantAwards: [award()],
      grantTranches: [tranche()],
      storedSections: enabling("grant_milestone_progress"),
    });
    check(
      "source of truth: a grant deliverable carries its pointer into the table",
      user.includes(
        "Source of Truth: https://github.com/test-org/audits/pull/12"
      ) &&
        user.includes(
          "19 days late against target"
        )
    );
  }

  // ── the library itself ──────────────────────────────────────────────────
  {
    const { enabled } = buildReportPrompts({ ...baseInput });
    const ids = enabled.map((s) => s.id);
    check(
      "library: none of the three new sections joins an existing project's defaults",
      !ids.includes("leftover_funds") &&
        !ids.includes("plan_deviation") &&
        !ids.includes("external_dashboard"),
      "resolveSections only splices defaultEnabled sections, so stored configs are untouched"
    );
    check(
      "library: leftover_funds sits directly after grant_fund_usage",
      SECTION_LIBRARY_META.findIndex((m) => m.id === "leftover_funds") ===
        SECTION_LIBRARY_META.findIndex((m) => m.id === "grant_fund_usage") + 1
    );
    check(
      "library: plan_deviation sits directly after grant_milestone_progress",
      SECTION_LIBRARY_META.findIndex((m) => m.id === "plan_deviation") ===
        SECTION_LIBRARY_META.findIndex(
          (m) => m.id === "grant_milestone_progress"
        ) + 1
    );
    check(
      "library: external_dashboard is last — it points out of the document",
      SECTION_LIBRARY_META[SECTION_LIBRARY_META.length - 1].id ===
        "external_dashboard"
    );
  }

  // A stored config that predates all three keeps its exact order, and the
  // three do not appear in it.
  {
    const stored = [
      { id: "qa_highlights", enabled: true },
      { id: "executive_summary", enabled: true },
      { id: "treasury_overview", enabled: true },
    ];
    const { enabled } = buildReportPrompts({
      ...baseInput,
      grantAwards: [award({ planDeviation: "Scope narrowed." })],
      grantTranches: [tranche({ utilizedUsd: "40000" })],
      project: { ...project, externalDashboardUrl: DASHBOARD },
      storedSections: stored,
    });
    const ids = enabled.map((s) => s.id);
    // `qa_highlights` leading is the whole point: it is LAST in the library
    // and first in this founder's config, so anything that sorted by library
    // position rather than splicing against a present neighbour would move it.
    // (`key_takeaways` legitimately lands between the two entries below — it
    // is defaultEnabled and absent from the stored config, so `resolveSections`
    // splices it after its anchor. That is pre-existing behaviour, unrelated to
    // this stage.)
    check(
      "library: a founder's deliberate reorder is not disturbed by the new sections",
      ids[0] === "qa_highlights" &&
        ids[1] === "executive_summary" &&
        ids.indexOf("treasury_overview") > ids.indexOf("executive_summary") &&
        !ids.includes("leftover_funds") &&
        !ids.includes("plan_deviation") &&
        !ids.includes("external_dashboard")
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
