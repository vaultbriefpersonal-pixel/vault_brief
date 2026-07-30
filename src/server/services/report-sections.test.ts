import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
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
  changeSignificanceFloor,
  DUST_FLOOR_USD,
  EXPENSE_CATEGORY_NAMES,
  INCOME_CATEGORY_NAMES,
  RECURRING_INCOME_FLOOR_USD,
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

  it("does NOT trigger on recurring income below the revenue floor", () => {
    // The floor is RECURRING_INCOME_FLOOR_USD ($5K absolute), not the
    // proportional `ctx.minSignificant`. Below it, recurring income is dust
    // yield rather than a business line.
    expect(
      revenue.requires(
        contextWith({
          incomeByCategory: { revenue: RECURRING_INCOME_FLOOR_USD - 1 },
        })
      )
    ).toBe(false);
    expect(
      revenue.requires(
        contextWith({
          incomeByCategory: { revenue: RECURRING_INCOME_FLOOR_USD + 1 },
        })
      )
    ).toBe(true);
  });

  it("fires on real revenue that a proportional floor would have suppressed", () => {
    // The reason the floors were split. Revenue is measured against burn, not
    // against the balance sheet: a protocol earning $500K/month has a revenue
    // line whether it holds $8.5M or $1.06B, and gating on 0.1% of the treasury
    // deleted the whole section for the large one. Here the treasury is $1.06B,
    // so `minSignificant` is ~$1.06M and the old gate would have said false.
    const ctx = contextWith(
      { incomeByCategory: { revenue: 500_000 } },
      null,
      { total: 1_055_781_357.29, minSignificant: 1_055_781.36 }
    );
    expect(ctx.minSignificant).toBeGreaterThan(500_000);
    expect(revenue.requires(ctx)).toBe(true);
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

// ─── the three floors ──────────────────────────────────────────────────────
//
// One floor used to serve three incompatible questions. On the fixture
// treasury it evaluated to ~$1.06M, which was simultaneously the right bar for
// "is this delta worth a sentence?" and catastrophically wrong for "does this
// holding exist?" and "is there a revenue line?".

describe("the three significance floors are distinct and correctly shaped", () => {
  it("keeps the change floor proportional, with an absolute $1K arm", () => {
    expect(changeSignificanceFloor(1_055_781_357.29)).toBeCloseTo(1_055_781.36, 2);
    // Below $1M of treasury the proportional arm is under $1K, so the absolute
    // arm takes over — a $9 move in a $9K treasury is still not a finding.
    expect(changeSignificanceFloor(9_000)).toBe(1_000);
    expect(changeSignificanceFloor(0)).toBe(1_000);
    expect(changeSignificanceFloor(Number.NaN)).toBe(1_000);
    expect(changeSignificanceFloor(-5)).toBe(1_000);
  });

  it("keeps the composition and revenue floors absolute", () => {
    expect(DUST_FLOOR_USD).toBe(100);
    expect(RECURRING_INCOME_FLOOR_USD).toBe(5_000);
  });

  it("makes the composition floor independent of treasury size — the point of the split", () => {
    // The regression this encodes: at $1.06B the proportional floor is four
    // orders of magnitude above the dust floor, so composition gated on it
    // deleted every liquidity figure the treasury had.
    expect(changeSignificanceFloor(1_055_781_357.29)).toBeGreaterThan(
      DUST_FLOOR_USD * 10_000
    );
    expect(changeSignificanceFloor(1_055_781_357.29)).toBeGreaterThan(
      RECURRING_INCOME_FLOOR_USD * 100
    );
  });
});

// ─── treasury_overview: composition derived at read time ───────────────────
//
// The section used to read the four FROZEN snapshot columns
// (`stablecoins_usd` / `eth_usd` / `native_token_usd` / `other_assets_usd`),
// computed once at sync time against whatever the project had entered then, and
// gate each bucket on `ctx.minSignificant` = 0.1% of the treasury.
//
// On the real fixture — the Uniswap DAO Treasury, snapshot
// 306f5550-ac28-4beb-aacd-cdc79b96e757 — those two facts combined to produce a
// Treasury Overview table with exactly ONE row, "Other assets $1.06B 100%":
// `projects.token_symbol` was NULL at sync so `native_token_usd` froze at
// $0.00, and the proportional floor evaluated to ~$1.06M so the $1,136 of
// stablecoins and the $440 of ETH were both suppressed. There was also no
// per-individual-token row source anywhere in the product, though
// `balances_detail` held all 53 holdings.

/** The fixture's stored per-token shape: NO `contractAddress` key on any row. */
const B5_TOTAL = 1_055_781_357.29;
const B5_BALANCES = [
  {
    walletAddress: "0x1a9c8182c09f50c8318d769245bea52c32be35bc",
    chain: "ethereum",
    tokens: [
      {
        name: "Uniswap",
        amount: 267_134_858.4790704,
        symbol: "UNI",
        priceUsd: 3.952232120812,
        valueUsd: 1_055_778_968.2695498,
      },
      { name: "Tether USD", amount: 1_000.96, symbol: "USDT", priceUsd: 1, valueUsd: 1_000.96 },
      { name: "henlo", amount: 2.1e12, symbol: "henlo", priceUsd: 3.3767e-10, valueUsd: 709.12 },
      { name: "Ethereum", amount: 0.1, symbol: "ETH", priceUsd: 4_395.7, valueUsd: 439.57 },
      { name: "USD Coin", amount: 135.38, symbol: "USDC", priceUsd: 1, valueUsd: 135.38 },
      { name: "Alethea", amount: 931_800, symbol: "ALI", priceUsd: 0.0001, valueUsd: 93.18 },
      { name: "Spam", amount: 5_000, symbol: "ZIK", priceUsd: 0.001, valueUsd: 5 },
      { name: "Unpriceable", amount: 146_000_000, symbol: "AQ0", priceUsd: 0, valueUsd: 0 },
    ],
  },
];

/** The fixture as it is TODAY: token symbol set, no contract, no re-sync. */
const B5_PROJECT = {
  name: "Uniswap DAO Treasury",
  tokenSymbol: "UNI",
  tokenContract: null,
} as unknown as ReportSectionContext["project"];

function b5Context(
  extra: Partial<ReportSectionContext> = {}
): ReportSectionContext {
  return contextWith(
    {
      balancesDetail: B5_BALANCES,
      totalBalanceUsd: String(B5_TOTAL),
      // The frozen columns, exactly as stored — deliberately wrong, and
      // deliberately still present, so a regression that reads them again is
      // visible as "Other assets $1.06B" reappearing.
      stablecoinsUsd: "1136.34",
      ethUsd: "439.57",
      nativeTokenUsd: "0.00",
      otherAssetsUsd: "1055779781.38",
    },
    null,
    {
      project: B5_PROJECT,
      total: B5_TOTAL,
      // ~$1.06M — the floor that suppressed both liquidity figures.
      minSignificant: Math.max(B5_TOTAL * 0.001, 1_000),
      ...extra,
    }
  );
}

describe("treasury_overview — the literal B5 regression", () => {
  const overview = section("treasury_overview");

  it("emits the $1,136 stablecoin bullet against a $1.06B total", () => {
    const ctx = b5Context();
    // The proportional floor is three orders of magnitude above the figure.
    expect(ctx.minSignificant).toBeGreaterThan(1_000_000);
    const fragment = overview.userPromptFragment(ctx);
    // `formatUsd` compacts at $1K, so $1,136.34 prints as "$1.1K" — the shared
    // formatter every section uses, and the figure it conveys is the finding:
    // roughly a thousand dollars of spendable cash against $1.06B of assets.
    expect(fragment).toContain("- Stablecoins: $1.1K");
    expect(fragment).toContain("- Total balance: $1.06B");
  });

  it("emits the ETH bullet the proportional floor suppressed", () => {
    expect(overview.userPromptFragment(b5Context())).toContain("$439.57");
  });

  it("attributes the $1.06B to the project's own token, not to Other assets", () => {
    const fragment = overview.userPromptFragment(b5Context());
    expect(fragment).toContain("UNI, the project's own token");
    // The one-row table that shipped. `other` is genuinely near-zero here —
    // henlo + ALI — so an "Other assets" line at a billion means the frozen
    // column is being read again.
    expect(fragment).not.toContain("- Other assets, unrecognised and treated as illiquid: $1.06B");
  });

  it("emits per-asset rows — a source that did not exist anywhere before", () => {
    const fragment = overview.userPromptFragment(b5Context());
    expect(fragment).toContain("Individual holdings, largest first");
    expect(fragment).toContain("UNI on ethereum: $1.06B");
    expect(fragment).toContain("USDT on ethereum: $1.0K");
    expect(fragment).toContain("USDC on ethereum: $135.38");
    // At least one row beyond the headline position.
    const rows = fragment
      .split("\n")
      .filter((l) => /^- \w+ on \w+: /.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("rolls dust up instead of naming it, and never names an unpriced holding", () => {
    const fragment = overview.userPromptFragment(b5Context());
    // ZIK is $5 — below DUST_FLOOR_USD, so it is counted and never named.
    expect(fragment).not.toContain("ZIK");
    expect(fragment).toContain("smaller holding");
    // AQ0 holds 146M units at no price: reported as a count, in no total.
    expect(fragment).not.toContain("AQ0");
    expect(fragment).toContain("1 holding with no price feed");
  });

  it("keeps the named rows and the rollup adding up to the per-token total", () => {
    const fragment = overview.userPromptFragment(b5Context());
    expect(fragment).toContain("- Total across priced holdings:");
    expect(fragment).toContain("- Total balance: $1.06B");
  });

  it("gates buckets on DUST_FLOOR_USD, not on the proportional floor", () => {
    // A stablecoin position below the absolute floor genuinely is not a
    // holding worth a bullet — the floor still exists, it is just the right one.
    const ctx = contextWith(
      {
        balancesDetail: [
          {
            walletAddress: "0xw",
            chain: "ethereum",
            tokens: [
              { symbol: "USDC", valueUsd: DUST_FLOOR_USD - 1 },
              { symbol: "MYSTERY", valueUsd: 5_000_000 },
            ],
          },
        ],
      },
      null,
      { minSignificant: 5_000 }
    );
    const fragment = overview.userPromptFragment(ctx);
    expect(fragment).not.toContain("- Stablecoins:");
    expect(fragment).toContain("Other assets, unrecognised");
  });

  it("carries the rules that keep dust and unpriced holdings honest", () => {
    expect(overview.systemPromptFragment).toContain("derived at read time");
    expect(overview.systemPromptFragment).toContain("must never be named");
    expect(overview.systemPromptFragment).toContain("no price feed");
  });

  it("renders end-to-end in the default section set", () => {
    const user = buildUserPrompt(b5Context(), resolveSections(null));
    expect(user).toContain("## Current Treasury");
    expect(user).toContain("- Stablecoins: $1.1K");
    expect(user).toContain("Individual holdings, largest first");
    const system = buildSystemPrompt(resolveSections(null), b5Context());
    expect(system).toContain("### Treasury Overview");
  });
});

describe("treasury_overview — underived, legacy and malformed payloads", () => {
  const overview = section("treasury_overview");

  it("still renders the total when the snapshot carries no per-token detail", () => {
    // Every snapshot predating `balances_detail`. `derived` is false, so no
    // bucket line and no asset row may be printed — but the headline total is
    // real and must not disappear with them.
    for (const balancesDetail of [null, undefined, [], "garbage", 7, [{}]]) {
      const ctx = contextWith({ balancesDetail }, null, { project: B5_PROJECT });
      expect(overview.requires(ctx)).toBe(true);
      const fragment = overview.userPromptFragment(ctx);
      expect(fragment).toContain("- Total balance:");
      expect(fragment).not.toContain("- Stablecoins:");
      expect(fragment).not.toContain("Individual holdings");
      expect(fragment).not.toContain("no price feed");
    }
  });

  it("produces no findings and does not throw when there is no data at all", () => {
    const ctx = contextWith({ balancesDetail: null }, null, {
      total: 0,
      minSignificant: 0,
    });
    expect(() => overview.requires(ctx)).not.toThrow();
    expect(overview.requires(ctx)).toBe(false);
    expect(overview.userPromptFragment(ctx)).toBe("");
  });

  it("gates and renders off ONE memoized composition — requires and fragment agree", () => {
    // The shared-predicate rule: a gate that fires while the fragment is empty
    // puts a heading with nothing under it into the prompt, which is an
    // invitation for the model to fill the gap itself.
    for (const ctx of [
      b5Context(),
      contextWith({ balancesDetail: null }, null, { total: 0, minSignificant: 0 }),
      contextWith({ balancesDetail: B5_BALANCES }, null, {
        project: B5_PROJECT,
        total: 0,
      }),
    ]) {
      expect(overview.requires(ctx)).toBe(overview.userPromptFragment(ctx) !== "");
    }
  });
});

describe("treasury_by_chain — gated on the absolute floor", () => {
  const byChain = section("treasury_by_chain");

  it("keeps a real six-figure chain in the split on a billion-dollar treasury", () => {
    // At 0.1% of $1.06B the old proportional gate was ~$1.06M, so a chain
    // holding $250K vanished — and if that left fewer than two chains, the
    // whole section vanished with it.
    const ctx = b5Context({
      snapshot: undefined,
    });
    const withChains = contextWith(
      {
        balancesDetail: B5_BALANCES,
        totalBalanceUsd: String(B5_TOTAL),
        balancesByChain: { ethereum: B5_TOTAL - 250_000, arbitrum: 250_000 },
      },
      null,
      { project: B5_PROJECT, total: ctx.total, minSignificant: ctx.minSignificant }
    );
    expect(byChain.requires(withChains)).toBe(true);
    expect(byChain.userPromptFragment(withChains)).toContain("arbitrum");
  });

  it("still drops a chain holding actual dust", () => {
    const ctx = contextWith(
      {
        totalBalanceUsd: "1000000",
        balancesByChain: { ethereum: 1_000_000, base: DUST_FLOOR_USD - 1 },
      },
      null,
      { total: 1_000_000, minSignificant: 1_000 }
    );
    expect(byChain.requires(ctx)).toBe(false);
    expect(byChain.userPromptFragment(ctx)).toBe("");
  });
});

// ─── buildSystemPrompt gates conditional rules by data presence ───────────
//
// `buildSystemPrompt` used to include every enabled section's rule text
// unconditionally, regardless of whether that section's own trigger held
// for this period. Most rules are self-labelled "(CONDITIONAL)" and tell
// the model to only render "when the input contains a '## X' block" — but
// with the rule present even when that block was absent, a model could (and
// in production did) reconstruct the section's narrative from figures that
// belong to a different, unconditionally-present section, obeying the
// letter of "use only the provided data" while violating the point of it.
//
// The fix gates each section's rule by the same signal `buildUserPrompt`
// already uses to gate its data block — `userPromptFragment(ctx)` being
// non-empty — with one explicit exception: `executive_summary` (whose
// fragment is always empty by design) and `lows_concerns` (whose fragment
// is empty exactly when it is designed to fall back to a graceful "nothing
// material" sentence) always keep their rule.
describe("buildSystemPrompt gates conditional rules by data presence", () => {
  it("does NOT include the Treasury Concentration rule when its own trigger is false — the exact production bug", () => {
    // Same "Uniswap DAO Treasury"-shaped ctx as the requires()/fragment
    // agreement tests above: the dominant holding has no contractAddress and
    // the project has no tokenSymbol, so nothing lands in `concentratedUsd`
    // (concentrationPct stays 0), and there is no burn history to measure
    // stablecoin cover against either (avgUsd stays 0). Neither trigger
    // holds, so `treasury_concentration`'s data block is correctly absent
    // from the user prompt. Before this fix, `buildSystemPrompt` took no
    // `ctx` argument at all and included every enabled section's rule text
    // unconditionally — so this exact rule (with its "(CONDITIONAL)" label
    // and the "Only render when..." instruction) still reached the model
    // every time, whether or not the data justified it. Only gating the
    // rule itself, the same way the data block is gated, closes that gap.
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
    const system = buildSystemPrompt(resolveSections(null), ctx);
    expect(system).not.toContain("Treasury Concentration");
  });

  it("includes a CONDITIONAL section's rule when its own data qualifies", () => {
    const ctx = contextWith({
      transactionsRaw: txPayload([outflow()]),
    });
    const system = buildSystemPrompt(resolveSections(null), ctx);
    expect(system).toContain("### Major Transactions");
  });

  // No prior snapshot, no balances, no milestones, no anomalies, no GitHub
  // activity, no income — `wins`, `lows_concerns` and `key_takeaways` all
  // declare `requires: () => true` (a UI-readiness signal, not a per-report
  // one), so only their own fragment being empty distinguishes "nothing to
  // say this period" from "something to say". `total`/`minSignificant` are
  // zeroed too so `key_takeaways`' headline block has nothing to anchor on.
  const emptyEvidenceCtx = contextWith({}, null, {
    total: 0,
    minSignificant: 0,
  });

  it("drops the Wins rule when the evidence ledger is empty — a behavior change from before this fix", () => {
    const system = buildSystemPrompt(resolveSections(null), emptyEvidenceCtx);
    expect(system).not.toContain("### Wins");
  });

  it("keeps the Lows/Concerns rule when the evidence ledger is empty — the explicit exception", () => {
    const system = buildSystemPrompt(resolveSections(null), emptyEvidenceCtx);
    expect(system).toContain("### Lows / Concerns");
  });

  it("always includes Executive Summary regardless of data state", () => {
    const system = buildSystemPrompt(resolveSections(null), emptyEvidenceCtx);
    expect(system).toContain("### Executive Summary");
  });

  it("drops Key Takeaways when there is genuinely no headline, positive or negative to anchor a bullet to", () => {
    const system = buildSystemPrompt(resolveSections(null), emptyEvidenceCtx);
    expect(system).not.toContain("### Key Takeaways");
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

// ─── the contractAddress key transition ────────────────────────────────────
//
// Snapshots taken before wallet-sync persisted contract addresses key their
// ERC-20s `chain:SYMBOL`; later ones key them by address. treasury-attribution
// matches across that boundary on chain+symbol and flags the row
// `symbolResolved`. Anything narrating such a row has to disclose the weaker
// identity, or a holding that was merely re-recorded reads as a transfer.

describe("previous_month_comparison — rows matched only by symbol", () => {
  function rekeyContext(currTokenExtras: Record<string, unknown>) {
    const legacyToken = {
      symbol: "UNI",
      name: "Uniswap",
      amount: 1_000_000,
      priceUsd: 4,
      valueUsd: 4_000_000,
    };
    const prevSnapshot = snapshotWith({
      snapshotDate: "2026-03-31",
      totalBalanceUsd: "4000000",
      balancesDetail: [
        { walletAddress: "0xaaa", chain: "ethereum", tokens: [legacyToken] },
      ],
    });
    return contextWith(
      {
        totalBalanceUsd: "6000000",
        balancesDetail: [
          {
            walletAddress: "0xaaa",
            chain: "ethereum",
            tokens: [
              {
                ...legacyToken,
                amount: 1_500_000,
                valueUsd: 6_000_000,
                ...currTokenExtras,
              },
            ],
          },
        ],
      },
      prevSnapshot
    );
  }

  it("discloses that the row was matched on chain+symbol, not on contract", () => {
    const fragment = section("previous_month_comparison").userPromptFragment(
      rekeyContext({ contractAddress: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984" })
    );
    expect(fragment).toContain("UNI on ethereum");
    expect(fragment).toContain("matched across a change in stored token identity");
    expect(fragment).toContain("do not describe this row as a transfer");
  });

  it("reports the holding once, not as a paired exit and entry", () => {
    const fragment = section("previous_month_comparison").userPromptFragment(
      rekeyContext({ contractAddress: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984" })
    );
    expect(fragment.match(/- UNI on ethereum/g)).toHaveLength(1);
  });

  it("adds no such caveat when both sides carried the same contract", () => {
    const contract = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
    const token = {
      symbol: "UNI",
      name: "Uniswap",
      amount: 1_000_000,
      priceUsd: 4,
      valueUsd: 4_000_000,
      contractAddress: contract,
    };
    const prevSnapshot = snapshotWith({
      snapshotDate: "2026-03-31",
      totalBalanceUsd: "4000000",
      balancesDetail: [
        { walletAddress: "0xaaa", chain: "ethereum", tokens: [token] },
      ],
    });
    const ctx = contextWith(
      {
        totalBalanceUsd: "6000000",
        balancesDetail: [
          {
            walletAddress: "0xaaa",
            chain: "ethereum",
            tokens: [{ ...token, amount: 1_500_000, valueUsd: 6_000_000 }],
          },
        ],
      },
      prevSnapshot
    );
    const fragment = section("previous_month_comparison").userPromptFragment(ctx);
    expect(fragment).toContain("quantity moved, price unchanged");
    expect(fragment).not.toContain("stored token identity");
  });
});
