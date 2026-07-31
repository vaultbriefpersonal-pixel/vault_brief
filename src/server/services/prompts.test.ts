import { describe, it, expect } from "vitest";
import { validateReportContent } from "./prompts";
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
