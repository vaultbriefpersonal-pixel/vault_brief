import { describe, it, expect } from "vitest";
import {
  getSectionById,
  type ReportSection,
} from "./report-sections";
import { grantDataIssues } from "./report-derived";
import { periodOfMonth } from "./report-period";
import type { ReportSectionContext } from "./report-derived";
import type { TreasurySnapshot } from "@/server/db/schema";

const AWARD_ID = "award-1";

function ctxWith(
  grantAwards: unknown[],
  grantTranches: unknown[] = []
): ReportSectionContext {
  return {
    snapshot: {
      id: "s1",
      projectId: "p1",
      snapshotDate: "2026-04-30",
      totalBalanceUsd: "1000000",
    } as unknown as TreasurySnapshot,
    prevSnapshot: null,
    trailing: [],
    project: { name: "Test Protocol" },
    milestones: [],
    period: periodOfMonth("2026-04"),
    grants: [],
    governanceProposals: [],
    partners: [],
    asks: [],
    qaHighlights: [],
    budgets: [],
    grantAwards,
    grantTranches,
    anomalies: [],
    total: 1_000_000,
    minSignificant: 1000,
  } as unknown as ReportSectionContext;
}

function award(fields: Record<string, unknown> = {}) {
  return {
    id: AWARD_ID,
    projectId: "p1",
    grantor: "Optimism Foundation",
    program: "Growth Experiments",
    status: "active",
    awardDate: "2026-01-15",
    awardAmountUsd: null,
    awardAmountToken: null,
    awardTokenSymbol: null,
    agreementUrl: null,
    ...fields,
  };
}

function tranche(fields: Record<string, unknown> = {}) {
  return {
    id: "t1",
    projectId: "p1",
    grantAwardId: AWARD_ID,
    label: "Tranche 1",
    amountUsd: "50000",
    expectedDate: "2026-02-01",
    receivedDate: "2026-02-01",
    utilizedUsd: null,
    sourceOfTruth: null,
    txHash: null,
    ...fields,
  };
}

function fundUsage(): ReportSection {
  const s = getSectionById("grant_fund_usage");
  if (!s) throw new Error("grant_fund_usage missing from the library");
  return s;
}

describe("grant_fund_usage gates on substance, not on a row existing", () => {
  // The bug: recording "we got a grant from X" and nothing else turned the
  // readiness chip green and produced a block whose only figure was $0.
  it("is not ready for an award with no amount and no tranches", () => {
    const ctx = ctxWith([award()]);
    expect(fundUsage().requires(ctx)).toBe(false);
  });

  // The invariant that makes this safe: buildSystemPrompt picks a section's
  // rules by whether the FRAGMENT is non-empty, not by `requires`. If the two
  // disagree, the grant accounting rules ship with no data block to govern.
  it("renders nothing for that same award, so the rules cannot leak", () => {
    const ctx = ctxWith([award()]);
    expect(fundUsage().userPromptFragment(ctx).trim()).toBe("");
  });

  it("is ready once an award amount is recorded", () => {
    const ctx = ctxWith([award({ awardAmountUsd: "100000" })]);
    expect(fundUsage().requires(ctx)).toBe(true);
    expect(fundUsage().userPromptFragment(ctx).length).toBeGreaterThan(0);
  });

  it("is ready on a token-denominated award with no USD figure", () => {
    const ctx = ctxWith([
      award({ awardAmountToken: "250000", awardTokenSymbol: "OP" }),
    ]);
    expect(fundUsage().requires(ctx)).toBe(true);
  });

  it("is ready on tranches alone, with no award amount", () => {
    const ctx = ctxWith([award()], [tranche()]);
    expect(fundUsage().requires(ctx)).toBe(true);
  });

  // BYTE-IDENTITY, stated as the property it rests on. The only prompt-path
  // change in this stage is that the fragment iterates a FILTERED award list
  // instead of the full one. Where every award has substance the two lists are
  // the same, so the rendered bytes are unchanged for every healthy fixture —
  // which is what makes this safe to ship against existing reports.
  it("filters nothing out when every award has substance", () => {
    const awards = [
      award({ awardAmountUsd: "100000" }),
      award({ id: "award-2", grantor: "Arbitrum DAO", awardAmountUsd: "40000" }),
    ];
    const ctx = ctxWith(awards);
    const fragment = fundUsage().userPromptFragment(ctx);
    expect(fragment).toContain("Optimism Foundation");
    expect(fragment).toContain("Arbitrum DAO");
    expect(fragment).toContain("Across all 2 awards");
  });

  it("drops only the empty award when another one has substance", () => {
    const ctx = ctxWith([
      award({ awardAmountUsd: "100000" }),
      award({ id: "award-2", grantor: "Arbitrum DAO", program: null }),
    ]);
    const fragment = fundUsage().userPromptFragment(ctx);
    expect(fundUsage().requires(ctx)).toBe(true);
    expect(fragment).toContain("Optimism Foundation");
    expect(fragment).not.toContain("Arbitrum DAO");
    // The aggregate line counts what is rendered, not what exists.
    expect(fragment).not.toContain("Across all 2 awards");
  });
});

describe("grantDataIssues", () => {
  it("says nothing when the records tie out", () => {
    const ctx = ctxWith(
      [award({ awardAmountUsd: "50000" })],
      [tranche({ utilizedUsd: "20000" })]
    );
    expect(grantDataIssues(ctx)).toEqual([]);
  });

  it("flags a tranche schedule that disagrees with the award amount", () => {
    const ctx = ctxWith(
      [award({ awardAmountUsd: "100000" })],
      [tranche({ amountUsd: "50000" })]
    );
    const issues = grantDataIssues(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("out of date");
  });

  it("flags partial utilisation coverage as an upper bound", () => {
    const ctx = ctxWith(
      [award({ awardAmountUsd: "100000" })],
      [
        tranche({ id: "t1", amountUsd: "50000", utilizedUsd: "10000" }),
        tranche({ id: "t2", amountUsd: "50000", utilizedUsd: null }),
      ]
    );
    const issues = grantDataIssues(ctx);
    expect(issues.some((i) => i.includes("upper bound"))).toBe(true);
  });

  // The 81,000-against-75,000 case from the research corpus. Reported as a
  // records discrepancy, never as an overspend finding about the project —
  // real accepted grant reports do not balance.
  it("flags utilisation exceeding receipts without calling it overspending", () => {
    const ctx = ctxWith(
      [award({ awardAmountUsd: "75000" })],
      [tranche({ amountUsd: "75000", utilizedUsd: "81000" })]
    );
    const issues = grantDataIssues(ctx);
    const found = issues.find((i) => i.includes("exceeds recorded receipts"));
    expect(found).toBeDefined();
    expect(found).toContain("discrepancy between two records");
    expect(found).not.toContain("overspend");
  });

  it("says nothing about a project with no grant awards at all", () => {
    expect(grantDataIssues(ctxWith([]))).toEqual([]);
  });
});
