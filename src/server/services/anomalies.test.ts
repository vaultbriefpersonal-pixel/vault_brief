import { describe, it, expect } from "vitest";
import { detectAnomalies, type Anomaly } from "./anomalies";
import type { TreasurySnapshot } from "@/server/db/schema";

// Fixture cast: detectAnomalies only reads totalBalanceUsd, burnRateUsd,
// stablecoinsUsd, totalInflowsUsd, and expensesByCategory. Building a full
// ~30-column TreasurySnapshot for every test case would bury the signal —
// this narrows to just what the function under test actually touches.
function snapshot(overrides: {
  totalBalanceUsd?: number;
  burnRateUsd?: number;
  stablecoinsUsd?: number;
  totalInflowsUsd?: number;
  expensesByCategory?: Record<string, number>;
}): TreasurySnapshot {
  return {
    totalBalanceUsd: overrides.totalBalanceUsd?.toString() ?? null,
    burnRateUsd: overrides.burnRateUsd?.toString() ?? null,
    stablecoinsUsd: overrides.stablecoinsUsd?.toString() ?? null,
    totalInflowsUsd: overrides.totalInflowsUsd?.toString() ?? null,
    expensesByCategory: overrides.expensesByCategory ?? null,
  } as unknown as TreasurySnapshot;
}

function findAnomaly(anomalies: Anomaly[], metric: string): Anomaly | undefined {
  return anomalies.find((a) => a.metric === metric);
}

describe("detectAnomalies", () => {
  it("returns nothing when there are no prior snapshots to compare against", () => {
    const current = snapshot({ burnRateUsd: 50_000 });
    expect(detectAnomalies(current, [])).toEqual([]);
  });

  it("ignores changes below the $1,000 absolute-noise floor", () => {
    const current = snapshot({ burnRateUsd: 10_500 });
    const prior = [snapshot({ burnRateUsd: 10_000 })];
    // 5% relative change, but only $500 absolute — below MIN_ABSOLUTE_USD.
    expect(detectAnomalies(current, prior)).toEqual([]);
  });

  it("ignores changes below the 30% relative threshold", () => {
    const current = snapshot({ burnRateUsd: 12_000 });
    const prior = [snapshot({ burnRateUsd: 10_000 })];
    // 20% change, well above the $1,000 floor but under the 30% minor bar.
    expect(detectAnomalies(current, prior)).toEqual([]);
  });

  it("classifies a 30-49% change as minor", () => {
    const current = snapshot({ burnRateUsd: 14_000 });
    const prior = [snapshot({ burnRateUsd: 10_000 })];
    const a = findAnomaly(detectAnomalies(current, prior), "Burn rate");
    expect(a?.severity).toBe("minor");
  });

  it("classifies a 50-99% change as significant", () => {
    const current = snapshot({ burnRateUsd: 16_000 });
    const prior = [snapshot({ burnRateUsd: 10_000 })];
    const a = findAnomaly(detectAnomalies(current, prior), "Burn rate");
    expect(a?.severity).toBe("significant");
  });

  it("classifies a >=100% change as critical", () => {
    const current = snapshot({ burnRateUsd: 25_000 });
    const prior = [snapshot({ burnRateUsd: 10_000 })];
    const a = findAnomaly(detectAnomalies(current, prior), "Burn rate");
    expect(a?.severity).toBe("critical");
  });

  it("averages multiple prior snapshots as the baseline", () => {
    const current = snapshot({ totalBalanceUsd: 40_000 });
    // Baseline avg = (10,000 + 20,000 + 30,000) / 3 = 20,000 → +100% → critical.
    const prior = [
      snapshot({ totalBalanceUsd: 10_000 }),
      snapshot({ totalBalanceUsd: 20_000 }),
      snapshot({ totalBalanceUsd: 30_000 }),
    ];
    const a = findAnomaly(detectAnomalies(current, prior), "Total balance");
    expect(a?.baseline).toBe(20_000);
    expect(a?.severity).toBe("critical");
  });

  it("flags a new expense category with no prior history", () => {
    const current = snapshot({
      expensesByCategory: { payroll: 5_000, legal: 15_000 },
    });
    const prior = [snapshot({ expensesByCategory: { payroll: 5_000 } })];
    const a = findAnomaly(detectAnomalies(current, prior), "Expense: legal");
    expect(a?.newCategory).toBe(true);
    expect(a?.severity).toBe("minor");
  });

  it("does not flag a brand-new category below the $1,000 floor", () => {
    const current = snapshot({ expensesByCategory: { legal: 500 } });
    const a = findAnomaly(detectAnomalies(current, [snapshot({})]), "Expense: legal");
    expect(a).toBeUndefined();
  });

  it("never flags token_sale as an expense anomaly (treasury op, not spend)", () => {
    const current = snapshot({ expensesByCategory: { token_sale: 500_000 } });
    const prior = [snapshot({ expensesByCategory: { token_sale: 10_000 } })];
    const a = findAnomaly(detectAnomalies(current, prior), "Expense: token_sale");
    expect(a).toBeUndefined();
  });

  it("sorts critical first, then significant, then minor", () => {
    const current = snapshot({
      totalBalanceUsd: 14_000, // +40% → minor
      burnRateUsd: 16_000, // +60% → significant
      stablecoinsUsd: 25_000, // +150% → critical
    });
    const prior = [
      snapshot({ totalBalanceUsd: 10_000, burnRateUsd: 10_000, stablecoinsUsd: 10_000 }),
    ];
    const anomalies = detectAnomalies(current, prior);
    expect(anomalies.map((a) => a.severity)).toEqual([
      "critical",
      "significant",
      "minor",
    ]);
  });

  it("within the same severity, sorts by largest absolute change first", () => {
    const current = snapshot({
      burnRateUsd: 25_000, // +150% → critical
      stablecoinsUsd: 100_000, // +900% → critical
    });
    const prior = [snapshot({ burnRateUsd: 10_000, stablecoinsUsd: 10_000 })];
    const anomalies = detectAnomalies(current, prior);
    expect(anomalies[0].metric).toBe("Stablecoins"); // +900% > +150%
    expect(anomalies[1].metric).toBe("Burn rate");
  });
});
