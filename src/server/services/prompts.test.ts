import { describe, it, expect } from "vitest";
import { buildReportPrompts, validateReportContent } from "./prompts";
import type { TreasurySnapshot } from "@/server/db/schema";

// `validateReportContent` (renamed from `validateReportNumbers`) is the
// correction-retry gate in report-generator.ts: a report failing this check
// gets one regeneration pass with the issues quoted back to the model. Two
// jobs, tested separately below — the original total-balance sanity check,
// unchanged, and the new forbidden-phrase scan that enforces the absolute
// guardrails (no token-price/valuation prediction, no buy/sell/hold advice)
// even if a section's own prompt rules somehow failed to stop it.

function snapshot(totalBalanceUsd: string | null): TreasurySnapshot {
  return { totalBalanceUsd } as unknown as TreasurySnapshot;
}

describe("validateReportContent — total balance check (unchanged behavior)", () => {
  it("passes when the total balance appears in millions form", () => {
    const result = validateReportContent(
      "Treasury stands at $1.2M this period.",
      snapshot("1200000")
    );
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("passes when the total balance appears in thousands form", () => {
    const result = validateReportContent(
      "Treasury stands at $48K this period.",
      snapshot("48000")
    );
    expect(result.passed).toBe(true);
  });

  it("passes when the raw figure appears verbatim", () => {
    const result = validateReportContent(
      "Treasury stands at 1234567 this period.",
      snapshot("1234567")
    );
    expect(result.passed).toBe(true);
  });

  it("fails when a material total balance is missing from the report", () => {
    const result = validateReportContent(
      "This report mentions no treasury figures at all.",
      snapshot("1200000")
    );
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("Total balance"))).toBe(true);
  });

  it("does not require the figure for a negligible or absent balance", () => {
    const zero = validateReportContent("Nothing here.", snapshot("500"));
    expect(zero.passed).toBe(true);
    const missing = validateReportContent("Nothing here.", snapshot(null));
    expect(missing.passed).toBe(true);
  });
});

describe("validateReportContent — forbidden-phrase scan (A7)", () => {
  const clean = snapshot(null);

  it('catches "will reach"', () => {
    const result = validateReportContent(
      "At this pace, reserves will reach $2M by year end.",
      clean
    );
    expect(result.passed).toBe(false);
    expect(
      result.issues.some((i) => i.includes('Forbidden phrase found: "will reach"'))
    ).toBe(true);
  });

  it('catches "projected market cap"', () => {
    const result = validateReportContent(
      "The projected market cap next quarter is substantial.",
      clean
    );
    expect(result.passed).toBe(false);
    expect(
      result.issues.some((i) =>
        i.includes('Forbidden phrase found: "projected market cap"')
      )
    ).toBe(true);
  });

  it('catches "investors should"', () => {
    const result = validateReportContent(
      "Given this runway, investors should feel confident.",
      clean
    );
    expect(result.passed).toBe(false);
    expect(
      result.issues.some((i) =>
        i.includes('Forbidden phrase found: "investors should"')
      )
    ).toBe(true);
  });

  it('catches "guaranteed"', () => {
    const result = validateReportContent(
      "This runway is guaranteed to last through the next raise.",
      clean
    );
    expect(result.passed).toBe(false);
    expect(
      result.issues.some((i) => i.includes('Forbidden phrase found: "guaranteed"'))
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    const result = validateReportContent(
      "Reserves WILL REACH a new high next period.",
      clean
    );
    expect(result.passed).toBe(false);
  });

  it("catches multiple violations in the same report", () => {
    const result = validateReportContent(
      "Reserves will reach $2M and this is guaranteed. Investors should hold on.",
      clean
    );
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT flag a legitimate conditional projection using different wording", () => {
    // "would reach" (conditional) is a different phrase from "will reach"
    // (assertion) — the whole point of phrase-specific, word-boundary-aware
    // matching instead of banning the bare word "reach".
    const result = validateReportContent(
      "If the trailing average net flow repeats, reserves would reach approximately $1.2M.",
      clean
    );
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("does not flag ordinary use of related words outside the banned phrases", () => {
    const result = validateReportContent(
      "The team reached out to a new partner this period. Investors received the update.",
      clean
    );
    expect(result.passed).toBe(true);
  });
});

// ─── grant data reaching the prompt ────────────────────────────────────────
//
// End-to-end through `buildReportPrompts`, not through a hand-built context.
// The unit tests in report-sections.test.ts prove the sections render given a
// context; these prove the two new optional inputs actually REACH one. That is
// a separate failure: three call sites build a context, and a field dropped
// between the options bag and `ReportSectionContext` would leave every section
// gated off with no error anywhere.

const grantProject = {
  id: "p1",
  name: "Test Protocol",
  tokenSymbol: null,
} as unknown as Parameters<typeof buildReportPrompts>[0]["project"];

const grantSnapshot = {
  id: "s1",
  projectId: "p1",
  snapshotDate: "2026-04-30",
  totalBalanceUsd: "8500000",
  expensesByCategory: { payroll: 300_000 },
  incomeByCategory: { grant_received: 250_000 },
} as unknown as TreasurySnapshot;

const AWARD = {
  id: "award-1",
  projectId: "p1",
  grantor: "Optimism Foundation",
  program: null,
  awardAmountUsd: "2000000",
  awardAmountToken: null,
  awardTokenSymbol: null,
  awardDate: "2026-01-15",
  reportingStartDate: null,
  status: "active",
  agreementUrl: null,
  notes: null,
};

const TRANCHE = {
  id: "t1",
  grantAwardId: "award-1",
  projectId: "p1",
  label: "Tranche 1",
  amountUsd: "250000",
  expectedDate: null,
  receivedDate: "2026-04-10",
  txHash: null,
  notes: null,
};

/** Every section on, so nothing is hidden by the default config. */
const ALL_ON = [
  { id: "grant_fund_usage", enabled: true },
  { id: "grant_milestone_progress", enabled: true },
];

describe("buildReportPrompts — grant awards", () => {
  it("defaults both grant inputs to empty, so every existing caller is unchanged", () => {
    const { user, system } = buildReportPrompts({
      snapshot: grantSnapshot,
      project: grantProject,
      storedSections: ALL_ON,
    });
    expect(user).not.toContain("Grant funding received");
    expect(system).not.toContain("### Grant Funding Received");
  });

  it("carries awards and tranches through to the rendered section", () => {
    const { user, system } = buildReportPrompts({
      snapshot: grantSnapshot,
      project: grantProject,
      grantAwards: [AWARD] as never,
      grantTranches: [TRANCHE] as never,
      storedSections: ALL_ON,
    });
    expect(user).toContain("## Grant funding received and its use");
    expect(user).toContain("Awarded: $2.0M");
    expect(user).toContain("Received to date: $250.0K");
    expect(system).toContain("### Grant Funding Received");
  });

  it("carries grant deliverables through when a milestone is attached", () => {
    const { user } = buildReportPrompts({
      snapshot: grantSnapshot,
      project: grantProject,
      milestones: [
        {
          id: "m1",
          projectId: "p1",
          title: "Ship the SDK",
          description: null,
          status: "completed",
          targetDate: "2026-04-01",
          completedDate: "2026-04-15",
          grantAwardId: "award-1",
        },
      ] as never,
      grantAwards: [AWARD] as never,
      grantTranches: [TRANCHE] as never,
      storedSections: ALL_ON,
    });
    expect(user).toContain("## Grant deliverable progress");
    expect(user).toContain("Ship the SDK");
  });

  it("never puts a spend-derived remaining figure in the finished prompt", () => {
    // The same guarantee as the section-level test, asserted on the actual
    // string handed to the model: $250K received, $300K spent — so a
    // `received - spent` figure would be -$50.0K, and `awarded - spent`
    // $1.7M. Neither may appear anywhere in either prompt.
    const { user, system } = buildReportPrompts({
      snapshot: grantSnapshot,
      project: grantProject,
      grantAwards: [AWARD] as never,
      grantTranches: [TRANCHE] as never,
      storedSections: ALL_ON,
    });
    for (const text of [user, system]) {
      expect(text).not.toContain("-$50.0K");
      expect(text).not.toContain("$1.7M");
    }
    // And the legal one is present, with its definition attached.
    expect(user).toContain(
      "Not yet disbursed under the award (awarded minus received to date): $1.8M"
    );
  });
});
