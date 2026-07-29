import { describe, it, expect } from "vitest";
import {
  buildUserPrompt,
  getSectionById,
  resolveSections,
  SECTION_LIBRARY,
  type ReportSection,
  type ReportSectionContext,
  type SectionConfigEntry,
} from "./report-sections";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./expense-classifier";
import {
  EXPENSE_CATEGORY_NAMES,
  INCOME_CATEGORY_NAMES,
} from "./report-derived";
import type { TreasurySnapshot } from "@/server/db/schema";

// These tests are about ordering, not content, so everything is asserted on
// id arrays. Ordering is load-bearing: buildSystemPrompt joins the fragments
// in sequence and tells the model to emit sections "in the order shown", so a
// section landing in the wrong slot changes the shape of a real report.

const LIBRARY_IDS = SECTION_LIBRARY.map((s) => s.id);
const DEFAULT_IDS = SECTION_LIBRARY.filter((s) => s.defaultEnabled).map(
  (s) => s.id
);

function ids(stored: SectionConfigEntry[] | null): string[] {
  return resolveSections(stored).map((s) => s.id);
}

/** A stored config listing the whole library, enabled, in library order. */
function fullConfig(): SectionConfigEntry[] {
  return LIBRARY_IDS.map((id) => ({ id, enabled: true }));
}

describe("resolveSections — no stored config", () => {
  it("returns library defaults in library order when stored is null", () => {
    expect(ids(null)).toEqual(DEFAULT_IDS);
  });

  it("returns library defaults in library order when stored is empty", () => {
    expect(ids([])).toEqual(DEFAULT_IDS);
  });
});

describe("resolveSections — stored config covers the library", () => {
  it("is a no-op when every library section is listed", () => {
    expect(ids(fullConfig())).toEqual(LIBRARY_IDS);
  });

  it("preserves a deliberate reorder when every section is listed", () => {
    const reversed = [...LIBRARY_IDS].reverse();
    const stored = reversed.map((id) => ({ id, enabled: true }));
    expect(ids(stored)).toEqual(reversed);
  });
});

describe("resolveSections — sections missing from the stored config", () => {
  it("splices a missing middle section to its library position, not the tail", () => {
    // treasury_overview sits at library index 3, between lows_concerns and
    // treasury_by_chain. A founder who saved before it existed has a config
    // without it.
    const stored = fullConfig().filter((e) => e.id !== "treasury_overview");
    const result = ids(stored);

    expect(result).toEqual(LIBRARY_IDS);
    expect(result.at(-1)).not.toBe("treasury_overview");
    expect(result[result.indexOf("lows_concerns") + 1]).toBe(
      "treasury_overview"
    );
  });

  it("keeps several consecutive missing sections in their relative order", () => {
    const omitted = [
      "treasury_by_chain",
      "previous_month_comparison",
      "financial_health",
    ];
    const stored = fullConfig().filter((e) => !omitted.includes(e.id));
    const result = ids(stored);

    expect(result).toEqual(LIBRARY_IDS);
    // Not just "all present" — the run must not have stacked up backwards.
    expect(result.indexOf("treasury_by_chain")).toBeLessThan(
      result.indexOf("previous_month_comparison")
    );
    expect(result.indexOf("previous_month_comparison")).toBeLessThan(
      result.indexOf("financial_health")
    );
  });

  it("splices a missing first section to the front", () => {
    const stored = fullConfig().filter((e) => e.id !== "executive_summary");
    expect(ids(stored)[0]).toBe("executive_summary");
  });

  it("does not rewrite a user's deliberate reorder", () => {
    // The important regression. This founder moved token_metrics up to second
    // and dropped lows_concerns below treasury_overview — the fix must splice
    // the one missing section in without "correcting" any of that.
    const stored: SectionConfigEntry[] = [
      { id: "executive_summary", enabled: true },
      { id: "token_metrics", enabled: true },
      { id: "wins", enabled: true },
      { id: "treasury_overview", enabled: true },
      { id: "lows_concerns", enabled: true },
      { id: "anomalies", enabled: true },
    ];
    const result = ids(stored);
    const configured = stored.map((e) => e.id);

    // The founder's own sequence survives verbatim as a subsequence.
    expect(result.filter((id) => configured.includes(id))).toEqual(configured);
    // And every unlisted default still made it in.
    for (const id of DEFAULT_IDS) expect(result).toContain(id);
  });

  it("puts key_takeaways at the very front when executive_summary is disabled", () => {
    // Documented edge case, asserted so it is deliberate rather than
    // accidental. key_takeaways sits at library index 1, so its only
    // predecessor is executive_summary. A founder who disabled the exec
    // summary leaves `insertionPointFor` with nothing to anchor on; it
    // returns 0 and takeaways opens the report.
    //
    // That is the right outcome for THIS section specifically — a bulleted
    // list of the period's headline figures is a defensible way to open an
    // investor report, and it is what the founder is left with once the
    // prose opener is gone. It would NOT be right for most sections, which
    // is why the behaviour is pinned here rather than in the general
    // splice tests above.
    const stored = fullConfig()
      .filter((e) => e.id !== "key_takeaways")
      .map((e) =>
        e.id === "executive_summary" ? { ...e, enabled: false } : e
      );
    const result = ids(stored);

    expect(result).not.toContain("executive_summary");
    expect(result[0]).toBe("key_takeaways");
  });

  it("keeps key_takeaways directly under executive_summary when both are present", () => {
    const stored = fullConfig().filter((e) => e.id !== "key_takeaways");
    const result = ids(stored);
    expect(result[0]).toBe("executive_summary");
    expect(result[1]).toBe("key_takeaways");
  });

  it("anchors a spliced section on its nearest present library predecessor", () => {
    // Library order is [... treasury_overview, treasury_by_chain,
    // previous_month_comparison ...]. With treasury_by_chain unlisted and the
    // list reordered, it belongs directly after treasury_overview — wherever
    // the founder happened to put that.
    const stored: SectionConfigEntry[] = [
      { id: "anomalies", enabled: true },
      { id: "treasury_overview", enabled: true },
      { id: "executive_summary", enabled: true },
    ];
    const result = ids(stored);
    expect(result[result.indexOf("treasury_overview") + 1]).toBe(
      "treasury_by_chain"
    );
  });
});

describe("resolveSections — entries that must not surface", () => {
  it("ignores unknown ids in the stored config", () => {
    const stored: SectionConfigEntry[] = [
      { id: "executive_summary", enabled: true },
      { id: "a_section_removed_in_a_deploy", enabled: true },
      { id: "wins", enabled: true },
    ];
    const result = ids(stored);
    expect(result).not.toContain("a_section_removed_in_a_deploy");
    // Asserted as relative order, not as a slice of the head: sections the
    // stored config never mentioned get spliced in around these two (today
    // key_takeaways lands between them), and that is the documented
    // behaviour of resolveSections — not a regression this test should fail
    // on every time the library grows.
    expect(result.indexOf("executive_summary")).toBe(0);
    expect(result.indexOf("executive_summary")).toBeLessThan(
      result.indexOf("wins")
    );
  });

  it("does not re-add an explicitly disabled section", () => {
    const stored = fullConfig().map((e) =>
      e.id === "treasury_overview" ? { ...e, enabled: false } : e
    );
    expect(ids(stored)).not.toContain("treasury_overview");
  });

  it("keeps a disabled section out even when it sits mid-library", () => {
    // Disabled *and* surrounded by missing entries — the splice pass walks the
    // whole library, so this is where a botched `seenIds` check would show up.
    const stored: SectionConfigEntry[] = [
      { id: "executive_summary", enabled: true },
      { id: "treasury_by_chain", enabled: false },
      { id: "financial_health", enabled: true },
    ];
    const result = ids(stored);
    expect(result).not.toContain("treasury_by_chain");
    expect(result).toContain("treasury_overview"); // unlisted default, spliced in
  });

  it("does not splice in sections that are off by default", () => {
    const offByDefault = SECTION_LIBRARY.filter((s) => !s.defaultEnabled).map(
      (s) => s.id
    );
    expect(offByDefault.length).toBeGreaterThan(0);
    const result = ids([{ id: "executive_summary", enabled: true }]);
    for (const id of offByDefault) expect(result).not.toContain(id);
  });
});

// ─── protocol revenue + major transactions ─────────────────────────────────
//
// Both read data the snapshot already carried and nothing consumed. The tests
// below are about the two claims each section exists to prevent: that a
// funding round is revenue, and that a sampled list of transactions is the
// definitive largest.

const TREASURY_TOTAL = 8_500_000;
/** 0.1% of the treasury — the significance floor prompts.ts computes. */
const MIN_SIGNIFICANT = TREASURY_TOTAL * 0.001;

function snapshotWith(fields: Record<string, unknown>): TreasurySnapshot {
  return {
    id: "s1",
    projectId: "p1",
    snapshotDate: "2026-04-30",
    totalBalanceUsd: String(TREASURY_TOTAL),
    ...fields,
  } as unknown as TreasurySnapshot;
}

function contextWith(
  snapshotFields: Record<string, unknown>,
  prevSnapshot: TreasurySnapshot | null = null,
  extra: Partial<ReportSectionContext> = {}
): ReportSectionContext {
  return {
    snapshot: snapshotWith(snapshotFields),
    prevSnapshot,
    trailing: [],
    project: { name: "Test Protocol" },
    milestones: [],
    period: "2026-04",
    grants: [],
    governanceProposals: [],
    partners: [],
    asks: [],
    qaHighlights: [],
    budgets: [],
    anomalies: [],
    total: TREASURY_TOTAL,
    minSignificant: MIN_SIGNIFICANT,
    // Last, so a test can override any of the defaults above — `trailing` and
    // `project` in particular, which the runway and concentration sections read.
    ...extra,
  } as unknown as ReportSectionContext;
}

function section(id: string): ReportSection {
  const found = getSectionById(id);
  if (!found) throw new Error(`section ${id} is missing from the library`);
  return found;
}

describe("library placement of the new sections", () => {
  it("puts actual_vs_budget directly after expense_breakdown", () => {
    // Plan vs Actual reads the same expensesByCategory payload the Operating
    // Expenses table just printed, so it belongs immediately under it —
    // between them is where a reader compares a number to its plan.
    expect(LIBRARY_IDS[LIBRARY_IDS.indexOf("expense_breakdown") + 1]).toBe(
      "actual_vs_budget"
    );
  });

  it("puts protocol_revenue directly after actual_vs_budget", () => {
    expect(LIBRARY_IDS[LIBRARY_IDS.indexOf("actual_vs_budget") + 1]).toBe(
      "protocol_revenue"
    );
  });

  it("puts major_transactions directly after treasury_operations", () => {
    expect(LIBRARY_IDS[LIBRARY_IDS.indexOf("treasury_operations") + 1]).toBe(
      "major_transactions"
    );
  });

  it("ships both on by default", () => {
    expect(DEFAULT_IDS).toContain("protocol_revenue");
    expect(DEFAULT_IDS).toContain("major_transactions");
  });

  it("splices them into a config saved before they existed", () => {
    const stored = fullConfig().filter(
      (e) => e.id !== "protocol_revenue" && e.id !== "major_transactions"
    );
    expect(ids(stored)).toEqual(LIBRARY_IDS);
  });
});

describe("protocol_revenue — requires", () => {
  const revenue = section("protocol_revenue");

  it("triggers on recurring revenue above the significance floor", () => {
    expect(
      revenue.requires(contextWith({ incomeByCategory: { revenue: 120_000 } }))
    ).toBe(true);
  });

  it("triggers on staking rewards alone", () => {
    expect(
      revenue.requires(
        contextWith({ incomeByCategory: { staking_reward: 40_000 } })
      )
    ).toBe(true);
  });

  it("does NOT trigger on a funding round alone — a raise is not revenue", () => {
    // The whole point of the section. A "Protocol Revenue" heading over a
    // $5M seed round is the category error it exists to prevent, and the
    // heading misleads before the model writes a word.
    expect(
      revenue.requires(
        contextWith({ incomeByCategory: { funding_round: 5_000_000 } })
      )
    ).toBe(false);
  });

  it("does NOT trigger on token sale proceeds, airdrops or other income", () => {
    for (const category of ["token_sale_inflow", "airdrop", "other_income"]) {
      expect(
        revenue.requires(
          contextWith({ incomeByCategory: { [category]: 3_000_000 } })
        )
      ).toBe(false);
    }
  });

  it("does NOT trigger on recurring income below the significance floor", () => {
    expect(
      revenue.requires(
        contextWith({ incomeByCategory: { revenue: MIN_SIGNIFICANT - 1 } })
      )
    ).toBe(false);
  });

  it("does NOT trigger without a classified income breakdown", () => {
    for (const incomeByCategory of [null, undefined, [], "none", 7, {}]) {
      expect(revenue.requires(contextWith({ incomeByCategory }))).toBe(false);
    }
  });

  it("uses the exact category names the classifier writes", () => {
    // The section duplicates these strings rather than importing them (the
    // classifier pulls in the OpenAI SDK). A rename there with no rename here
    // would silently stop the section from ever firing.
    for (const category of INCOME_CATEGORIES) {
      const ctx = contextWith({ incomeByCategory: { [category]: 500_000 } });
      const fires = revenue.requires(ctx);
      const isRecurring =
        category === "revenue" || category === "staking_reward";
      expect(fires).toBe(isRecurring);
    }
  });
});

describe("protocol_revenue — user prompt fragment", () => {
  const revenue = section("protocol_revenue");

  it("keeps recurring and non-recurring in separate labelled groups", () => {
    const out = revenue.userPromptFragment(
      contextWith({
        incomeByCategory: {
          revenue: 120_000,
          staking_reward: 18_000,
          funding_round: 5_000_000,
        },
      })
    );
    expect(out).toContain("Recurring operating income");
    expect(out).toContain("Non-recurring income");
    expect(out).toContain("Total recurring operating income: $138.0K");
    expect(out).toContain("Total non-recurring income: $5.0M");
    // The blended figure ($5.138M) must appear nowhere.
    expect(out).not.toContain("$5.1M");
  });

  it("states the recurring share, so 3% is not written up as revenue", () => {
    const out = revenue.userPromptFragment(
      contextWith({
        incomeByCategory: { revenue: 150_000, funding_round: 5_000_000 },
      })
    );
    expect(out).toContain("Recurring share of all income this period: 2.9%");
  });

  it("drops empty categories instead of printing $0 rows", () => {
    const out = revenue.userPromptFragment(
      contextWith({
        incomeByCategory: {
          revenue: 120_000,
          staking_reward: 0,
          funding_round: 0,
          airdrop: 0,
        },
      })
    );
    expect(out).not.toContain("$0");
    expect(out).not.toContain("Staking");
    expect(out).not.toContain("Non-recurring income");
  });

  it("carries the prior period's recurring figure and the change", () => {
    const prev = snapshotWith({
      snapshotDate: "2026-03-31",
      incomeByCategory: { revenue: 100_000, funding_round: 9_000_000 },
    });
    const out = revenue.userPromptFragment(
      contextWith({ incomeByCategory: { revenue: 120_000 } }, prev)
    );
    expect(out).toContain(
      "Prior period (2026-03-31) recurring operating income: $100.0K"
    );
    expect(out).toContain("+$20.0K (+20.0%)");
    // Prior non-recurring income is not carried — it would invite exactly the
    // blended comparison the section forbids.
    expect(out).not.toContain("$9.0M");
  });

  it("preserves the sign when recurring income fell", () => {
    const prev = snapshotWith({
      snapshotDate: "2026-03-31",
      incomeByCategory: { revenue: 200_000 },
    });
    const out = revenue.userPromptFragment(
      contextWith({ incomeByCategory: { revenue: 120_000 } }, prev)
    );
    expect(out).toContain("-$80.0K (-40.0%)");
  });

  it("forbids a direction outright when no prior breakdown exists", () => {
    const out = revenue.userPromptFragment(
      contextWith({ incomeByCategory: { revenue: 120_000 } })
    );
    expect(out).toContain("Prior-period comparison: NOT AVAILABLE");
    expect(out).toContain("Do not state a direction, trend or trajectory");
  });

  it("distinguishes a prior period of zero from a missing prior period", () => {
    const prev = snapshotWith({
      snapshotDate: "2026-03-31",
      incomeByCategory: { funding_round: 5_000_000 },
    });
    const out = revenue.userPromptFragment(
      contextWith({ incomeByCategory: { revenue: 120_000 } }, prev)
    );
    expect(out).toContain("recorded no recurring operating income");
    // No percentage increase from zero.
    expect(out).not.toContain("%)");
  });
});

describe("protocol_revenue — system prompt fragment", () => {
  const rules = section("protocol_revenue").systemPromptFragment;

  it("forbids summing recurring and non-recurring into one figure", () => {
    expect(rules).toContain("Never add the two groups into a single figure");
  });

  it("forbids calling a raise, token sale or airdrop revenue", () => {
    expect(rules).toMatch(/Never call a funding round, token sale proceeds, or an airdrop "revenue"/);
  });

  it("forbids reading a trend off one period", () => {
    expect(rules).toContain("One period is not a trend");
  });
});

// ─── major transactions ────────────────────────────────────────────────────

function txPayload(
  sample: Record<string, unknown>[],
  meta: Record<string, unknown> = {}
) {
  return {
    sample,
    totalCount: sample.length,
    capped: false,
    ...meta,
  };
}

function outflow(overrides: Record<string, unknown> = {}) {
  return {
    hash: "0xabc",
    from: "0x9999999999999999999999999999999999999999",
    to: "0xd551234ae421e3bcba99a0da6d736074f22192ff", // Binance
    token: "USDC",
    valueUsd: 1_200_000,
    timestamp: Date.UTC(2026, 3, 12),
    direction: "out",
    category: "token_sale",
    priceUnknown: false,
    ...overrides,
  };
}

describe("major_transactions — requires", () => {
  const major = section("major_transactions");

  it("triggers when at least one transaction clears the threshold", () => {
    expect(
      major.requires(contextWith({ transactionsRaw: txPayload([outflow()]) }))
    ).toBe(true);
  });

  it("does not trigger when everything sits below the threshold", () => {
    // 0.5% of $8.5M = $42.5K.
    expect(
      major.requires(
        contextWith({ transactionsRaw: txPayload([outflow({ valueUsd: 40_000 })]) })
      )
    ).toBe(false);
  });

  it("does not trigger on internal transfers or unpriced rows alone", () => {
    const ctx = contextWith({
      transactionsRaw: txPayload([
        outflow({ category: "internal_transfer", valueUsd: 4_000_000 }),
        outflow({ priceUnknown: true, valueUsd: 4_000_000 }),
      ]),
    });
    expect(major.requires(ctx)).toBe(false);
  });

  it("does not trigger on a missing or malformed payload", () => {
    for (const transactionsRaw of [null, undefined, {}, [], "nope", 3]) {
      expect(major.requires(contextWith({ transactionsRaw }))).toBe(false);
    }
  });
});

describe("major_transactions — user prompt fragment", () => {
  const major = section("major_transactions");

  it("emits one row per transaction with all six columns", () => {
    const out = major.userPromptFragment(
      contextWith({ transactionsRaw: txPayload([outflow()]) })
    );
    expect(out).toContain(
      "Date | Direction | Amount | Asset | Category | Counterparty"
    );
    expect(out).toContain(
      "- 2026-04-12 | outgoing | $1.2M | USDC | token_sale | Binance"
    );
  });

  it("states the threshold and what was excluded", () => {
    const out = major.userPromptFragment(
      contextWith({ transactionsRaw: txPayload([outflow()]) })
    );
    expect(out).toContain("$42.5K");
    expect(out).toContain("own wallets are excluded");
    expect(out).toContain("could not be priced are excluded");
  });

  it("truncates an unrecognised counterparty rather than naming it", () => {
    const out = major.userPromptFragment(
      contextWith({
        transactionsRaw: txPayload([
          outflow({ to: "0x1234567890abcdef1234567890abcdefabcdabcd" }),
        ]),
      })
    );
    expect(out).toContain("0x1234…abcd");
  });

  it("footnotes the sampling caveat when the stored list was capped", () => {
    const out = major.userPromptFragment(
      contextWith({
        transactionsRaw: txPayload([outflow()], {
          totalCount: 640,
          capped: true,
        }),
      })
    );
    expect(out).toContain("SAMPLING NOTE");
    expect(out).toContain("most recent transactions");
    expect(out).toContain("640");
    expect(out).toContain("NOT necessarily the largest of the period");
    expect(out).toContain("This caveat MUST appear in the section.");
  });

  it("omits the caveat when the sync stored every transaction", () => {
    const out = major.userPromptFragment(
      contextWith({ transactionsRaw: txPayload([outflow()]) })
    );
    expect(out).not.toContain("SAMPLING NOTE");
  });

  it("says how many qualified when the table was truncated to the row cap", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      outflow({ hash: `0x${i}`, valueUsd: 2_000_000 - i * 1_000 })
    );
    const out = major.userPromptFragment(
      contextWith({ transactionsRaw: txPayload(many) })
    );
    expect(out).toContain("Showing the 8 largest of 12 transactions");
  });
});

describe("major_transactions — system prompt fragment", () => {
  const rules = section("major_transactions").systemPromptFragment;

  it("forbids inventing a purpose for a transfer", () => {
    expect(rules).toContain("Never invent a purpose for a transfer");
    expect(rules).toContain("Sold treasury assets to fund operations");
  });

  it("makes the sampling caveat mandatory rather than optional", () => {
    expect(rules).toContain("MUST carry that caveat");
    expect(rules).toContain(
      "Do not present the table as the definitive list of the largest transactions"
    );
  });
});

describe("both sections stay silent when their data is absent", () => {
  it("emits no block at all for an unsynced snapshot", () => {
    const ctx = contextWith({ incomeByCategory: null, transactionsRaw: null });
    const enabled = resolveSections(null);
    const user = buildUserPrompt(ctx, enabled);
    expect(user).not.toContain("## Income by source");
    expect(user).not.toContain("## Major transactions");
  });

  it("emits both blocks when the snapshot carries the data", () => {
    const ctx = contextWith({
      incomeByCategory: { revenue: 120_000, funding_round: 5_000_000 },
      transactionsRaw: txPayload([outflow()]),
    });
    const user = buildUserPrompt(ctx, resolveSections(null));
    expect(user).toContain("## Income by source");
    expect(user).toContain("## Major transactions");
  });
});

// ─── liquid runway + concentration ─────────────────────────────────────────
//
// A deliberately realistic own-token-heavy treasury: $8.5M total, of which
// $5M is the project's own token. Total-treasury runway flatters it; liquid
// runway is the figure an investor can act on. The two must never be confused,
// which is why every assertion below is on the labelled line, not the number.

const OWN_CONTRACT = "0x1111111111111111111111111111111111111111";

const OWN_TOKEN_HEAVY_BALANCES = [
  {
    walletAddress: "0xtreasury",
    chain: "ethereum",
    tokens: [
      { symbol: "USDC", valueUsd: 1_600_000 },
      { symbol: "WETH", valueUsd: 900_000 },
      { symbol: "WBTC", valueUsd: 600_000 },
      { symbol: "TEST", contractAddress: OWN_CONTRACT, valueUsd: 5_000_000 },
      { symbol: "RANDOMDAO", contractAddress: "0xabc", valueUsd: 200_000 },
    ],
  },
  {
    walletAddress: "0xops",
    chain: "arbitrum",
    tokens: [
      {
        symbol: "wstETH",
        contractAddress: "0x5979D7b546E38E414F7E9822514be443A4800529",
        valueUsd: 200_000,
      },
    ],
  },
];

const TOKEN_PROJECT = {
  name: "Test Protocol",
  tokenSymbol: "TEST",
  tokenContract: OWN_CONTRACT,
} as unknown as ReportSectionContext["project"];

/** Three prior periods with real outflows — a full trailing sample. */
const TRAILING_BURNS = [
  { burnRateUsd: "300000" },
  { burnRateUsd: "260000" },
  { burnRateUsd: "220000" },
] as unknown as TreasurySnapshot[];

function ownTokenHeavyContext(
  snapshotFields: Record<string, unknown> = {},
  extra: Partial<ReportSectionContext> = {}
): ReportSectionContext {
  return contextWith(
    {
      balancesDetail: OWN_TOKEN_HEAVY_BALANCES,
      burnRateUsd: "320000",
      runwayMonths: "26.6",
      totalOutflowsUsd: "320000",
      ...snapshotFields,
    },
    null,
    { project: TOKEN_PROJECT, trailing: TRAILING_BURNS, ...extra }
  );
}

describe("financial_health — both runways", () => {
  const health = section("financial_health");

  it("emits both runway figures, each labelled with its own denominator", () => {
    const out = health.userPromptFragment(ownTokenHeavyContext());
    // 8.5M / 320K, straight from the stored column — reported, not redefined.
    expect(out).toContain(
      "- Runway (total treasury ÷ this month's burn): 26.6 months"
    );
    // (1.6M stables + 1.7M liquid crypto) / 260K trailing avg = 12.7.
    expect(out).toContain(
      "- Runway (liquid reserves ÷ trailing 3-mo avg burn): 12.7 months"
    );
    expect(out).toContain("UPPER BOUND");
  });

  it("excludes the own token and the unrecognised assets from liquid reserves", () => {
    const out = health.userPromptFragment(ownTokenHeavyContext());
    expect(out).toContain(
      "- Spendable liquid reserves (stablecoins + liquid crypto): $3.3M"
    );
    expect(out).toContain(
      "TEST, the project's own token — NOT spendable reserves: $5.0M (58.8% of the treasury)"
    );
  });

  it("breaks BTC out instead of leaving it in 'other assets'", () => {
    const out = health.userPromptFragment(ownTokenHeavyContext());
    expect(out).toContain("of which BTC and wrapped BTC: $600.0K");
    expect(out).toContain(
      "- Other assets, unrecognised and treated as illiquid: $200.0K"
    );
  });

  it("reports the trailing average with its sample size, and the trend", () => {
    const out = health.userPromptFragment(ownTokenHeavyContext());
    expect(out).toContain("- Trailing 3-month average burn: $260.0K");
    expect(out).toContain("3 prior periods that recorded operating outflows");
    // 320K vs 260K is +23%, outside the ±15% dead band.
    expect(out).toContain("- Burn trend vs that trailing average: accelerating");
  });

  it("flags a thin trailing sample and drops the zero-burn month from it", () => {
    const out = health.userPromptFragment(
      ownTokenHeavyContext(
        {},
        {
          trailing: [
            { burnRateUsd: "300000" },
            { burnRateUsd: "0" },
          ] as unknown as TreasurySnapshot[],
        }
      )
    );
    expect(out).toContain("- Trailing 3-month average burn: $300.0K");
    expect(out).toContain("1 prior period that recorded operating outflows");
    expect(out).toContain("THIN SAMPLE");
  });

  it("labels the fallback denominator when there is no trailing history", () => {
    const out = health.userPromptFragment(
      ownTokenHeavyContext({}, { trailing: [] })
    );
    // Never dressed up as a trailing average it does not have.
    expect(out).not.toContain("trailing 3-mo avg burn");
    expect(out).toContain(
      "- Runway (liquid reserves ÷ this month's burn (no trailing history yet)): 10.3 months"
    );
  });

  it("says runway is NOT MEASURABLE — never zero — when burn is zero", () => {
    const out = health.userPromptFragment(
      ownTokenHeavyContext(
        { burnRateUsd: "0", runwayMonths: null, totalOutflowsUsd: "150000" },
        { trailing: [] }
      )
    );
    expect(out).toContain(
      "- Runway (total treasury ÷ this month's burn): NOT MEASURABLE this period"
    );
    expect(out).toContain(
      "- Runway (liquid reserves ÷ average burn): NOT MEASURABLE"
    );
    expect(out).not.toContain("0.0 months");
    expect(out).toContain("Do not state this as a runway of zero.");
  });

  it("refuses to compute a liquid runway from a snapshot with no per-token detail", () => {
    const out = health.userPromptFragment(
      ownTokenHeavyContext({ balancesDetail: null })
    );
    expect(out).toContain(
      "- Runway (liquid reserves ÷ average burn): NOT COMPUTABLE"
    );
    expect(out).not.toContain("Treasury liquidity");
    // The legacy figure still gets reported — with its caveat attached.
    expect(out).toContain(
      "- Runway (total treasury ÷ this month's burn): 26.6 months"
    );
  });

  it("leads the system prompt with the liquid figure", () => {
    expect(health.systemPromptFragment).toContain("Lead with the liquid runway");
    expect(health.systemPromptFragment).toContain(
      "NEVER present the total-treasury figure as the headline"
    );
  });
});

describe("treasury_concentration", () => {
  const concentration = section("treasury_concentration");

  it("sits directly after treasury_by_chain and ships on by default", () => {
    expect(LIBRARY_IDS[LIBRARY_IDS.indexOf("treasury_by_chain") + 1]).toBe(
      "treasury_concentration"
    );
    expect(DEFAULT_IDS).toContain("treasury_concentration");
  });

  it("splices into a config saved before it existed", () => {
    const stored = fullConfig().filter((e) => e.id !== "treasury_concentration");
    expect(ids(stored)).toEqual(LIBRARY_IDS);
  });

  it("fires on own-token concentration above 20%", () => {
    expect(concentration.requires(ownTokenHeavyContext())).toBe(true);
  });

  it("fires on thin stablecoin cover even with no own token", () => {
    // $150K of stables against $260K average burn — 0.6 months.
    const ctx = ownTokenHeavyContext({
      balancesDetail: [
        {
          chain: "ethereum",
          tokens: [
            { symbol: "USDC", valueUsd: 150_000 },
            { symbol: "WETH", valueUsd: 4_000_000 },
          ],
        },
      ],
    });
    expect(concentration.requires(ctx)).toBe(true);
    expect(concentration.userPromptFragment(ctx)).toContain(
      "- Stablecoin cover: 0.6 months"
    );
  });

  it("stays silent on a diversified treasury with deep stablecoin cover", () => {
    const ctx = ownTokenHeavyContext({
      balancesDetail: [
        {
          chain: "ethereum",
          tokens: [
            { symbol: "USDC", valueUsd: 5_000_000 },
            { symbol: "WETH", valueUsd: 1_000_000 },
          ],
        },
      ],
    });
    expect(concentration.requires(ctx)).toBe(false);
    expect(concentration.userPromptFragment(ctx)).toBe("");
  });

  // Regression coverage for the `requires()` / `userPromptFragment()` drift:
  // `requires()` correctly gates on two independent triggers (own-token
  // concentration above the floor, or stablecoin cover thinner than the
  // floor), but `userPromptFragment()` used to only check the weaker
  // `liq.derived && liq.totalUsd > 0` half of that gate — so it emitted the
  // block for any treasury with parseable balances, whether or not either
  // real trigger condition held. These pin `requires()` and
  // `userPromptFragment()` to agree in all four quadrants.
  describe("requires() and userPromptFragment() agree on the same trigger", () => {
    it("does NOT fire when concentration is at the floor and cover is unmeasurable — the exact production bug", () => {
      // Mirrors the live "Uniswap DAO Treasury" case this bug was found in:
      // the dominant holding has no contractAddress and the project has no
      // tokenSymbol, so it lands in the generic "other assets" bucket rather
      // than `concentratedUsd` (concentrationPct stays 0), and there is zero
      // burn with no trailing history, so stablecoin cover is legitimately
      // unmeasurable (avgUsd stays 0). Neither trigger condition is true, so
      // this section must not fire at all.
      const ctx = contextWith(
        {
          balancesDetail: [
            {
              walletAddress: "0xtreasury",
              chain: "ethereum",
              tokens: [{ symbol: "UNI", valueUsd: 8_500_000 }],
            },
          ],
          burnRateUsd: "0",
          totalOutflowsUsd: "0",
        },
        null,
        {
          project: {} as unknown as ReportSectionContext["project"],
          trailing: [],
        }
      );
      expect(concentration.requires(ctx)).toBe(false);
      expect(concentration.userPromptFragment(ctx)).toBe("");
    });

    it("fires on own-token concentration alone, even with cover unmeasurable", () => {
      const ctx = ownTokenHeavyContext(
        { burnRateUsd: "0", totalOutflowsUsd: "0" },
        { trailing: [] }
      );
      expect(concentration.requires(ctx)).toBe(true);
      expect(concentration.userPromptFragment(ctx)).not.toBe("");
      expect(concentration.userPromptFragment(ctx)).toContain(
        "not measurable"
      );
    });

    it("fires on thin stablecoin cover alone, with concentration at the floor", () => {
      // $150K of stables against $260K trailing average burn — 0.6 months,
      // well under the 3-month floor — and no own-token holding at all.
      const ctx = ownTokenHeavyContext({
        balancesDetail: [
          {
            chain: "ethereum",
            tokens: [
              { symbol: "USDC", valueUsd: 150_000 },
              { symbol: "WETH", valueUsd: 4_000_000 },
            ],
          },
        ],
      });
      expect(concentration.requires(ctx)).toBe(true);
      expect(concentration.userPromptFragment(ctx)).not.toBe("");
      expect(concentration.userPromptFragment(ctx)).toContain(
        "- Stablecoin cover: 0.6 months"
      );
    });

    it("does NOT fire when concentration is at the floor and cover is at or above it", () => {
      // Same diversified treasury as above, but healthy: $5M stables against
      // $260K trailing average burn is ~19 months of cover, well clear of
      // the 3-month floor.
      const ctx = ownTokenHeavyContext({
        balancesDetail: [
          {
            chain: "ethereum",
            tokens: [
              { symbol: "USDC", valueUsd: 5_000_000 },
              { symbol: "WETH", valueUsd: 1_000_000 },
            ],
          },
        ],
      });
      expect(concentration.requires(ctx)).toBe(false);
      expect(concentration.userPromptFragment(ctx)).toBe("");
    });
  });

  it("NEVER fires on a snapshot without per-token balances", () => {
    // Zero buckets would otherwise read as "zero months of stablecoin cover"
    // and fire this section on every legacy row in the database.
    for (const balancesDetail of [null, undefined, [], "legacy", {}]) {
      expect(
        concentration.requires(ownTokenHeavyContext({ balancesDetail }))
      ).toBe(false);
      expect(
        concentration.userPromptFragment(
          ownTokenHeavyContext({ balancesDetail })
        )
      ).toBe("");
    }
  });

  it("gives the model the buckets, the concentration and the cover", () => {
    const out = concentration.userPromptFragment(ownTokenHeavyContext());
    expect(out).toContain(
      "## Treasury concentration and liquidity (2026-04-30)"
    );
    expect(out).toContain("- Total treasury measured per-token: $8.5M");
    expect(out).toContain("58.8% of the treasury");
    expect(out).toContain("- Liquid stablecoins: $1.6M");
    expect(out).toContain("- Stablecoin cover: 6.2 months");
  });

  it("forbids alarmism and advice in its system prompt", () => {
    expect(concentration.systemPromptFragment).toContain(
      "No alarmism and no advice"
    );
    expect(concentration.systemPromptFragment).toContain(
      "Two sentences, maximum."
    );
  });

  it("renders end-to-end in the default section set", () => {
    const user = buildUserPrompt(ownTokenHeavyContext(), resolveSections(null));
    expect(user).toContain("## Treasury concentration and liquidity");
    expect(user).toContain("## Financial Metrics");
  });
});

// ─── anomalies ─────────────────────────────────────────────────────────────
//
// The section used to declare `requires: () => true` and an empty fragment,
// with report-generator.ts appending the anomaly block to the finished user
// prompt. Disabling the section therefore stripped its rules — including
// "Don't fabricate causes" — while the figures still reached the model.
// These tests pin the data to the same switch as the rules.

const BURN_ANOMALY = {
  metric: "Burn rate",
  current: 640_000,
  baseline: 320_000,
  changePct: 100,
  severity: "critical",
} as const;

const NEW_CATEGORY_ANOMALY = {
  metric: "Expense: audits",
  current: 90_000,
  baseline: 0,
  changePct: 100,
  severity: "minor",
  newCategory: true,
} as const;

describe("anomalies — gating", () => {
  const anomalies = section("anomalies");

  it("is not required when no anomaly was detected", () => {
    expect(anomalies.requires(contextWith({}))).toBe(false);
  });

  it("is required as soon as one anomaly is detected", () => {
    const ctx = contextWith({}, null, { anomalies: [BURN_ANOMALY] });
    expect(anomalies.requires(ctx)).toBe(true);
  });

  it("emits nothing when there are no anomalies", () => {
    expect(anomalies.userPromptFragment(contextWith({}))).toBe("");
  });
});

describe("anomalies — prompt fragment", () => {
  const anomalies = section("anomalies");

  it("emits the ## Anomalies header the system rules key off", () => {
    const out = anomalies.userPromptFragment(
      contextWith({}, null, { anomalies: [BURN_ANOMALY] })
    );
    expect(out).toContain("## Anomalies");
    expect(out).toContain("Burn rate: $320000 → $640000 (+100%, critical)");
  });

  it("labels a first-occurrence metric as having no prior history", () => {
    const out = anomalies.userPromptFragment(
      contextWith({}, null, { anomalies: [NEW_CATEGORY_ANOMALY] })
    );
    expect(out).toContain("no prior history — first occurrence");
  });

  it("does not claim a trailing-N baseline it cannot know", () => {
    // The header used to interpolate `anomalies.length` as the number of
    // baseline months, so one anomaly read "vs trailing-1 avg" regardless of
    // the real sample. Per-metric baselines differ; the header must not
    // assert a width.
    const out = anomalies.userPromptFragment(
      contextWith({}, null, { anomalies: [BURN_ANOMALY] })
    );
    expect(out).toContain("## Anomalies (vs trailing average)");
    expect(out).not.toMatch(/trailing-\d/);
  });
});

describe("anomalies — data and rules share one switch", () => {
  const withAnomaly = () =>
    contextWith({}, null, { anomalies: [BURN_ANOMALY] });

  it("puts the block in the user prompt when the section is enabled", () => {
    const user = buildUserPrompt(withAnomaly(), resolveSections(null));
    expect(user).toContain("## Anomalies");
    expect(user).toContain("Burn rate:");
  });

  it("keeps the block out of the user prompt when the section is disabled", () => {
    const stored = fullConfig().map((e) =>
      e.id === "anomalies" ? { ...e, enabled: false } : e
    );
    const user = buildUserPrompt(withAnomaly(), resolveSections(stored));
    expect(user).not.toContain("## Anomalies");
    expect(user).not.toContain("Burn rate:");
  });
});

// ─── plan vs actual ────────────────────────────────────────────────────────
//
// The section exists to put a founder's own plan next to what the treasury
// actually did. Two failure modes it must not have: reporting variances the
// reader cannot act on (the >20%-AND->$5K filter), and rendering a heading
// over a project that never typed a plan.

const BUDGET_PERIOD = "2026-04";

/** A `project_budgets` row, in the shape the router writes. */
function budget(
  fields: Partial<{
    id: string;
    kind: "expense" | "income";
    category: string;
    plannedUsd: string | number;
    period: string;
    notes: string | null;
    updatedAt: Date | null;
  }> = {}
): ReportSectionContext["budgets"][number] {
  return {
    id: fields.id ?? `b-${fields.category ?? "x"}-${fields.kind ?? "expense"}`,
    projectId: "p1",
    period: fields.period ?? BUDGET_PERIOD,
    kind: fields.kind ?? "expense",
    category: fields.category ?? "__total__",
    plannedUsd: String(fields.plannedUsd ?? 0),
    notes: fields.notes ?? null,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: fields.updatedAt ?? new Date("2026-04-02T00:00:00Z"),
  } as unknown as ReportSectionContext["budgets"][number];
}

/** Context carrying a budget plus the actuals it is measured against. */
function budgetContext(
  budgets: ReportSectionContext["budgets"],
  snapshotFields: Record<string, unknown> = {}
): ReportSectionContext {
  return contextWith(
    {
      expensesByCategory: {
        payroll: 280_000,
        infrastructure: 35_000,
        token_sale: 150_000,
      },
      incomeByCategory: { revenue: 120_000 },
      ...snapshotFields,
    },
    null,
    { budgets }
  );
}

describe("client-safe category mirrors", () => {
  // report-derived.ts is in the client bundle graph and cannot import
  // expense-classifier.ts (it opens with `import OpenAI from "openai"`), so
  // the names are duplicated. A rename on one side with no rename on the
  // other gives the budget form a category the router's Zod enum rejects —
  // a form that silently cannot be submitted. These two assertions are the
  // only thing standing between that and a deploy.
  it("mirrors every expense category, in order", () => {
    expect([...EXPENSE_CATEGORY_NAMES]).toEqual([...EXPENSE_CATEGORIES]);
  });

  it("mirrors every income category", () => {
    expect([...INCOME_CATEGORY_NAMES].sort()).toEqual(
      [...INCOME_CATEGORIES].sort()
    );
  });
});

describe("actual_vs_budget — placement and default", () => {
  const budgetSection = section("actual_vs_budget");

  it("is the one library section that ships off by default", () => {
    expect(budgetSection.defaultEnabled).toBe(false);
    expect(DEFAULT_IDS).not.toContain("actual_vs_budget");
  });

  it("is not spliced into a config saved before it existed", () => {
    // The counterpart of off-by-default: resolveSections only re-adds
    // sections that default on, so an existing founder is not handed a
    // section that would render nothing for them.
    const stored = fullConfig().filter((e) => e.id !== "actual_vs_budget");
    expect(ids(stored)).not.toContain("actual_vs_budget");
  });
});

describe("actual_vs_budget — requires", () => {
  const budgetSection = section("actual_vs_budget");

  it("is gated off when the project has no budget at all", () => {
    expect(budgetSection.requires(budgetContext([]))).toBe(false);
    expect(budgetSection.userPromptFragment(budgetContext([]))).toBe("");
  });

  it("is gated off when the only budget belongs to another period", () => {
    const ctx = budgetContext([
      budget({ period: "2026-03", plannedUsd: 300_000 }),
    ]);
    expect(budgetSection.requires(ctx)).toBe(false);
    expect(budgetSection.userPromptFragment(ctx)).toBe("");
  });

  it("fires on a single row for this period", () => {
    expect(
      budgetSection.requires(budgetContext([budget({ plannedUsd: 300_000 })]))
    ).toBe(true);
  });

  it("names the manual-entry path in its notReadyHint", () => {
    expect(budgetSection.notReadyHint).toContain("Edit data");
  });
});

describe("actual_vs_budget — a '__total__'-only plan", () => {
  const budgetSection = section("actual_vs_budget");
  // One planned number, $250K, against $315K of operating spend
  // (280K payroll + 35K infra; the 150K token_sale is a reallocation).
  const out = budgetSection.userPromptFragment(
    budgetContext([budget({ category: "__total__", plannedUsd: 250_000 })])
  );

  it("renders one total row and says the plan was not itemised", () => {
    expect(out).toContain("## Plan vs actual (2026-04)");
    expect(out).toContain("planned ONE total for the period");
    expect(out).toContain(
      "Total operating spend: planned $250.0K, actual $315.0K, variance +$65.0K (+26.0%)"
    );
  });

  it("compares against operating spend only, excluding the reallocation", () => {
    // $465K would be the figure if token_sale had been swept in — the number
    // that turns a $65K overspend into a $215K one that never happened.
    expect(out).not.toContain("$465.0K");
    expect(out).toContain(
      "Treasury reallocation (the token_sale bucket) is excluded"
    );
  });

  it("emits no per-category rows to pad the table with", () => {
    expect(out).not.toContain("payroll:");
    expect(out).not.toContain("infrastructure:");
  });

  it("includes the reallocation bucket when the founder budgeted it by name", () => {
    const itemised = budgetSection.userPromptFragment(
      budgetContext([
        budget({ category: "payroll", plannedUsd: 260_000 }),
        budget({ category: "token_sale", plannedUsd: 100_000 }),
      ])
    );
    expect(itemised).toContain("token_sale: planned $100.0K, actual $150.0K");
  });
});

describe("actual_vs_budget — an itemised plan", () => {
  const budgetSection = section("actual_vs_budget");
  const out = budgetSection.userPromptFragment(
    budgetContext([
      budget({ category: "payroll", plannedUsd: 200_000 }),
      budget({ category: "infrastructure", plannedUsd: 40_000 }),
      budget({
        kind: "income",
        category: "revenue",
        plannedUsd: 200_000,
        notes: "assumes the fee switch lands mid-month",
      }),
    ])
  );

  it("gives every planned category planned / actual / variance $ / variance %", () => {
    expect(out).toContain(
      "payroll: planned $200.0K, actual $280.0K, variance +$80.0K (+40.0%)"
    );
    expect(out).toContain(
      "infrastructure: planned $40.0K, actual $35.0K, variance -$5.0K (-12.5%)"
    );
  });

  it("closes each side with a total row that its own lines add up to", () => {
    // 200K + 40K planned, 280K + 35K actual.
    expect(out).toContain(
      "Total operating spend: planned $240.0K, actual $315.0K, variance +$75.0K (+31.3%)"
    );
    expect(out).toContain(
      "Total income: planned $200.0K, actual $120.0K, variance -$80.0K (-40.0%)"
    );
  });

  it("carries the founder's own note through to the line it belongs to", () => {
    expect(out).toContain(
      "founder's note: assumes the fee switch lands mid-month"
    );
  });

  it("refuses a percentage for a category the plan never mentioned", () => {
    const unplanned = budgetSection.userPromptFragment(
      budgetContext([budget({ category: "payroll", plannedUsd: 200_000 })], {
        expensesByCategory: { payroll: 200_000, legal: 42_000 },
      })
    );
    expect(unplanned).toContain("legal: planned not in the plan, actual $42.0K");
    expect(unplanned).toContain(
      "percentage not meaningful — nothing was planned for this line"
    );
    expect(unplanned).not.toContain("Infinity");
    expect(unplanned).not.toMatch(/legal:.*NaN/);
  });
});

describe("actual_vs_budget — the materiality filter", () => {
  const budgetSection = section("actual_vs_budget");

  /** One expense line, planned vs actual, as the bullet the prompt emits. */
  function lineFor(planned: number, actual: number): string {
    const out = budgetSection.userPromptFragment(
      budgetContext(
        [
          budget({ category: "payroll", plannedUsd: planned }),
          // A second planned line keeps the plan itemised so the per-category
          // bullet (not just the total) is what we are reading.
          budget({ category: "legal", plannedUsd: 1_000 }),
        ],
        { expensesByCategory: { payroll: actual, legal: 1_000 } }
      )
    );
    const line = out.split("\n").find((l) => l.startsWith("- payroll:"));
    if (!line) throw new Error(`no payroll line in:\n${out}`);
    return line;
  }

  it("marks a variance MATERIAL only when it clears BOTH floors", () => {
    // 50% over and $100K over — both floors cleared.
    expect(lineFor(200_000, 300_000)).toContain("MATERIAL");
  });

  it("suppresses a huge percentage on a tiny line", () => {
    // +200% but only $100 — the noise the dollar floor exists to kill.
    const line = lineFor(50, 150);
    expect(line).toContain("+200.0%");
    expect(line).toContain("within tolerance — do NOT call this out");
    expect(line).not.toContain("MATERIAL");
  });

  it("suppresses a large dollar gap that is a small share of the plan", () => {
    // $50K over, but only 5% of a $1M line — big number, no story.
    const line = lineFor(1_000_000, 1_050_000);
    expect(line).toContain("+5.0%");
    expect(line).toContain("within tolerance — do NOT call this out");
    expect(line).not.toContain("MATERIAL");
  });

  it("holds the floors as exclusive, not inclusive", () => {
    // Exactly 20% and exactly $5K clears neither `>` comparison.
    const line = lineFor(25_000, 30_000);
    expect(line).toContain("+20.0%");
    expect(line).toContain("within tolerance");
  });

  it("applies the same filter to under-spend", () => {
    const line = lineFor(200_000, 100_000);
    expect(line).toContain("MATERIAL");
    expect(line).toContain("spent less than planned");
  });

  it("judges an unplanned line on the dollar floor alone", () => {
    const out = budgetSection.userPromptFragment(
      budgetContext([budget({ category: "payroll", plannedUsd: 200_000 })], {
        expensesByCategory: { payroll: 200_000, legal: 42_000, other: 900 },
      })
    );
    const lines = out.split("\n");
    expect(lines.find((l) => l.startsWith("- legal:"))).toContain("MATERIAL");
    expect(lines.find((l) => l.startsWith("- other:"))).toContain(
      "within tolerance"
    );
  });
});

describe("actual_vs_budget — how variance is allowed to be framed", () => {
  const budgetSection = section("actual_vs_budget");
  const rules = budgetSection.systemPromptFragment;

  it("forbids treating under-spend as good news", () => {
    expect(rules).toContain("Under-spend is not automatically good news");
    expect(rules).toContain("a hire that did not happen");
    // The specific words a model reaches for when congratulating a project
    // for not spending its money.
    expect(rules).toContain(
      "never be framed as a win, a saving, efficiency, or discipline"
    );
  });

  it("states the direction neutrally in the data itself", () => {
    const out = budgetSection.userPromptFragment(
      budgetContext([
        budget({ category: "payroll", plannedUsd: 400_000 }),
        budget({ category: "infrastructure", plannedUsd: 40_000 }),
      ])
    );
    expect(out).toContain("spent less than planned");
    // Not "saved", not "efficient" — both read as approval.
    expect(out).not.toMatch(/\bsaved\b/);
    expect(out).not.toMatch(/\befficien/i);
  });

  it("hands the model the verdict rather than the thresholds", () => {
    expect(rules).toContain("Call out ONLY the lines the input marks MATERIAL");
    expect(rules).toContain("do not editorialise");
  });

  it("forbids attributing a variance to a cause", () => {
    expect(rules).toContain("Do not attribute any variance to a cause");
  });
});

describe("actual_vs_budget — data and rules share one switch", () => {
  it("keeps the block out of a report that never enabled the section", () => {
    const ctx = budgetContext([budget({ plannedUsd: 250_000 })]);
    const user = buildUserPrompt(ctx, resolveSections(null));
    expect(user).not.toContain("## Plan vs actual");
  });

  it("emits the block once the founder enables it and has a plan", () => {
    const ctx = budgetContext([budget({ plannedUsd: 250_000 })]);
    const user = buildUserPrompt(ctx, resolveSections(fullConfig()));
    expect(user).toContain("## Plan vs actual (2026-04)");
  });

  it("stays silent when enabled but no plan exists for the period", () => {
    const user = buildUserPrompt(budgetContext([]), resolveSections(fullConfig()));
    expect(user).not.toContain("## Plan vs actual");
  });
});
