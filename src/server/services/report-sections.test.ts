import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  evaluateReadiness,
  getSectionById,
  resolveSections,
  resolveSystemRules,
  sectionIdsWithContent,
  SECTION_LIBRARY,
  type ReportSection,
  type ReportSectionContext,
  type SectionConfigEntry,
} from "./report-sections";
import { decisionLedger } from "./report-evidence";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./expense-classifier";
import {
  awardsForPeriod,
  changeSignificanceFloor,
  DUST_FLOOR_USD,
  EXPENSE_CATEGORY_NAMES,
  grantDeliverables,
  grantFundUsage,
  grantLeftoverFunds,
  grantPlanDeviations,
  INCOME_CATEGORY_NAMES,
  NO_PLAN_DEVIATION,
  RECURRING_INCOME_FLOOR_USD,
  splitIncome,
} from "./report-derived";
import {
  longGapDaysFor,
  periodFromRange,
  periodOfMonth,
  type ReportPeriod,
} from "./report-period";
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
    // The whole of April 2026 — `kind: "month"`, `tag: "2026-04"`. Exactly the
    // period the bare "2026-04" string used to stand for, so every assertion
    // below is unchanged. Overridable via `extra` for the custom-period tests.
    period: periodOfMonth("2026-04"),
    grants: [],
    governanceProposals: [],
    partners: [],
    asks: [],
    qaHighlights: [],
    budgets: [],
    // Explicit, not left to the `as unknown as` cast at the bottom of this
    // builder: an omitted field passes through it silently, which is exactly
    // how a stale `period: string` survived into Phase 1. Both grant sections
    // gate on these, and they default to empty so every existing assertion
    // below is unchanged.
    grantAwards: [],
    grantTranches: [],
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

describe("recommendations — placement and default", () => {
  it("sits directly after next_period_forecast and before looking_ahead", () => {
    expect(LIBRARY_IDS[LIBRARY_IDS.indexOf("next_period_forecast") + 1]).toBe(
      "recommendations"
    );
    expect(LIBRARY_IDS[LIBRARY_IDS.indexOf("recommendations") + 1]).toBe(
      "looking_ahead"
    );
  });

  it("ships on by default", () => {
    expect(DEFAULT_IDS).toContain("recommendations");
  });

  it("splices into a config saved before it existed, landing directly after next_period_forecast", () => {
    const stored = fullConfig().filter((e) => e.id !== "recommendations");
    const result = ids(stored);
    expect(result).toEqual(LIBRARY_IDS);
    expect(result[result.indexOf("next_period_forecast") + 1]).toBe(
      "recommendations"
    );
  });
});

describe("recommendations — requires", () => {
  const recommendations = section("recommendations");

  it("is false when the context has no evidence, liquidity, budget, or composition to cite", () => {
    const ctx = contextWith({ balancesDetail: undefined, burnRateUsd: undefined });
    expect(recommendations.requires(ctx)).toBe(false);
  });

  it("is true once the treasury has at least one priced holding for compositionOf to surface", () => {
    const ctx = contextWith({
      balancesDetail: [
        {
          walletAddress: "0xaaa",
          chain: "ethereum",
          tokens: [
            {
              symbol: "USDC",
              amount: 1_000_000,
              priceUsd: 1,
              valueUsd: 1_000_000,
              contractAddress: null,
            },
          ],
        },
      ],
    });
    expect(recommendations.requires(ctx)).toBe(true);
  });
});

describe("relaxed 'no advice' bans redirect to Recommendations; absolute bans survive verbatim", () => {
  // The five places that used to blanket-prohibit operational commentary.
  // Four were found by grepping report-sections.ts for
  // recommend|advice|advise|guidance|prescribe (key_takeaways, lows_concerns,
  // treasury_concentration, next_period_forecast). The fifth — actual_vs_budget's
  // "do not tell the project what to do about it" — used none of those words
  // and only turned up on a broader search for the operational-commentary
  // category itself.
  const RELAXED_SECTION_IDS = [
    "key_takeaways",
    "lows_concerns",
    "treasury_concentration",
    "actual_vs_budget",
    "next_period_forecast",
  ];

  it("each relaxed section's system prompt now redirects to the Recommendations section", () => {
    for (const id of RELAXED_SECTION_IDS) {
      expect(section(id).systemPromptFragment).toContain(
        "Recommendations section"
      );
    }
  });

  it("next_period_forecast still absolutely bans projecting token price, market cap, or valuation", () => {
    expect(section("next_period_forecast").systemPromptFragment).toContain(
      "Never project, mention, or imply a future token price, market cap, or valuation"
    );
  });

  it("next_period_forecast's forbidden-verbs / conditional-framing rule survives untouched", () => {
    const fragment = section("next_period_forecast").systemPromptFragment;
    expect(fragment).toContain(
      "Forbidden verbs and phrasings, without exception:"
    );
    expect(fragment).toContain('"will", "expects to", "is on track to"');
  });

  it("treasury_concentration still absolutely bans buy/sell/hold advice about the token itself", () => {
    expect(section("treasury_concentration").systemPromptFragment).toContain(
      "advise the reader to buy, sell, or hold the token itself"
    );
  });

  it("the new recommendations section restates both absolute bans in its own rules", () => {
    const fragment = section("recommendations").systemPromptFragment;
    expect(fragment).toMatch(
      /never mention, project, or imply a future token price, market cap, or valuation/i
    );
    expect(fragment).toMatch(
      /never advise the reader to buy, sell, or hold the token/i
    );
  });
});

describe("buildSystemPrompt — platform disclaimer rule", () => {
  it("tells the model never to write its own disclaimer", () => {
    const system = buildSystemPrompt(resolveSections(null), contextWith({}));
    expect(system).toContain(
      "Never write your own disclaimer, risk warning"
    );
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

  it("does NOT trigger on a grant tranche alone — an award is not revenue", () => {
    // Same category error as the funding round above, one reader worse: the
    // grantor receives a "Protocol Revenue" heading describing their own award.
    // The gate reads recurring income only, so no size of grant opens it.
    expect(
      revenue.requires(
        contextWith({
          incomeByCategory: {
            grant_received: RECURRING_INCOME_FLOOR_USD * 1_000,
          },
        })
      )
    ).toBe(false);
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
          sampleBasis: "top-50-by-value + 150-most-recent, per transfer leg",
        }),
      })
    );
    expect(out).toContain("SAMPLING NOTE");
    expect(out).toContain("stored a SAMPLE of the period's transfers");
    expect(out).toContain(
      "selection basis: top-50-by-value + 150-most-recent, per transfer leg"
    );
    expect(out).toContain("640");
    expect(out).toContain("NOT necessarily the largest of the period");
    expect(out).toContain("This caveat MUST appear in the section.");
  });

  it("never claims the sample is the period's most recent transactions", () => {
    // The old note described sampling that was replaced in d10ff59 — it told
    // the reader the rows came from "the N most recent transactions" long
    // after the sampler had switched to (50 largest ∪ 150 recent).
    const capped = major.userPromptFragment(
      contextWith({
        transactionsRaw: txPayload([outflow()], {
          totalCount: 640,
          capped: true,
        }),
      })
    );
    const uncapped = major.userPromptFragment(
      contextWith({ transactionsRaw: txPayload([outflow()]) })
    );
    expect(capped).not.toContain("most recent");
    expect(uncapped).not.toContain("most recent");
    // With no recorded basis, the note says so rather than naming a rule.
    expect(capped).toContain("did not record how the sample was selected");
  });

  it("omits the caveat when the sync stored every transaction", () => {
    const out = major.userPromptFragment(
      contextWith({ transactionsRaw: txPayload([outflow()]) })
    );
    expect(out).not.toContain("SAMPLING NOTE");
  });

  it("labels a single transfer as one, and a grouped transaction by its leg count", () => {
    const single = major.userPromptFragment(
      contextWith({ transactionsRaw: txPayload([outflow()]) })
    );
    expect(single).toContain("| 1 transfer");

    const batch = major.userPromptFragment(
      contextWith({
        transactionsRaw: txPayload(
          Array.from({ length: 8 }, (_, i) =>
            outflow({ hash: "0xbatch", to: `0xrecipient${i}`, valueUsd: 500_000 })
          )
        ),
      })
    );
    expect(batch).toContain("| 8 transfers");
    expect(batch).toContain("$4.0M");
    expect(batch).toContain("8 counterparties");
  });

  it("marks a partially-priced transaction as a floor", () => {
    const out = major.userPromptFragment(
      contextWith({
        transactionsRaw: txPayload([
          outflow({ hash: "0xpartial", to: "0xa", valueUsd: 900_000 }),
          outflow({
            hash: "0xpartial",
            to: "0xb",
            valueUsd: 0,
            priceUnknown: true,
          }),
        ]),
      })
    );
    expect(out).toContain("| 1 transfer*");
    expect(out).toContain("That amount is a FLOOR");
  });

  it("accounts for the gap between stored transfers and rendered rows", () => {
    const out = major.userPromptFragment(
      contextWith({
        transactionsRaw: txPayload([
          outflow({ hash: "0xkeep" }),
          outflow({ hash: "0xint", category: "internal_transfer" }),
          outflow({ hash: "0xnoprice", priceUnknown: true }),
          outflow({ hash: "0xtiny", valueUsd: 100 }),
        ]),
      })
    );
    expect(out).toContain("ACCOUNTING: the snapshot stored 4 transfers");
    expect(out).toContain("1 internal (between the project's own wallets)");
    expect(out).toContain("1 with no resolvable price");
    expect(out).toContain("1 fell below the threshold");
    expect(out).toContain("that is grouping and filtering, not missing data");
  });

  it("omits the accounting line when nothing was excluded", () => {
    const out = major.userPromptFragment(
      contextWith({ transactionsRaw: txPayload([outflow()]) })
    );
    expect(out).not.toContain("ACCOUNTING");
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

// Regression coverage for the `requires()` / `userPromptFragment()` drift —
// Stage 10 fix #2. Unlike its siblings (treasury_overview,
// treasury_concentration), `financial_health`'s `requires()` used to check
// only burn/inflows/outflows, while `userPromptFragment()` could
// independently produce non-empty content from trailing-burn, liquidity or
// net-flow-only data `requires()` never looked at. Since `buildUserPrompt`
// filters by `requires()` before calling `userPromptFragment()`, and
// `buildSystemPrompt` filters by `userPromptFragment()` non-emptiness
// instead, the old split let the RULES into the system prompt while the
// DATA silently never made it into the user prompt. `requires()` is now
// exactly `financialHealthLines(ctx).length > 0`, so the two can never
// disagree again — same discipline as `treasury_overview`/
// `treasury_concentration` above.
describe("financial_health — requires() and userPromptFragment() agree", () => {
  const health = section("financial_health");

  it("agree on every existing financial_health fixture in this file", () => {
    const fixtures = [
      contextWith({}),
      ownTokenHeavyContext(),
      ownTokenHeavyContext({ balancesDetail: null }),
      contextWith({ burnRateUsd: "0", runwayMonths: null }),
    ];
    for (const ctx of fixtures) {
      expect(health.requires(ctx)).toBe(health.userPromptFragment(ctx) !== "");
    }
  });

  it("the exact edge case: burn/inflows/outflows all zero-or-null, net flow present — fires in BOTH prompts, not just one", () => {
    // The DB-query edge case named in the plan: burn_rate_usd,
    // total_inflows_usd and total_outflows_usd are all zero-or-null, but
    // net_flow_usd is stated. The OLD `requires()` formula
    // (`Number(burnRateUsd ?? 0) > 0 || Number(totalInflowsUsd ?? 0) > 0 ||
    // Number(totalOutflowsUsd ?? 0) > 0`) is false here — pinned below so a
    // future reader can see exactly what used to disagree.
    const ctx = contextWith({
      burnRateUsd: null,
      totalInflowsUsd: null,
      totalOutflowsUsd: null,
      runwayMonths: null,
      netFlowUsd: "-25000",
    });
    const oldRequires =
      Number(ctx.snapshot.burnRateUsd ?? 0) > 0 ||
      Number(ctx.snapshot.totalInflowsUsd ?? 0) > 0 ||
      Number(ctx.snapshot.totalOutflowsUsd ?? 0) > 0;
    expect(oldRequires).toBe(false);

    // New behavior: requires() and the fragment agree, and both include the
    // net flow.
    expect(health.requires(ctx)).toBe(true);
    const fragment = health.userPromptFragment(ctx);
    expect(fragment).not.toBe("");
    expect(fragment).toContain("Net flow (inflows minus outflows): -$25.0K");

    // And it shows up in BOTH assembled prompts via the section pipeline,
    // not just one of them — the failure mode this fix closes.
    const enabled = resolveSections(null);
    expect(buildUserPrompt(ctx, enabled)).toContain(
      "Net flow (inflows minus outflows): -$25.0K"
    );
    expect(buildSystemPrompt(enabled, ctx)).toContain("### Financial Health");
  });

  it("agree on the untouched majority case: nonzero burn always fires both, unaffected by this fix", () => {
    const ctx = contextWith({ burnRateUsd: "320000", runwayMonths: "16.3" });
    expect(health.requires(ctx)).toBe(true);
    expect(health.userPromptFragment(ctx)).not.toBe("");
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

  it("forbids alarmism, and still absolutely bans buy/sell/hold advice about the token itself (P1.2 relaxed blanket 'no advice' to redirect operational commentary to Recommendations)", () => {
    expect(concentration.systemPromptFragment).toContain("No alarmism.");
    expect(concentration.systemPromptFragment).toContain(
      "advise the reader to buy, sell, or hold the token itself"
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

// Real production bug: `executive_summary`'s userPromptFragment was a
// permanent no-op ("handled implicitly by snapshot context"), so its own
// system rule ("Use exact numbers") had no real figure to point at — the
// model echoed a literal "$X.XM"/"$XXM" placeholder instead, confirmed in
// 3/3 live-generated reports. The fix reuses `key_takeaways`' own
// `headlineLines` computation so the section always gets real anchor figures
// when any exist.
describe("executive_summary — real anchor figures, not a permanent no-op", () => {
  it("supplies a non-empty fragment containing the real formatted treasury total", () => {
    const ctx = contextWith({});
    const fragment = section("executive_summary").userPromptFragment(ctx);
    expect(fragment).not.toBe("");
    expect(fragment).toContain("$8.5M");
  });

  it("is empty when headlineLines itself has nothing to anchor to — the ALWAYS_INCLUDE_RULE safety net still applies at the rule level", () => {
    const ctx = contextWith({}, null, { total: 0, minSignificant: 0 });
    const fragment = section("executive_summary").userPromptFragment(ctx);
    expect(fragment).toBe("");
  });

  it("never contains a literal $X-shaped placeholder token", () => {
    const fragment = section("executive_summary").userPromptFragment(
      contextWith({})
    );
    expect(fragment).not.toMatch(/\$X\b/);
  });
});

describe("no section's system-prompt rule text contains a literal $X placeholder", () => {
  // Regression guard for the exact bug: two sections' rule text used to
  // contain a literal "$X" fill-in-template example that the model could
  // (and did) echo verbatim when a different section had no real number of
  // its own to write. Both are conditional-framing sections, so the check
  // uses `systemPromptFragment` directly rather than requiring a full ctx.
  const ids = ["major_transactions", "next_period_forecast"];

  for (const id of ids) {
    it(`${id}'s rule text has no bare $X token`, () => {
      const rules = section(id).systemPromptFragment as string;
      expect(rules).not.toMatch(/\$X\b/);
    });
  }
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

  it("carries grant_received on both sides", () => {
    // The mirror test above only proves the two lists agree — they would agree
    // just as happily with the category deleted from both. A grant report that
    // cannot name the money it is reporting on is the failure this pins.
    expect(INCOME_CATEGORIES).toContain("grant_received");
    expect(INCOME_CATEGORY_NAMES).toContain("grant_received");
  });
});

describe("splitIncome — grant_received", () => {
  it("counts a grant tranche as non-recurring, never as recurring", () => {
    // The load-bearing decision of the category. An award is paid against a
    // fixed schedule and stops when the schedule does, so it is not income the
    // protocol can expect again — and the reader of the sentence "recurring
    // operating income" in a grant report is the grantor who wrote the cheque.
    const split = splitIncome({ grant_received: 250_000 });
    expect(split.nonRecurring.entries.map((e) => e.category)).toContain(
      "grant_received"
    );
    expect(split.nonRecurring.totalUsd).toBe(250_000);
    expect(split.recurring.entries).toEqual([]);
    expect(split.recurring.totalUsd).toBe(0);
  });

  it("does not blend a grant into a period's real revenue", () => {
    const split = splitIncome({ revenue: 40_000, grant_received: 250_000 });
    expect(split.recurring.totalUsd).toBe(40_000);
    expect(split.nonRecurring.totalUsd).toBe(250_000);
  });

  it("renders a reader-facing label, not the raw category key", () => {
    const [entry] = splitIncome({ grant_received: 250_000 }).nonRecurring
      .entries;
    expect(entry.label).not.toBe("grant_received");
    expect(entry.label).toContain("Grant");
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

// ─── the long-gap disclosure ───────────────────────────────────────────────
//
// PINNING TESTS, written before the 45-day constant was generalised to
// `longGapDaysFor(ctx.period)`. This block had no coverage anywhere in the
// repo — no unit test, no smoke assertion, no e2e — so the threshold could
// have moved by two days and shipped silently, suppressing a disclosure that
// tells the model not to present a 60-day flow figure as one month's movement.
//
// The 45/46 pair is deliberate: the comparison is strictly `>`, so a period
// exactly at the threshold must stay silent. Anything that widens or narrows
// the monthly threshold fails one of these two.

const LONG_GAP_TOKEN = {
  symbol: "UNI",
  name: "Uniswap",
  amount: 1_000_000,
  priceUsd: 4,
  valueUsd: 4_000_000,
  contractAddress: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
};

/**
 * A month-over-month context whose previous snapshot sits `prevDate` back from
 * the fixture's 2026-04-30. Quantity moves so attribution has a real driver —
 * without that the section takes its legacy early-return branch and never
 * reaches the gap check at all.
 */
function longGapContext(prevDate: string): ReportSectionContext {
  const prevSnapshot = snapshotWith({
    snapshotDate: prevDate,
    totalBalanceUsd: "4000000",
    balancesDetail: [
      { walletAddress: "0xaaa", chain: "ethereum", tokens: [LONG_GAP_TOKEN] },
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
            { ...LONG_GAP_TOKEN, amount: 1_500_000, valueUsd: 6_000_000 },
          ],
        },
      ],
    },
    prevSnapshot
  );
}

describe("previous_month_comparison — the long-gap disclosure (monthly)", () => {
  it("fires when the snapshots are further apart than the threshold", () => {
    // 2026-03-15 → 2026-04-30 is 46 days.
    const fragment = section("previous_month_comparison").userPromptFragment(
      longGapContext("2026-03-15")
    );
    expect(fragment).toContain("NOTE: these snapshots are 46 days apart");
    expect(fragment).toContain("Do NOT compare, reconcile or add the two.");
    expect(fragment).toContain("say explicitly that it spans 46 days");
  });

  it("stays silent exactly at the threshold", () => {
    // 2026-03-16 → 2026-04-30 is 45 days — the comparison is strictly greater.
    const fragment = section("previous_month_comparison").userPromptFragment(
      longGapContext("2026-03-16")
    );
    expect(fragment).not.toContain("days apart");
  });

  it("stays silent for a normal monthly cadence", () => {
    // 2026-03-31 → 2026-04-30 is 30 days.
    const fragment = section("previous_month_comparison").userPromptFragment(
      longGapContext("2026-03-31")
    );
    expect(fragment).not.toContain("days apart");
    expect(fragment).not.toContain("NOTE:");
  });

  it("names the gap in days, not the reporting period, when it fires", () => {
    const fragment = section("previous_month_comparison").userPromptFragment(
      longGapContext("2026-01-31")
    );
    // 2026-01-31 → 2026-04-30 is 89 days.
    expect(fragment).toContain("NOTE: these snapshots are 89 days apart");
    expect(fragment).toContain("far longer than one reporting period");
    expect(fragment).toContain("covers that entire 89-day window");
  });
});

// ═══ custom reporting periods ══════════════════════════════════════════════
//
// Everything below exercises `kind === "custom"`. None of it can regress a
// monthly report: no existing fixture reaches these paths, and the byte-
// identity describe at the very bottom is what guarantees the monthly branch
// of every period-aware string is the one already in production.

/** 14 Feb → 31 Jul 2026 — custom, NOT month-aligned. The grant-window shape. */
const GRANT_PERIOD: ReportPeriod = periodFromRange("2026-02-14", "2026-07-31");

/** 1 Feb → 30 Apr 2026 — custom, but month-aligned. A whole quarter. */
const QUARTER_PERIOD: ReportPeriod = periodFromRange("2026-02-01", "2026-04-30");

const MONTH_PERIOD: ReportPeriod = periodOfMonth("2026-04");

describe("custom periods — manual-entry sections match every month touched", () => {
  function partnerRow(period: string, name: string) {
    return {
      id: `pa-${period}`,
      period,
      name,
      type: "integration",
      url: null,
      notes: null,
    } as unknown as ReportSectionContext["partners"][number];
  }

  it("includes a row from a BOUNDARY month of a custom period", () => {
    // February is the period's first month and the period starts on the 14th.
    // The row is tagged '2026-02' and nothing finer — it is included in full.
    const ctx = contextWith({}, null, {
      period: GRANT_PERIOD,
      partners: [partnerRow("2026-02", "Boundary Co")],
    });
    expect(section("partners_integrations").requires(ctx)).toBe(true);
    expect(
      section("partners_integrations").userPromptFragment(ctx)
    ).toContain("Boundary Co");
  });

  it("includes a row from an INTERIOR month of a custom period", () => {
    const ctx = contextWith({}, null, {
      period: GRANT_PERIOD,
      partners: [partnerRow("2026-05", "Interior Co")],
    });
    expect(
      section("partners_integrations").userPromptFragment(ctx)
    ).toContain("Interior Co");
  });

  it("excludes a row from a month the period does not touch", () => {
    const ctx = contextWith({}, null, {
      period: GRANT_PERIOD,
      partners: [partnerRow("2026-01", "Before Co")],
    });
    expect(section("partners_integrations").requires(ctx)).toBe(false);
    expect(section("partners_integrations").userPromptFragment(ctx)).toBe("");
  });

  it("still matches exactly one month for a monthly period", () => {
    const ctx = contextWith({}, null, {
      period: MONTH_PERIOD,
      partners: [partnerRow("2026-04", "In"), partnerRow("2026-03", "Out")],
    });
    const fragment = section("partners_integrations").userPromptFragment(ctx);
    expect(fragment).toContain("In");
    expect(fragment).not.toContain("Out");
  });

  it("applies the same matching to grants, governance and Q&A", () => {
    const ctx = contextWith({}, null, {
      period: GRANT_PERIOD,
      grants: [
        {
          id: "g1",
          period: "2026-06",
          recipient: "Grantee",
          amountUsd: "50000",
          status: "disbursed",
          category: null,
          notes: null,
        },
      ] as unknown as ReportSectionContext["grants"],
      governanceProposals: [
        {
          id: "gp1",
          period: "2026-07",
          title: "VBP-9",
          status: "passed",
          url: null,
          voteResult: null,
          notes: null,
        },
      ] as unknown as ReportSectionContext["governanceProposals"],
      qaHighlights: [
        {
          id: "q1",
          period: "2026-02",
          question: "Q?",
          answer: "A.",
          askedBy: null,
          displayOrder: 1,
        },
      ] as unknown as ReportSectionContext["qaHighlights"],
    });
    expect(section("grants_distributed").userPromptFragment(ctx)).toContain(
      "Grantee"
    );
    expect(section("governance_updates").userPromptFragment(ctx)).toContain(
      "VBP-9"
    );
    expect(section("qa_highlights").userPromptFragment(ctx)).toContain("Q?");
  });
});

describe("custom periods — the month-granularity disclosure", () => {
  const MANUAL_SECTIONS = [
    "grants_distributed",
    "governance_updates",
    "partners_integrations",
    "qa_highlights",
  ] as const;

  const DISCLOSURE =
    "Manually-entered items are recorded by calendar month. The first and last months of this period are included in full and may contain items dated outside it.";

  function manualCtx(period: ReportPeriod): ReportSectionContext {
    return contextWith({}, null, {
      period,
      grants: [
        {
          id: "g1",
          period: "2026-04",
          recipient: "R",
          amountUsd: "1000",
          status: "disbursed",
          category: null,
          notes: null,
        },
      ] as unknown as ReportSectionContext["grants"],
      governanceProposals: [
        {
          id: "gp1",
          period: "2026-04",
          title: "T",
          status: "passed",
          url: null,
          voteResult: null,
          notes: null,
        },
      ] as unknown as ReportSectionContext["governanceProposals"],
      partners: [
        {
          id: "pa1",
          period: "2026-04",
          name: "N",
          type: null,
          url: null,
          notes: null,
        },
      ] as unknown as ReportSectionContext["partners"],
      qaHighlights: [
        {
          id: "q1",
          period: "2026-04",
          question: "Q?",
          answer: "A.",
          askedBy: null,
          displayOrder: 1,
        },
      ] as unknown as ReportSectionContext["qaHighlights"],
    });
  }

  it("appears on every manual-entry section for a non-aligned custom period", () => {
    const ctx = manualCtx(GRANT_PERIOD);
    for (const id of MANUAL_SECTIONS) {
      expect(section(id).userPromptFragment(ctx)).toContain(DISCLOSURE);
    }
  });

  it("never appears for a monthly period", () => {
    const ctx = manualCtx(MONTH_PERIOD);
    for (const id of MANUAL_SECTIONS) {
      expect(section(id).userPromptFragment(ctx)).not.toContain(
        "recorded by calendar month"
      );
    }
  });

  it("never appears for a month-ALIGNED custom period", () => {
    // A whole quarter includes each of its months in full by construction —
    // "the rows tagged 2026-02" and "February" are the same set, so there is
    // nothing to disclose. Gating on `kind` alone would over-disclose here.
    expect(QUARTER_PERIOD.kind).toBe("custom");
    expect(QUARTER_PERIOD.monthAligned).toBe(true);
    const ctx = manualCtx(QUARTER_PERIOD);
    for (const id of MANUAL_SECTIONS) {
      expect(section(id).userPromptFragment(ctx)).not.toContain(
        "recorded by calendar month"
      );
    }
  });
});

describe("custom periods — actual_vs_budget refuses rather than misleads", () => {
  const plan = [
    budget({ kind: "expense", category: "payroll", plannedUsd: 200_000 }),
    budget({ kind: "expense", category: "infrastructure", plannedUsd: 40_000 }),
  ];

  it("still renders for a monthly period", () => {
    const ctx = budgetContext(plan);
    expect(section("actual_vs_budget").requires(ctx)).toBe(true);
    expect(section("actual_vs_budget").userPromptFragment(ctx)).toContain(
      "## Plan vs actual (2026-04)"
    );
  });

  it("is gated off for a custom period even when the plan rows match", () => {
    const ctx = budgetContext(plan);
    const custom = { ...ctx, period: GRANT_PERIOD } as ReportSectionContext;
    // The rows DO match — the gate is the period's shape, not missing data.
    expect(custom.budgets.length).toBeGreaterThan(0);
    expect(section("actual_vs_budget").requires(custom)).toBe(false);
    expect(section("actual_vs_budget").userPromptFragment(custom)).toBe("");
  });

  it("is gated off for a month-aligned custom period too", () => {
    // A quarter is the exact case where the silent Map collapse in buildSide
    // would produce one month's plan against three months of actuals.
    const ctx = budgetContext(plan);
    const quarter = { ...ctx, period: QUARTER_PERIOD } as ReportSectionContext;
    expect(section("actual_vs_budget").requires(quarter)).toBe(false);
  });

  it("gives the period reason, not the missing-data reason, in its hint", () => {
    const monthly = budgetContext([]);
    const custom = { ...monthly, period: GRANT_PERIOD } as ReportSectionContext;
    const hintOf = (ctx: ReportSectionContext) =>
      evaluateReadiness(ctx).find((r) => r.id === "actual_vs_budget")?.reason;
    expect(hintOf(monthly)).toContain("Edit data");
    expect(hintOf(custom)).toContain("not yet supported");
    expect(hintOf(custom)).not.toContain("Edit data");
  });

  it("keeps budget variances out of the decision ledger for a custom period", () => {
    // A second, independent path from the same rows to the reader:
    // `decisionLedger` calls `budgetComparison` directly, never through
    // `requires`. Gating only the section would hide the table while a
    // MATERIAL variance still reached Recommendations as a citable figure.
    const monthly = budgetContext(plan);
    const custom = { ...monthly, period: GRANT_PERIOD } as ReportSectionContext;
    const budgetEntries = (ctx: ReportSectionContext) =>
      decisionLedger(ctx).filter((e) => e.source === "budget");
    expect(budgetEntries(monthly).length).toBeGreaterThan(0);
    expect(budgetEntries(custom)).toHaveLength(0);
  });
});

describe("custom periods — the long-gap threshold scales", () => {
  it("uses 45 days for a calendar month", () => {
    expect(longGapDaysFor(MONTH_PERIOD)).toBe(45);
  });

  it("scales with the period for a long custom window", () => {
    // 2026-02-14 → 2026-07-31 is 168 days; 168 * 1.5 = 252.
    expect(GRANT_PERIOD.days).toBe(168);
    expect(longGapDaysFor(GRANT_PERIOD)).toBe(252);
  });

  it("stays silent at a gap a monthly period would have disclosed", () => {
    // 89 days fires for a month (threshold 45) and must not for a 168-day
    // window (threshold 252) — two balance readings 89 days apart are not a
    // coverage problem when the period itself is twice that long.
    const ctx = longGapContext("2026-01-31");
    expect(
      section("previous_month_comparison").userPromptFragment(ctx)
    ).toContain("89 days apart");
    const custom = { ...ctx, period: GRANT_PERIOD } as ReportSectionContext;
    expect(
      section("previous_month_comparison").userPromptFragment(custom)
    ).not.toContain("days apart");
  });

  it("fires past the scaled threshold, and does not claim the gap is the longer window", () => {
    // Same 168-day period, snapshots 2026-04-30 vs 2024-01-31 — 820 days.
    const ctx = longGapContext("2024-01-31");
    const custom = { ...ctx, period: GRANT_PERIOD } as ReportSectionContext;
    const fragment =
      section("previous_month_comparison").userPromptFragment(custom);
    expect(fragment).toContain("820 days apart");
    expect(fragment).toContain("while the reporting period covers 168 days");
    expect(fragment).toContain("Do NOT compare, reconcile or add the two.");
    // The monthly sentence's claim inverts for a long period and must be gone.
    expect(fragment).not.toContain("far longer than one reporting period");
  });
});

describe("custom periods — month-denominated prose stops claiming months", () => {
  const customCtx = () =>
    contextWith(
      { burnRateUsd: "320000", runwayMonths: "16.3" },
      null,
      { period: GRANT_PERIOD }
    );
  const monthlyCtx = () =>
    contextWith({ burnRateUsd: "320000", runwayMonths: "16.3" });

  it("labels the outflow figure as a period total, not a monthly rate", () => {
    // Phase 1 emitted the period total alone with a "not a monthly rate"
    // warning, because no normalised figure existed to offer instead. Phase 3
    // computes one, so the line is now a PAIR — the warning is still here, and
    // the reader is no longer left without the number the warning implies.
    const fragment = section("financial_health").userPromptFragment(customCtx());
    expect(fragment).toContain("Total operating outflows over the period");
    expect(fragment).toContain("168 days");
    expect(fragment).toContain("this is a PERIOD TOTAL, not a monthly rate");
    expect(fragment).not.toContain("Monthly burn rate");
  });

  it("keeps the monthly wording for a monthly period", () => {
    const fragment = section("financial_health").userPromptFragment(monthlyCtx());
    expect(fragment).toContain("- Monthly burn rate (this period): $320.0K");
  });

  it("renames the stored-runway denominator consistently in both branches", () => {
    const custom = section("financial_health").userPromptFragment(customCtx());
    expect(custom).toContain(
      "Runway (total treasury ÷ this period's operating outflows, normalised to a calendar month)"
    );
    expect(custom).not.toContain("this month's burn");

    const noBurn = section("financial_health").userPromptFragment(
      contextWith({ burnRateUsd: "0", runwayMonths: null }, null, {
        period: GRANT_PERIOD,
      })
    );
    // The NOT MEASURABLE branch must name the same denominator as the
    // measurable one, or a reader comparing the two lines sees two metrics.
    expect(noBurn).toContain(
      "Runway (total treasury ÷ this period's operating outflows, normalised to a calendar month): NOT MEASURABLE"
    );
  });

  it("states the real window on the Report period line", () => {
    const enabled = resolveSections(null);
    const user = buildUserPrompt(customCtx(), enabled);
    expect(user).toContain(
      "- Report period: 14 Feb – 31 Jul 2026 (2026-02-14 to 2026-07-31, 168 days)"
    );
  });

  it("stops calling the document a monthly report", () => {
    const enabled = resolveSections(null);
    const custom = buildSystemPrompt(enabled, customCtx());
    expect(custom).toContain(
      "Generate an investor report covering 14 Feb – 31 Jul 2026"
    );
    expect(custom).not.toContain("Generate a monthly investor report");
    expect(custom).not.toContain("Compare to previous month");

    const monthly = buildSystemPrompt(enabled, monthlyCtx());
    expect(monthly).toContain(
      "Generate a monthly investor report in Markdown format"
    );
    expect(monthly).toContain("Compare to previous month whenever data is available.");
  });

  it("renames the Month-over-Month rule heading, keeping the block names it gates on", () => {
    const custom = resolveSystemRules(
      section("previous_month_comparison"),
      customCtx()
    );
    expect(custom).toContain("### Period-over-Period (CONDITIONAL)");
    // The two headings the rule matches are emitted verbatim by
    // userPromptFragment and must NOT have been renamed alongside it.
    expect(custom).toContain('"## Treasury change"');
    expect(custom).toContain('"## Previous Month Treasury"');
  });
});

// ─── Phase 3: the numbers, not just the labels ─────────────────────────────
//
// Phase 1 made the prose honest and deliberately left the arithmetic alone —
// a period total labelled as a period total, with no monthly figure to offer
// beside it. These tests are about the figure now existing, the monthly path
// still producing the identical number, and the one section that must go
// silent rather than be reworded.

describe("burn normalisation for custom periods", () => {
  /** A 90-day window: long enough to normalise, long enough to gate. */
  const NINETY = periodFromRange("2026-05-03", "2026-07-31");
  /** 62 days exactly — the last length the forecast is still allowed at. */
  const AT_LIMIT = periodFromRange("2026-05-31", "2026-07-31");

  const burnCtx = (period: ReportPeriod) =>
    contextWith({ burnRateUsd: "1920000", runwayMonths: "26.2" }, null, {
      period,
    });

  it("prints BOTH the period total and the monthly-normalised figure", () => {
    const fragment = section("financial_health").userPromptFragment(
      burnCtx(periodFromRange("2026-02-01", "2026-07-30")) // 180 days
    );
    expect(fragment).toContain(
      "- Total operating outflows over the period (180 days, 2026-02-01 to 2026-07-30): $1.9M"
    );
    // 1_920_000 / (180 / 30.4375) = 324_666.67 → $324.7K at the report's rounding.
    expect(fragment).toContain(
      "- Burn rate normalised to a calendar month: $324.7K"
    );
    expect(fragment).toContain("5.91 calendar months this period covers");
  });

  it("emits neither extra line for a calendar month", () => {
    // The dual figure is a custom-period affordance. A month has one
    // denominator and printing two would invite the model to contrast them.
    const monthly = section("financial_health").userPromptFragment(
      contextWith({ burnRateUsd: "320000", runwayMonths: "16.3" })
    );
    expect(monthly).toContain("- Monthly burn rate (this period): $320.0K");
    expect(monthly).not.toContain("normalised to a calendar month");
    expect(monthly).not.toContain("Total operating outflows over the period");
  });

  it("divides liquid runway by a monthly figure, so it really is months", () => {
    // burnBasis falls back to this period's total when there is no trailing
    // history — the branch that had to be normalised by hand, since nothing
    // else in the pipeline touches snapshot.burnRateUsd.
    const detail = [
      {
        walletAddress: "0xaaa",
        chain: "ethereum",
        tokens: [
          { symbol: "USDC", amount: 3_000_000, priceUsd: 1, valueUsd: 3_000_000 },
        ],
      },
    ];
    const custom = section("financial_health").userPromptFragment(
      contextWith({ burnRateUsd: "1920000", balancesDetail: detail }, null, {
        period: periodFromRange("2026-02-01", "2026-07-30"),
      })
    );
    // $3.0M ÷ $324,666.67/mo = 9.2 months. The naive division by the period
    // total would have said 1.6 — and called it months.
    expect(custom).toContain("): 9.2 months");
    expect(custom).not.toContain("): 1.6 months");
    // And the denominator names itself honestly, rather than "this month's burn".
    expect(custom).toContain(
      "this period's operating outflows normalised to a calendar month (no trailing history yet)"
    );
  });

  it("keeps the liquid runway denominator label untouched for a month", () => {
    const detail = [
      {
        walletAddress: "0xaaa",
        chain: "ethereum",
        tokens: [
          { symbol: "USDC", amount: 3_000_000, priceUsd: 1, valueUsd: 3_000_000 },
        ],
      },
    ];
    const monthly = section("financial_health").userPromptFragment(
      contextWith({ burnRateUsd: "320000", balancesDetail: detail })
    );
    expect(monthly).toContain(
      "- Runway (liquid reserves ÷ this month's burn (no trailing history yet)): 9.4 months"
    );
  });

  it("says the trailing average is per-month even when the period is not", () => {
    const trailing = [
      { burnRateUsd: "300000" },
      { burnRateUsd: "300000" },
    ] as unknown as TreasurySnapshot[];
    const custom = section("financial_health").userPromptFragment(
      contextWith({ burnRateUsd: "1920000" }, null, { period: NINETY, trailing })
    );
    expect(custom).toContain(
      "Each prior period is reduced to a calendar month before averaging"
    );
    const monthly = section("financial_health").userPromptFragment(
      contextWith({ burnRateUsd: "320000" }, null, { trailing })
    );
    expect(monthly).not.toContain("reduced to a calendar month");
  });

  it("no longer claims the stored runway figure is not in months", () => {
    // Phase 1 said "the figure is NOT in months at all" because it wasn't.
    // Phase 3 made it months, so that sentence would now be the false one.
    const fragment = section("financial_health").userPromptFragment(
      burnCtx(NINETY)
    );
    expect(fragment).not.toContain("NOT in months at all");
    expect(fragment).toContain("so it is genuinely in months");
  });

  it("gates the forecast off for a long custom period and keeps it for a month", () => {
    const trailing = [{}, {}] as unknown as TreasurySnapshot[];
    const forecast = section("next_period_forecast");
    expect(forecast.requires(contextWith({}, null, { trailing }))).toBe(true);
    expect(
      forecast.requires(contextWith({}, null, { trailing, period: NINETY }))
    ).toBe(false);
  });

  it("gates on 62 days exactly, and never on a calendar month's length", () => {
    const trailing = [{}, {}] as unknown as TreasurySnapshot[];
    const forecast = section("next_period_forecast");
    expect(AT_LIMIT.days).toBe(62);
    expect(
      forecast.requires(contextWith({}, null, { trailing, period: AT_LIMIT }))
    ).toBe(true);
    // 63 days is one day over.
    const over = periodFromRange("2026-05-30", "2026-07-31");
    expect(over.days).toBe(63);
    expect(
      forecast.requires(contextWith({}, null, { trailing, period: over }))
    ).toBe(false);
    // A 31-day January is a month, never gated — the branch keys on `kind`.
    expect(
      forecast.requires(
        contextWith({}, null, { trailing, period: periodOfMonth("2026-01") })
      )
    ).toBe(true);
  });

  it("withholds the forecast's RULES too, not just its figures", () => {
    // buildSystemPrompt selects rules by whether userPromptFragment is
    // non-empty, NOT by requires — so gating only `requires` would ship the
    // model instructions for a section it had no data for. Same split-path
    // failure the decisionLedger gate closed in Phase 1.
    const trailing = [
      { burnRateUsd: "300000", netFlowUsd: "-100000" },
      { burnRateUsd: "300000", netFlowUsd: "-100000" },
    ] as unknown as TreasurySnapshot[];
    const detail = [
      {
        walletAddress: "0xaaa",
        chain: "ethereum",
        tokens: [
          { symbol: "USDC", amount: 3_000_000, priceUsd: 1, valueUsd: 3_000_000 },
        ],
      },
    ];
    const enabled = resolveSections(null);
    const monthly = contextWith({ balancesDetail: detail }, null, { trailing });
    expect(buildSystemPrompt(enabled, monthly)).toContain(
      "### Next Period Projection (CONDITIONAL)"
    );
    const custom = contextWith({ balancesDetail: detail }, null, {
      trailing,
      period: NINETY,
    });
    expect(buildSystemPrompt(enabled, custom)).not.toContain(
      "### Next Period Projection (CONDITIONAL)"
    );
    expect(buildUserPrompt(custom, enabled)).not.toContain(
      "## Mechanical projection for the next period"
    );
  });

  it("gives the real reason on the readiness chip", () => {
    const trailing = [{}, {}] as unknown as TreasurySnapshot[];
    const reason = evaluateReadiness(
      contextWith({}, null, { trailing, period: NINETY })
    ).find((r) => r.id === "next_period_forecast")?.reason;
    expect(reason).toContain("90 days");
    expect(reason).toContain("Periods over 62 days are excluded");
    // "Add more snapshots" would send the founder to fix something that is
    // not broken — they have two.
    expect(reason).not.toContain("Needs at least two prior snapshots");
  });

  it("still blames the snapshot count when that is what is missing", () => {
    const reason = evaluateReadiness(
      contextWith({}, null, { trailing: [], period: NINETY })
    ).find((r) => r.id === "next_period_forecast")?.reason;
    // Both causes hold; the period one is the one the founder cannot fix by
    // syncing, so it is the one worth stating.
    expect(reason).toContain("Periods over 62 days are excluded");
  });
});

// ─── sectionIdsWithContent ──────────────────────────────────────────────────
//
// Pulled out of `buildUserPrompt`'s own inline filter so a second caller
// (`validateReportContent`'s post-hoc consistency checks in prompts.ts) can
// ask "did section X have real content this generation" without recomputing
// the filter and risking disagreement with what the user prompt actually
// contains. These tests pin the contract that filter must honor.

describe("sectionIdsWithContent", () => {
  it("includes lows_concerns when the evidence ledger has negatives", () => {
    const ctx = contextWith({}, null, {
      milestones: [
        {
          id: "m1",
          title: "Mainnet v2",
          status: "delayed",
          targetDate: "2026-03-01",
        },
      ] as never,
    });
    const ids = sectionIdsWithContent(ctx, resolveSections(null));
    expect(ids.has("lows_concerns")).toBe(true);
  });

  it("excludes lows_concerns when the evidence ledger is empty", () => {
    const ctx = contextWith({}, null, { total: 0, minSignificant: 0 });
    const ids = sectionIdsWithContent(ctx, resolveSections(null));
    expect(ids.has("lows_concerns")).toBe(false);
  });

  it("excludes key_takeaways when headline figures and evidence are both empty", () => {
    const ctx = contextWith({}, null, { total: 0, minSignificant: 0 });
    const ids = sectionIdsWithContent(ctx, resolveSections(null));
    expect(ids.has("key_takeaways")).toBe(false);
  });

  it("excludes a conditional section whose requires() is false even though it's in `enabled`", () => {
    // grant_fund_usage is in the library but requires an actual grant award
    // to have content — being toggled "enabled" is not the same as having
    // something to say.
    const ctx = contextWith({}, null, { grantAwards: [], grantTranches: [] });
    const enabled = SECTION_LIBRARY.map((s) => s.id).includes("grant_fund_usage")
      ? resolveSections([
          ...SECTION_LIBRARY.map((s) => ({ id: s.id, enabled: true })),
        ])
      : resolveSections(null);
    const ids = sectionIdsWithContent(ctx, enabled);
    expect(ids.has("grant_fund_usage")).toBe(false);
  });
});

// ─── the byte-identity contract ────────────────────────────────────────────
//
// The single most important test in this file for Phase 1. Every period-aware
// resolver is contractually required to return its static counterpart verbatim
// for a calendar month — that is what keeps already-published monthly reports,
// and the `llm_cache` key hashed from these prompts, unchanged. Asserted for
// the WHOLE library rather than per-section, so a resolver added later without
// a monthly branch fails here rather than in production.

describe("period-aware resolvers are byte-identical to their static form for a month", () => {
  const monthly = contextWith({});

  it("systemPromptFragmentFor matches systemPromptFragment for every section", () => {
    for (const s of SECTION_LIBRARY) {
      expect(
        resolveSystemRules(s, monthly),
        `${s.id} system rules drifted from the monthly text`
      ).toBe(s.systemPromptFragment);
    }
  });

  it("notReadyHintFor matches notReadyHint for every section", () => {
    for (const s of SECTION_LIBRARY) {
      if (!s.notReadyHintFor) continue;
      expect(
        s.notReadyHintFor(monthly),
        `${s.id} not-ready hint drifted from the monthly text`
      ).toBe(s.notReadyHint);
    }
  });

  it("covers a real set of resolvers, not an empty loop", () => {
    expect(
      SECTION_LIBRARY.filter((s) => s.systemPromptFragmentFor).length
    ).toBeGreaterThanOrEqual(6);
    expect(
      SECTION_LIBRARY.filter((s) => s.notReadyHintFor).length
    ).toBeGreaterThanOrEqual(2);
  });

  it("at least one resolver actually differs for a custom period", () => {
    // Guards the inverse failure: resolvers that are byte-identical for a
    // month because they ignore the period entirely would pass the two tests
    // above while doing nothing.
    const custom = contextWith({}, null, { period: GRANT_PERIOD });
    const differing = SECTION_LIBRARY.filter(
      (s) => resolveSystemRules(s, custom) !== s.systemPromptFragment
    );
    expect(differing.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── grant funding received ────────────────────────────────────────────────
//
// The two sections that turn `grant_awards` / `grant_tranches` into report
// content. Every test below exists because the corresponding mistake would
// produce a plausible-looking WRONG NUMBER in a document a funder makes a
// funding decision from — not a crash, not an empty section.
//
// The fixture is chosen so that every arithmetic mistake this section could
// make has its own distinct formatted string:
//
//   awarded                 $2,000,000  → "$2.0M"
//   received to date          $500,000  → "$500.0K"   (two tranches)
//   received in period        $250,000  → "$250.0K"   (one of them)
//   operating outflows        $300,000  → "$300.0K"
//   awarded − received      $1,500,000  → "$1.5M"     ← the ONE legal remainder
//   received − spent          $200,000  → "$200.0K"   ← FORBIDDEN
//   awarded − spent         $1,700,000  → "$1.7M"     ← FORBIDDEN

const AWARD_ID = "award-1";

function award(over: Record<string, unknown> = {}) {
  return {
    id: AWARD_ID,
    projectId: "p1",
    grantor: "Optimism Foundation",
    program: "RetroPGF Round 4",
    awardAmountUsd: "2000000",
    awardAmountToken: null,
    awardTokenSymbol: null,
    awardDate: "2026-01-15",
    reportingStartDate: null,
    status: "active",
    agreementUrl: null,
    notes: null,
    ...over,
  };
}

function tranche(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    grantAwardId: AWARD_ID,
    projectId: "p1",
    label: "Tranche 1",
    amountUsd: "250000",
    expectedDate: null,
    receivedDate: null,
    txHash: null,
    notes: null,
    ...over,
  };
}

/** The standard fixture: $500K received of a $2M award, $300K spent. */
function grantContext(
  extra: Partial<ReportSectionContext> = {},
  snapshotFields: Record<string, unknown> = {}
): ReportSectionContext {
  return contextWith(
    {
      expensesByCategory: { payroll: 300_000 },
      incomeByCategory: { grant_received: 250_000 },
      ...snapshotFields,
    },
    null,
    {
      grantAwards: [award()] as never,
      grantTranches: [
        // Received inside April 2026 — the cross-check's founder side.
        tranche({ id: "t1", receivedDate: "2026-04-10" }),
        // Received before the window opened. Counts toward "received to date"
        // and must NOT count toward the in-period cross-check.
        tranche({ id: "t2", receivedDate: "2026-01-20" }),
        tranche({ id: "t3", amountUsd: "1500000", expectedDate: "2026-09-01" }),
      ] as never,
      ...extra,
    }
  );
}

function grantFragment(ctx: ReportSectionContext): string {
  return section("grant_fund_usage").userPromptFragment(ctx);
}

/** Every finite number anywhere in a derived view, at any depth. */
function numbersIn(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(numbersIn);
  }
  return [];
}

describe("grant sections — library registration and defaults", () => {
  it("both ship OFF by default", () => {
    expect(section("grant_fund_usage").defaultEnabled).toBe(false);
    expect(section("grant_milestone_progress").defaultEnabled).toBe(false);
  });

  it("neither is spliced into an existing stored config", () => {
    // The byte-identity guarantee for every project already on the product:
    // `resolveSections` skips `!s.defaultEnabled` when back-filling library
    // sections a stored config never mentioned, so an investor project that
    // saved a template before this phase gets exactly the sections it had.
    const result = ids([{ id: "executive_summary", enabled: true }]);
    expect(result).not.toContain("grant_fund_usage");
    expect(result).not.toContain("grant_milestone_progress");
  });

  it("neither appears in the default (null-config) section list", () => {
    expect(DEFAULT_IDS).not.toContain("grant_fund_usage");
    expect(DEFAULT_IDS).not.toContain("grant_milestone_progress");
  });

  it("sits beside the section it mirrors, and titles name the direction", () => {
    // `grants_distributed` is money the project GAVE OUT. Adjacent placement
    // is the disambiguation: in the constructor the founder sees both, and
    // both titles say which way the money went.
    expect(LIBRARY_IDS[LIBRARY_IDS.indexOf("grants_distributed") + 1]).toBe(
      "grant_fund_usage"
    );
    expect(section("grants_distributed").title).toBe("Grants Distributed");
    expect(section("grant_fund_usage").title).toBe("Grant Funding Received");
  });
});

describe("grant sections — silent without data", () => {
  it("neither renders for a project with no grant award", () => {
    const ctx = contextWith({ expensesByCategory: { payroll: 300_000 } });
    for (const id of ["grant_fund_usage", "grant_milestone_progress"]) {
      expect(section(id).requires(ctx)).toBe(false);
      expect(section(id).userPromptFragment(ctx)).toBe("");
    }
  });

  it("keeps both out of a prompt built with the whole library enabled", () => {
    // The end-to-end version of the check above: a project with every section
    // switched on and no grant data must produce a prompt with no grant
    // heading and — because `buildSystemPrompt` selects rules by whether the
    // fragment is non-empty — no grant RULES either.
    const ctx = contextWith({ expensesByCategory: { payroll: 300_000 } });
    const enabled = [...SECTION_LIBRARY];
    const user = buildUserPrompt(ctx, enabled);
    const system = buildSystemPrompt(enabled, ctx);
    expect(user).not.toContain("Grant funding received");
    expect(user).not.toContain("Grant deliverable progress");
    expect(system).not.toContain("### Grant Funding Received");
    expect(system).not.toContain("### Grant Deliverable Progress");
  });

  it("an award granted after the period ends is not a fact about the period", () => {
    // April 2026 report, award signed in June. Reporting it would tell the
    // reader about money that had not been granted when the window closed.
    const ctx = grantContext({
      grantAwards: [award({ awardDate: "2026-06-01" })] as never,
    });
    expect(awardsForPeriod(ctx)).toHaveLength(0);
    expect(section("grant_fund_usage").requires(ctx)).toBe(false);
  });

  it("an award granted before the period still reports, whatever its status", () => {
    // Deliberate: the report a grantor most wants is the CLOSING one, and a
    // founder flips the award to `completed` exactly when that report is due.
    for (const status of ["active", "completed", "terminated"]) {
      const ctx = grantContext({
        grantAwards: [award({ status })] as never,
      });
      expect(section("grant_fund_usage").requires(ctx)).toBe(true);
      expect(grantFragment(ctx)).toContain(`status: ${status}`);
    }
  });
});

describe("grant_fund_usage — the figures it may and may not state", () => {
  it("states awarded, received to date, received this period and undisbursed", () => {
    const text = grantFragment(grantContext());
    expect(text).toContain("Awarded: $2.0M");
    expect(text).toContain("Received to date: $500.0K");
    expect(text).toContain("Received during this reporting period: $250.0K");
    expect(text).toContain("Not yet disbursed under the award");
    expect(text).toContain("$1.5M");
  });

  it("NEVER emits a remaining figure derived from spending", () => {
    // The single most important assertion in this file. `received − spent`
    // ($200K) and `award − spent` ($1.7M) are both arithmetic a model — or a
    // future contributor — would find natural, and both are fabrications: the
    // treasury is fungible and its opening balance is not recorded anywhere.
    const ctx = grantContext();
    const text = grantFragment(ctx);
    const rules = section("grant_fund_usage").systemPromptFragment;

    expect(text).not.toContain("$200.0K"); // received − spent
    expect(text).not.toContain("$1.7M"); // awarded − spent

    // And the same figures must not be reachable from the derived view under
    // any field name — a spend-derived remainder added later would show up
    // here before it ever reached a prompt. Compared as NUMBERS, not as
    // substrings: "2000000" contains "200000", and a substring check would
    // have failed on the legitimate award amount.
    expect(numbersIn(grantFundUsage(ctx))).not.toContain(200_000);
    expect(numbersIn(grantFundUsage(ctx))).not.toContain(1_700_000);

    // The prohibition is stated to the model in the same absolute register
    // the token-price ban uses, not merely omitted from the data.
    expect(rules).toContain("ABSOLUTE, NON-NEGOTIABLE");
    expect(rules.toLowerCase()).toContain("fungible");
  });

  it("the only remainder it carries is awarded − received, labelled as schedule", () => {
    const text = grantFragment(grantContext());
    expect(text).toContain(
      "Not yet disbursed under the award (awarded minus received to date): $1.5M"
    );
    expect(text).toContain("money the grantor has not sent yet");
    expect(text).toContain("NOT a treasury balance");
  });

  it("carries the coverage ratio with its fungibility clause attached", () => {
    const text = grantFragment(grantContext());
    // $300K spent ÷ $500K received to date.
    expect(text).toContain("60%");
    expect(text).toContain(
      "the treasury is fungible; this ratio does not assert that grant funds specifically paid these costs"
    );
  });

  it("declines the coverage ratio rather than dividing by zero", () => {
    const ctx = grantContext({
      grantTranches: [tranche({ id: "t3", receivedDate: null })] as never,
    });
    const text = grantFragment(ctx);
    expect(grantFundUsage(ctx).coverageRatio).toBeNull();
    expect(text).toContain("Coverage ratio: not computable");
    expect(text).toContain("Do not present the outflows as grant spending");
  });

  it("lists operating outflows excluding treasury rebalancing", () => {
    const ctx = grantContext(
      {},
      { expensesByCategory: { payroll: 300_000, token_sale: 900_000 } }
    );
    const text = grantFragment(ctx);
    expect(text).toContain("payroll: $300.0K");
    expect(text).not.toContain("token_sale");
    expect(grantFundUsage(ctx).operatingOutflowsUsd).toBe(300_000);
  });

  it("flags a tranche schedule that does not add up to the award", () => {
    const ctx = grantContext({
      grantTranches: [tranche({ id: "t1", receivedDate: "2026-04-10" })] as never,
    });
    expect(grantFundUsage(ctx).awards[0].scheduleIncomplete).toBe(true);
    expect(grantFragment(ctx)).toContain("SCHEDULE NOTE");
  });

  it("refuses a negative undisbursed figure when receipts exceed the award", () => {
    const ctx = grantContext({
      grantAwards: [award({ awardAmountUsd: "100000" })] as never,
    });
    const text = grantFragment(ctx);
    expect(text).toContain("EXCEED the recorded award");
    expect(text).toContain("data-entry inconsistency");
    expect(text).not.toContain("-$400.0K");
  });
});

describe("grant_fund_usage — a token-denominated award", () => {
  const tokenAward = () =>
    award({
      awardAmountUsd: null,
      awardAmountToken: "30000000",
      awardTokenSymbol: "OP",
    });

  it("quotes the token figure and emits no dollar award amount", () => {
    const ctx = grantContext({ grantAwards: [tokenAward()] as never });
    const text = grantFragment(ctx);
    expect(text).toContain("Awarded: 30,000,000 OP");
    expect(text).toContain("THE AGREEMENT STATES NO USD AMOUNT");
    // Not "$0" either — a null award amount is an unstated one, and printing
    // zero would tell the grantor their award was worthless.
    expect(text).not.toContain("Awarded: $");
  });

  it("declines the undisbursed figure rather than mixing tokens with dollars", () => {
    const ctx = grantContext({ grantAwards: [tokenAward()] as never });
    expect(grantFundUsage(ctx).awards[0].undisbursedUsd).toBeNull();
    expect(grantFragment(ctx)).toContain("Not yet disbursed: NOT COMPUTABLE");
    expect(grantFragment(ctx)).toContain("do NOT derive one from spending");
  });

  it("still reports what actually arrived, which is measured in dollars", () => {
    // The tranches are USD regardless of how the award is denominated, so the
    // receipt figures survive — losing them would leave the section empty for
    // exactly the grants most likely to need it.
    const ctx = grantContext({ grantAwards: [tokenAward()] as never });
    expect(grantFragment(ctx)).toContain("Received to date: $500.0K");
  });

  it("names a token amount whose symbol was never recorded", () => {
    const ctx = grantContext({
      grantAwards: [
        award({
          awardAmountUsd: null,
          awardAmountToken: "30000000",
          awardTokenSymbol: null,
        }),
      ] as never,
    });
    expect(grantFragment(ctx)).toContain("symbol not recorded");
  });

  it("says the award size is unrecorded when neither amount exists", () => {
    const ctx = grantContext({
      grantAwards: [
        award({ awardAmountUsd: null, awardAmountToken: null }),
      ] as never,
    });
    const text = grantFragment(ctx);
    expect(text).toContain("carries no amount, in dollars or tokens");
    expect(text).toContain("rather than inferring one from the tranche schedule");
  });
});

describe("grant_fund_usage — the on-chain cross-check", () => {
  it("CONSISTENT when the classified inflow matches the period's tranches", () => {
    const ctx = grantContext();
    expect(grantFundUsage(ctx).reconciliation.verdict).toBe("consistent");
    expect(grantFragment(ctx)).toContain(
      "classified on-chain grant inflows: CONSISTENT"
    );
  });

  it("DIVERGING when they disagree by more than the tolerance", () => {
    const ctx = grantContext({}, { incomeByCategory: { grant_received: 50_000 } });
    const rec = grantFundUsage(ctx).reconciliation;
    expect(rec.verdict).toBe("diverging");
    expect(rec.divergencePct).toBeCloseTo(0.8, 5);
    const text = grantFragment(ctx);
    expect(text).toContain("classified on-chain grant inflows: DIVERGING");
    expect(text).toContain("80% apart");
  });

  it("UNAVAILABLE when the period carries no classified income at all", () => {
    // Absent is not zero. Coercing an unclassified period to $0 would score
    // it as a 100% divergence and tell a grantor their tranche never arrived.
    const ctx = grantContext({}, { incomeByCategory: null });
    expect(grantFundUsage(ctx).reconciliation.chainUsd).toBeNull();
    expect(grantFundUsage(ctx).reconciliation.verdict).toBe("unavailable");
    expect(grantFragment(ctx)).toContain(
      "classified on-chain grant inflows: UNAVAILABLE"
    );
    expect(grantFragment(ctx)).toContain("founder-entered and UNCONFIRMED");
  });

  it("UNAVAILABLE when both sides are too small to compare", () => {
    const ctx = grantContext(
      { grantTranches: [tranche({ id: "t3", receivedDate: null })] as never },
      { incomeByCategory: { grant_received: 0 } }
    );
    expect(grantFundUsage(ctx).reconciliation.verdict).toBe("unavailable");
  });

  it("compares the IN-PERIOD tranches, never the cumulative receipts", () => {
    // The trap this closes: "received to date" is cumulative by definition,
    // while `incomeByCategory` covers this period alone. Comparing the two
    // would report DIVERGING for every award whose tranches predate the
    // window — a false alarm that gets louder the longer a grant runs. Here
    // the cumulative figure is $500K and the chain figure $250K; if the
    // cumulative side were used this would read DIVERGING.
    const usage = grantFundUsage(grantContext());
    expect(usage.receivedToDateUsd).toBe(500_000);
    expect(usage.reconciliation.trancheUsd).toBe(250_000);
    expect(usage.reconciliation.verdict).toBe("consistent");
  });
});

describe("grant_fund_usage — the custom-period disclosure", () => {
  const DISCLOSURE = "PERIOD DISCLOSURE";

  it("appears for a custom period, naming both boundary dates", () => {
    const ctx = grantContext({ period: GRANT_PERIOD });
    const text = grantFragment(ctx);
    expect(text).toContain(DISCLOSURE);
    expect(text).toContain(`balances are as of ${GRANT_PERIOD.end}`);
    expect(text).toContain(`${GRANT_PERIOD.days}-day period`);
    expect(text).toContain(
      `The opening balance at ${GRANT_PERIOD.start} is NOT recorded`
    );
  });

  it("does NOT appear for a calendar month", () => {
    // A monthly snapshot and its period were built for each other, so the
    // ambiguity the disclosure exists to name does not arise.
    expect(grantFragment(grantContext())).not.toContain(DISCLOSURE);
  });

  it("appears for a month-aligned custom period too", () => {
    // Unlike `monthGranularityNote`, alignment is irrelevant here: the missing
    // opening balance is a property of how balances are READ (live, as of the
    // end date), not of how manual rows are tagged.
    const ctx = grantContext({ period: QUARTER_PERIOD });
    expect(grantFragment(ctx)).toContain(DISCLOSURE);
  });
});

// ─── grant deliverables ────────────────────────────────────────────────────

function milestone(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    projectId: "p1",
    title: "Ship the SDK",
    description: null,
    status: "completed",
    targetDate: "2026-04-01",
    completedDate: "2026-04-15",
    grantAwardId: AWARD_ID,
    ...over,
  };
}

function deliverableFragment(ctx: ReportSectionContext): string {
  return section("grant_milestone_progress").userPromptFragment(ctx);
}

describe("grant_milestone_progress", () => {
  it("stays silent when no milestone is attached to an award", () => {
    const ctx = grantContext({
      milestones: [milestone({ grantAwardId: null })] as never,
    });
    expect(section("grant_milestone_progress").requires(ctx)).toBe(false);
    expect(deliverableFragment(ctx)).toBe("");
  });

  it("groups deliverables under the award that commissioned them", () => {
    const ctx = grantContext({ milestones: [milestone()] as never });
    const text = deliverableFragment(ctx);
    expect(text).toContain(
      "Deliverables committed under Optimism Foundation — RetroPGF Round 4"
    );
    expect(text).toContain("Ship the SDK");
  });

  it("lists deliverables that have NOT shipped — the whole point", () => {
    // A period filter would drop these entirely: an unfinished deliverable has
    // no completedDate to match on. Dropping them turns a commitment list into
    // a highlights reel, in a document written for the party bearing the risk.
    const ctx = grantContext({
      milestones: [
        milestone({ id: "m2", status: "in_progress", completedDate: null }),
      ] as never,
    });
    expect(section("grant_milestone_progress").requires(ctx)).toBe(true);
    expect(deliverableFragment(ctx)).toContain("not completed");
  });

  it("keeps a deliverable completed BEFORE the period, and labels it as such", () => {
    const ctx = grantContext({
      milestones: [
        milestone({ targetDate: "2026-01-10", completedDate: "2026-01-20" }),
      ] as never,
    });
    const text = deliverableFragment(ctx);
    expect(text).toContain("before this reporting period");
    expect(text).not.toContain("inside this reporting period");
  });

  it("labels a deliverable completed inside the period", () => {
    expect(
      deliverableFragment(grantContext({ milestones: [milestone()] as never }))
    ).toContain("inside this reporting period");
  });

  it("states slippage with its DIRECTION, never a bare day count", () => {
    // "14 days" alone reads as late. A deliverable that shipped two weeks
    // early being reported as slipping is a false statement about the team.
    const late = grantContext({ milestones: [milestone()] as never });
    expect(deliverableFragment(late)).toContain("14 days late against target");

    const early = grantContext({
      milestones: [
        milestone({ targetDate: "2026-04-20", completedDate: "2026-04-06" }),
      ] as never,
    });
    expect(deliverableFragment(early)).toContain("14 days early against target");

    const onTime = grantContext({
      milestones: [
        milestone({ targetDate: "2026-04-15", completedDate: "2026-04-15" }),
      ] as never,
    });
    expect(deliverableFragment(onTime)).toContain("delivered exactly on target");
  });

  it("measures an open deliverable's slippage against the period end", () => {
    const ctx = grantContext({
      milestones: [
        milestone({
          status: "delayed",
          targetDate: "2026-04-01",
          completedDate: null,
        }),
      ] as never,
    });
    const view = grantDeliverables(ctx)[0].deliverables[0];
    expect(view.overdue).toBe(true);
    expect(view.slippageDays).toBe(29); // 2026-04-01 → 2026-04-30
    expect(deliverableFragment(ctx)).toContain(
      "29 days past target and still open"
    );
  });

  it("emits no slippage figure for a deliverable with no target date", () => {
    const ctx = grantContext({
      milestones: [milestone({ targetDate: null })] as never,
    });
    expect(grantDeliverables(ctx)[0].deliverables[0].slippageDays).toBeNull();
    expect(deliverableFragment(ctx)).toContain("no target date");
  });

  it("ignores a milestone pointing at an award outside the period", () => {
    // Both sections read one award set, so they cannot disagree about which
    // awards exist.
    const ctx = grantContext({
      grantAwards: [award({ awardDate: "2026-06-01" })] as never,
      milestones: [milestone()] as never,
    });
    expect(grantDeliverables(ctx)).toHaveLength(0);
  });

  it("looking_ahead excludes a grant-owned active milestone the same way milestones_completed does", () => {
    const active = milestone({
      id: "m-active",
      status: "in_progress",
      completedDate: null,
    }); // default fixture already sets grantAwardId: AWARD_ID
    const ctx = grantContext({ milestones: [active] as never });
    expect(section("looking_ahead").requires(ctx)).toBe(false);

    const nonGrantActive = milestone({
      id: "m-active-2",
      status: "in_progress",
      completedDate: null,
      grantAwardId: null,
    });
    const ctxNoGrant = grantContext({
      milestones: [nonGrantActive] as never,
    });
    expect(section("looking_ahead").requires(ctxNoGrant)).toBe(true);
  });

  it("is filtered OUT of milestones_completed once it belongs to a grant award — grant-owned milestones surface only via grant_milestone_progress", () => {
    // `milestone()`'s default fixture sets grantAwardId: AWARD_ID. This used
    // to assert the opposite (both sections satisfied at once) as correct —
    // a confirmed production bug: a grant-owned milestone leaked into a
    // plain investor report's Wins/Milestones Completed even with every
    // grant section toggled off.
    const ctx = grantContext({ milestones: [milestone()] as never });
    expect(section("milestones_completed").requires(ctx)).toBe(false);
    expect(section("grant_milestone_progress").requires(ctx)).toBe(true);
  });

  it("a milestone with no grant award still satisfies milestones_completed, not grant_milestone_progress", () => {
    const ctx = grantContext({
      milestones: [milestone({ grantAwardId: null })] as never,
    });
    expect(section("milestones_completed").requires(ctx)).toBe(true);
    expect(section("grant_milestone_progress").requires(ctx)).toBe(false);
  });
});

// ─── balance basis: gate AND caption from one predicate (P3.1) ─────────────
//
// The Part I invariant this suite exists to lock: `buildSystemPrompt` selects a
// section's RULES by whether its `userPromptFragment` is non-empty, NOT by
// `requires`. Gating one without the other ships instructions with no data
// behind them. Three sections read `comparisonBasis`; all three are asserted on
// both halves.

describe("comparisonBasis — provenance of the balances being compared", () => {
  const BASIS_SECTIONS = [
    "previous_month_comparison",
    "anomalies",
    "next_period_forecast",
  ] as const;

  const anomaly = {
    metric: "Burn rate",
    current: 320000,
    baseline: 200000,
    changePct: 60,
    severity: "minor" as const,
    newCategory: false,
  };

  function balances(amount: number) {
    return [
      {
        walletAddress: "0xaaa",
        chain: "ethereum",
        tokens: [
          {
            symbol: "USDC",
            amount,
            priceUsd: 1,
            valueUsd: amount,
            contractAddress: null,
          },
        ],
      },
    ];
  }

  function basisCtx(
    currentFields: Record<string, unknown> = {},
    prevFields: Record<string, unknown> = {}
  ): ReportSectionContext {
    const prev = snapshotWith({
      id: "s0",
      snapshotDate: "2026-03-31",
      totalBalanceUsd: "1000000",
      netFlowUsd: "-50000",
      burnRateUsd: "200000",
      balancesDetail: balances(1_000_000),
      ...prevFields,
    });
    const older = snapshotWith({
      id: "s-1",
      snapshotDate: "2026-02-28",
      netFlowUsd: "-40000",
      burnRateUsd: "180000",
      balancesDetail: balances(950_000),
    });
    return contextWith(
      {
        totalBalanceUsd: "1200000",
        netFlowUsd: "200000",
        burnRateUsd: "320000",
        balancesDetail: balances(1_200_000),
        ...currentFields,
      },
      prev,
      { trailing: [prev, older], anomalies: [anomaly] }
    );
  }

  it("adds nothing at all when both sides are observed — byte-identity", () => {
    const ctx = basisCtx();
    for (const id of BASIS_SECTIONS) {
      const fragment = section(id).userPromptFragment(ctx);
      expect(fragment).not.toContain("BALANCE BASIS");
      expect(section(id).requires(ctx)).toBe(true);
    }
  });

  it("treats a NULL balance_basis as observed — every row in the database today", () => {
    const ctx = basisCtx();
    expect(ctx.snapshot.balanceBasis).toBeUndefined();
    expect(
      section("previous_month_comparison").userPromptFragment(ctx)
    ).not.toContain("BALANCE BASIS");
  });

  it("captions all three sections when a side was reconstructed", () => {
    const ctx = basisCtx({}, { balanceBasis: "reconstructed" });
    for (const id of BASIS_SECTIONS) {
      const fragment = section(id).userPromptFragment(ctx);
      expect(fragment).toContain("BALANCE BASIS — RECONSTRUCTED");
      // And the rules still travel, because the fragment is non-empty.
      expect(fragment.trim().length).toBeGreaterThan(0);
      expect(section(id).requires(ctx)).toBe(true);
    }
  });

  it("names the reconstruction as a reason not to call a change an achievement", () => {
    const ctx = basisCtx({}, { balanceBasis: "reconstructed" });
    const fragment = section("previous_month_comparison").userPromptFragment(ctx);
    expect(fragment).toMatch(/do NOT present a change .* as an achievement/i);
    expect(fragment).toContain("floor");
  });

  it("says the period's FLOW figures are still measured, not reconstructed", () => {
    // Otherwise the caption suppresses real findings: burn, inflows and the
    // category breakdowns are computed over the period by the sync itself.
    const ctx = basisCtx({ balanceBasis: "reconstructed" });
    expect(section("anomalies").userPromptFragment(ctx)).toContain(
      "are measured, not reconstructed"
    );
  });

  it("fires on a reconstructed TRAILING snapshot even when both compared rows are observed", () => {
    const prev = snapshotWith({
      id: "s0",
      snapshotDate: "2026-03-31",
      totalBalanceUsd: "1000000",
      burnRateUsd: "200000",
      netFlowUsd: "-50000",
      balancesDetail: balances(1_000_000),
    });
    const older = snapshotWith({
      id: "s-1",
      snapshotDate: "2026-02-28",
      balanceBasis: "reconstructed",
      burnRateUsd: "180000",
      netFlowUsd: "-40000",
      balancesDetail: balances(950_000),
    });
    const ctx = contextWith(
      {
        totalBalanceUsd: "1200000",
        netFlowUsd: "200000",
        burnRateUsd: "320000",
        balancesDetail: balances(1_200_000),
      },
      prev,
      { trailing: [prev, older], anomalies: [anomaly] }
    );
    expect(
      section("previous_month_comparison").userPromptFragment(ctx)
    ).toContain("BALANCE BASIS");
  });

  it("GATES all three off when too much of the treasury has no price at its own date", () => {
    const ctx = basisCtx(
      {},
      {
        balanceBasis: "reconstructed",
        reconstructionMeta: { unpricedShareOfTotal: 0.45 },
      }
    );
    for (const id of BASIS_SECTIONS) {
      expect(section(id).requires(ctx)).toBe(false);
      // Both halves, from one predicate — the invariant this suite locks.
      expect(section(id).userPromptFragment(ctx)).toBe("");
      const hint = section(id).notReadyHintFor?.(ctx) ?? "";
      expect(hint).toContain("could not be priced");
    }
  });

  it("still allows the comparison just under the ceiling", () => {
    const ctx = basisCtx(
      {},
      {
        balanceBasis: "reconstructed",
        reconstructionMeta: { unpricedShareOfTotal: 0.05 },
      }
    );
    for (const id of BASIS_SECTIONS) {
      expect(section(id).requires(ctx)).toBe(true);
    }
  });

  it("ships no rules for a gated section — the whole point of gating both", () => {
    const ctx = basisCtx(
      {},
      {
        balanceBasis: "reconstructed",
        reconstructionMeta: { unpricedShareOfTotal: 0.45 },
      }
    );
    const system = buildSystemPrompt(
      BASIS_SECTIONS.map((id) => section(id)),
      ctx
    );
    expect(system).not.toContain("### Month-over-Month");
    expect(system).not.toContain("### Anomalies");
    expect(system).not.toContain("### Next Period Projection");
  });

  it("treats an unrecognised basis string as reconstructed, not as observed", () => {
    const ctx = basisCtx({}, { balanceBasis: "who knows" });
    expect(
      section("previous_month_comparison").userPromptFragment(ctx)
    ).toContain("BALANCE BASIS");
  });
});

// ─── the grant-report blocks ───────────────────────────────────────────────
//
// Leftover Grant Funds, Deviation from the Plan, Live Dashboard, and the
// Source of Truth field threaded through three existing sections.
//
// The single most consequential thing under test is the SCOPE BOUNDARY. There
// are two subtractions that both look like "money in minus money out":
//
//   TREASURY SCOPE — `received − spent` — BANNED, and still banned. The
//   treasury is fungible and its opening balance is recorded nowhere.
//   GRANT SCOPE — `received − utilized` — legal, and what these tests cover:
//   both terms are sums over ONE award's tranche rows, and the second term is
//   a founder's hand-entered assertion about that grant's money.
//
// A regression that merged the two would not crash. It would print a
// confident, wrong figure in the document a funder decides from.

function leftoverCtx(
  tranches: Record<string, unknown>[],
  awardOver: Record<string, unknown> = {}
): ReportSectionContext {
  return contextWith({ expensesByCategory: { payroll: 300_000 } }, null, {
    grantAwards: [award(awardOver)] as never,
    grantTranches: tranches as never,
  });
}

/** $100K received. Utilisation is added per test. */
const RECEIVED_100K = {
  id: "t1",
  amountUsd: "100000",
  receivedDate: "2026-02-03",
};

describe("leftover funds — the derived view", () => {
  it("computes received minus utilized at grant scope", () => {
    const [row] = grantLeftoverFunds(
      leftoverCtx([tranche({ ...RECEIVED_100K, utilizedUsd: "40000" })])
    );
    expect(row.receivedToDateUsd).toBe(100_000);
    expect(row.utilizedToDateUsd).toBe(40_000);
    expect(row.leftoverUsd).toBe(60_000);
    expect(row.warnings).toEqual([]);
  });

  it("never derives the figure from treasury spend", () => {
    // The fixture spends $300K of payroll. If any of that leaked into the
    // utilisation term the leftover would be -$200K rather than $60K — the
    // banned treasury-scope subtraction wearing this section's label.
    const [row] = grantLeftoverFunds(
      leftoverCtx([tranche({ ...RECEIVED_100K, utilizedUsd: "40000" })])
    );
    expect(row.leftoverUsd).toBe(60_000);
    expect(row.leftoverUsd).not.toBe(-200_000);
  });

  it("treats unrecorded utilisation as null, never as zero", () => {
    // Zero would make the leftover the entire receipt — a confident claim that
    // an award nobody has reported on is completely unspent.
    const [row] = grantLeftoverFunds(leftoverCtx([tranche(RECEIVED_100K)]));
    expect(row.utilizedToDateUsd).toBeNull();
    expect(row.leftoverUsd).toBeNull();
  });

  it("counts a zero utilisation as recorded, because zero is an answer", () => {
    const [row] = grantLeftoverFunds(
      leftoverCtx([tranche({ ...RECEIVED_100K, utilizedUsd: "0" })])
    );
    expect(row.utilizedToDateUsd).toBe(0);
    expect(row.leftoverUsd).toBe(100_000);
  });

  it("reports a negative leftover rather than clamping or throwing", () => {
    // The 81,000-against-75,000 case from the research corpus: a real report a
    // grant program accepted. Clamping to zero would delete the only fact here.
    const [row] = grantLeftoverFunds(
      leftoverCtx([
        tranche({
          id: "t1",
          amountUsd: "75000",
          receivedDate: "2026-02-03",
          utilizedUsd: "81000",
        }),
      ])
    );
    expect(row.leftoverUsd).toBe(-6_000);
    expect(row.warnings.join(" ")).toContain("EXCEEDS recorded receipts");
    expect(row.warnings.join(" ")).toContain("$6.0K");
  });

  it("flags partial utilisation so the leftover reads as an upper bound", () => {
    const [row] = grantLeftoverFunds(
      leftoverCtx([
        tranche({ ...RECEIVED_100K, utilizedUsd: "40000" }),
        tranche({ id: "t2", amountUsd: "150000", receivedDate: "2026-03-04" }),
      ])
    );
    expect(row.utilizationRecordedCount).toBe(1);
    expect(row.receivedTrancheCount).toBe(2);
    expect(row.warnings.join(" ")).toContain("UPPER BOUND");
  });

  it("flags utilisation booked against a tranche that has not arrived", () => {
    const [row] = grantLeftoverFunds(
      leftoverCtx([
        tranche({ id: "t1", amountUsd: "100000", utilizedUsd: "40000" }),
      ])
    );
    expect(row.warnings.join(" ")).toContain("NOT recorded as received");
  });

  it("carries the founder's plan, and null when none was stated", () => {
    const withPlan = grantLeftoverFunds(
      leftoverCtx([tranche(RECEIVED_100K)], {
        leftoverFundsPlan: "Rolls into the Q3 audit.",
      })
    );
    expect(withPlan[0].plan).toBe("Rolls into the Q3 audit.");
    expect(
      grantLeftoverFunds(leftoverCtx([tranche(RECEIVED_100K)]))[0].plan
    ).toBeNull();
  });
});

describe("leftover funds — the section", () => {
  it("ships off by default, so no stored config changes", () => {
    expect(section("leftover_funds").defaultEnabled).toBe(false);
    expect(resolveSections(null).map((s) => s.id)).not.toContain(
      "leftover_funds"
    );
  });

  it("gates off when neither a figure nor a plan exists", () => {
    const ctx = leftoverCtx([tranche(RECEIVED_100K)]);
    expect(section("leftover_funds").requires(ctx)).toBe(false);
    expect(section("leftover_funds").userPromptFragment(ctx)).toBe("");
  });

  it("opens on a plan alone, with the figure declared not computable", () => {
    const ctx = leftoverCtx([tranche(RECEIVED_100K)], {
      leftoverFundsPlan: "Returned to the grantor.",
    });
    expect(section("leftover_funds").requires(ctx)).toBe(true);
    const fragment = section("leftover_funds").userPromptFragment(ctx);
    expect(fragment).toContain("NOT COMPUTABLE");
    expect(fragment).toContain("Returned to the grantor.");
  });

  it("opens on a figure alone, and refuses to invent the plan", () => {
    const ctx = leftoverCtx([
      tranche({ ...RECEIVED_100K, utilizedUsd: "40000" }),
    ]);
    const fragment = section("leftover_funds").userPromptFragment(ctx);
    expect(fragment).toContain("$60.0K");
    expect(fragment).toContain("NOT STATED");
    expect(fragment).toContain("Do NOT propose one");
  });

  it("ships no rules when the fragment is empty", () => {
    // buildSystemPrompt selects a rule by whether the FRAGMENT is non-empty,
    // not by `requires`. Gating only `requires` leaks the rules for a section
    // that has no data — the bug that has bitten this file twice.
    const ctx = leftoverCtx([tranche(RECEIVED_100K)]);
    expect(buildSystemPrompt([section("leftover_funds")], ctx)).not.toContain(
      "### Leftover Grant Funds"
    );
  });
});

describe("the grant-scope boundary holds", () => {
  it("keeps every leftover figure out of Grant Funding Received", () => {
    const ctx = leftoverCtx(
      [tranche({ ...RECEIVED_100K, utilizedUsd: "40000" })],
      { leftoverFundsPlan: "Returned." }
    );
    const usage = section("grant_fund_usage").userPromptFragment(ctx);
    expect(usage).toContain("NEVER subtract spending from an award");
    expect(usage).not.toContain("Leftover");
    expect(usage).not.toContain("utilised");
    expect(usage).not.toContain("$60.0K");
  });

  it("keeps the leftover field off the view that section renders", () => {
    // Structural, not textual: `grant_fund_usage` reads GrantAwardView, and
    // that view carries no leftover-shaped key for a future edit to reach for.
    const ctx = leftoverCtx([
      tranche({ ...RECEIVED_100K, utilizedUsd: "40000" }),
    ]);
    const [view] = grantFundUsage(ctx).awards;
    expect(Object.keys(view)).not.toContain("leftoverUsd");
    expect(Object.keys(view)).not.toContain("utilizedToDateUsd");
  });
});

describe("plan deviation", () => {
  it("ships off by default", () => {
    expect(section("plan_deviation").defaultEnabled).toBe(false);
  });

  it("states an explicit no-change sentence when nothing was recorded", () => {
    // The mechanic worth copying. A blank optional box lets a material change
    // go unreported by simply not being typed, and an empty box is
    // indistinguishable from an unchanged plan to the reader.
    const ctx = leftoverCtx([tranche(RECEIVED_100K)]);
    const [row] = grantPlanDeviations(ctx);
    expect(row.statement).toBe(NO_PLAN_DEVIATION);
    expect(row.affirmed).toBe(false);
    expect(section("plan_deviation").requires(ctx)).toBe(true);
    expect(section("plan_deviation").userPromptFragment(ctx)).toContain(
      "No changes to the original plan."
    );
  });

  it("uses the founder's own words once stated, unhedged", () => {
    const ctx = leftoverCtx([tranche(RECEIVED_100K)], {
      planDeviation: "Swapped the second audit vendor.",
    });
    const [row] = grantPlanDeviations(ctx);
    expect(row.statement).toBe("Swapped the second audit vendor.");
    expect(row.affirmed).toBe(true);
    expect(section("plan_deviation").userPromptFragment(ctx)).not.toContain(
      "standing statement"
    );
  });

  it("treats a whitespace-only entry as unstated", () => {
    const ctx = leftoverCtx([tranche(RECEIVED_100K)], { planDeviation: "   " });
    expect(grantPlanDeviations(ctx)[0].statement).toBe(NO_PLAN_DEVIATION);
  });

  it("goes fully silent with no award at all, rule included", () => {
    const ctx = contextWith({});
    expect(section("plan_deviation").requires(ctx)).toBe(false);
    expect(buildSystemPrompt([section("plan_deviation")], ctx)).not.toContain(
      "### Deviation from the Plan"
    );
  });
});

describe("external dashboard", () => {
  it("ships off by default", () => {
    expect(section("external_dashboard").defaultEnabled).toBe(false);
  });

  it("stays silent without a URL", () => {
    const ctx = contextWith({});
    expect(section("external_dashboard").requires(ctx)).toBe(false);
    expect(section("external_dashboard").userPromptFragment(ctx)).toBe("");
  });

  it("treats a whitespace-only URL as absent", () => {
    const ctx = contextWith({}, null, {
      project: { name: "Test Protocol", externalDashboardUrl: "   " },
    } as unknown as Partial<ReportSectionContext>);
    expect(section("external_dashboard").requires(ctx)).toBe(false);
  });

  it("renders the URL verbatim and names it the source of truth", () => {
    const ctx = contextWith({}, null, {
      project: {
        name: "Test Protocol",
        externalDashboardUrl: "https://dune.com/example/treasury",
      },
    } as unknown as Partial<ReportSectionContext>);
    const fragment = section("external_dashboard").userPromptFragment(ctx);
    expect(fragment).toContain("https://dune.com/example/treasury");
    expect(fragment).toContain("the dashboard is the source of truth");
    expect(section("external_dashboard").systemPromptFragment).toContain(
      "Do not describe, summarise or characterise what the dashboard shows"
    );
  });
});

describe("source of truth", () => {
  it("is a field, not a section", () => {
    expect(LIBRARY_IDS).not.toContain("source_of_truth");
  });

  it("adds nothing to an item that has none", () => {
    // What keeps every existing prompt byte-identical, and therefore every
    // cached report valid: the field only ever appends.
    const ctx = leftoverCtx([tranche(RECEIVED_100K)]);
    expect(section("grant_fund_usage").userPromptFragment(ctx)).not.toContain(
      "Source of Truth"
    );
  });

  it("prefers sourceOfTruth over the older, narrower txHash", () => {
    const ctx = leftoverCtx([
      tranche({
        ...RECEIVED_100K,
        txHash: "0xold",
        sourceOfTruth: "https://etherscan.io/tx/0xnew",
      }),
    ]);
    const fragment = section("grant_fund_usage").userPromptFragment(ctx);
    expect(fragment).toContain("Source of Truth: https://etherscan.io/tx/0xnew");
    expect(fragment).not.toContain("0xold");
  });

  it("falls back to txHash so evidence recorded earlier is not lost", () => {
    const ctx = leftoverCtx([tranche({ ...RECEIVED_100K, txHash: "0xold" })]);
    expect(section("grant_fund_usage").userPromptFragment(ctx)).toContain(
      "Source of Truth: 0xold"
    );
  });

  it("carries a deliverable's pointer through grantDeliverables", () => {
    const ctx = contextWith({}, null, {
      grantAwards: [award()] as never,
      grantTranches: [],
      milestones: [
        {
          id: "gm1",
          projectId: "p1",
          title: "Audit published",
          status: "completed",
          targetDate: "2026-03-01",
          completedDate: "2026-03-20",
          grantAwardId: AWARD_ID,
          sourceOfTruth: "https://github.com/org/repo/pull/12",
        },
      ] as never,
    });
    expect(grantDeliverables(ctx)[0].deliverables[0].sourceOfTruth).toBe(
      "https://github.com/org/repo/pull/12"
    );
    expect(
      section("grant_milestone_progress").userPromptFragment(ctx)
    ).toContain("Source of Truth: https://github.com/org/repo/pull/12");
  });

  it("carries an outbound allocation's pointer into Grants Distributed", () => {
    const ctx = contextWith({}, null, {
      grants: [
        {
          id: "g1",
          projectId: "p1",
          recipient: "Acme Research",
          amountUsd: "50000",
          status: "committed",
          category: null,
          period: "2026-04",
          notes: null,
          sourceOfTruth: "0xallocation",
        },
      ] as never,
    });
    expect(section("grants_distributed").userPromptFragment(ctx)).toContain(
      "Acme Research: $50.0K (committed) — Source of Truth: 0xallocation"
    );
  });
});

// ─── unclassified outflows on the financial-health block ───────────────────
//
// A production report printed "Monthly burn rate: $729.1K" and a 0.6-month
// runway as measured facts. Both were built from outflows that were 99.8%
// unclassified — a $567,447.64 token sale among them, which burn is supposed
// to exclude. The figures are not adjusted (that would invent a number); they
// are qualified.

describe("financial_health — unclassified-outflow caveat", () => {
  function ctxWithUnclassified(unclassified: number, outflows: number) {
    return contextWith({
      burnRateUsd: String(outflows),
      totalOutflowsUsd: String(outflows),
      expensesByCategory: { other: 0, unclassified },
    });
  }

  it("qualifies burn and runway when a material share went unclassified", () => {
    const fragment = section("financial_health").userPromptFragment(
      ctxWithUnclassified(727_498, 729_058)
    );
    expect(fragment).toContain("FIGURES ABOVE ARE UNRELIABLE");
    expect(fragment).toMatch(/UPPER BOUND/);
    expect(fragment).toMatch(/LOWER BOUND/);
  });

  it("names the amount and the share so the reader can judge the size of the gap", () => {
    const fragment = section("financial_health").userPromptFragment(
      ctxWithUnclassified(727_498, 729_058)
    );
    expect(fragment).toContain("$727.5K");
    expect(fragment).toContain("100%");
  });

  it("says nothing when the share is immaterial", () => {
    const fragment = section("financial_health").userPromptFragment(
      ctxWithUnclassified(5_000, 100_000)
    );
    expect(fragment).not.toContain("FIGURES ABOVE ARE UNRELIABLE");
  });

  it("says nothing when everything classified cleanly — the healthy path is untouched", () => {
    const fragment = section("financial_health").userPromptFragment(
      ctxWithUnclassified(0, 100_000)
    );
    expect(fragment).not.toContain("FIGURES ABOVE ARE UNRELIABLE");
  });
});

describe("expense_breakdown — unclassified is not a spending category", () => {
  it("renders the unclassified bucket as its own row", () => {
    const ctx = contextWith({
      expensesByCategory: { payroll: 1000, unclassified: 727_498 },
    });
    const fragment = section("expense_breakdown").userPromptFragment(ctx);
    expect(fragment).toContain("unclassified");
    expect(fragment).toContain("$727.5K");
  });

  it("instructs the model never to call it spending or fold it into other", () => {
    const rules = section("expense_breakdown").systemPromptFragment as string;
    expect(rules).toMatch(/measurement gap, not a category of spending/i);
    expect(rules).toMatch(/never describe it as money spent/i);
  });
});
