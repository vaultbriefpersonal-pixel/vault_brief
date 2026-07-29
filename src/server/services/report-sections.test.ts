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
import { INCOME_CATEGORIES } from "./expense-classifier";
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
    expect(result.slice(0, 2)).toEqual(["executive_summary", "wins"]);
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
  prevSnapshot: TreasurySnapshot | null = null
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
    total: TREASURY_TOTAL,
    minSignificant: MIN_SIGNIFICANT,
  } as unknown as ReportSectionContext;
}

function section(id: string): ReportSection {
  const found = getSectionById(id);
  if (!found) throw new Error(`section ${id} is missing from the library`);
  return found;
}

describe("library placement of the new sections", () => {
  it("puts protocol_revenue directly after expense_breakdown", () => {
    expect(LIBRARY_IDS[LIBRARY_IDS.indexOf("expense_breakdown") + 1]).toBe(
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
