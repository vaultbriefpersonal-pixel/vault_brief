import { describe, it, expect } from "vitest";
import {
  trailingAverageBurn,
  burnTrend,
  liquidRunwayMonths,
} from "./burn-metrics";

/** Snapshots arrive from a `numeric` column, i.e. as strings. */
function months(...burns: (string | number | null)[]) {
  return burns.map((burnRateUsd) => ({ burnRateUsd }));
}

describe("trailingAverageBurn", () => {
  it("averages the last three prior periods", () => {
    const result = trailingAverageBurn(months("300000", "200000", "100000"));
    expect(result.avgUsd).toBe(200_000);
    expect(result.monthsUsed).toBe(3);
    expect(result.monthsConsidered).toBe(3);
  });

  it("excludes a zero-burn month from BOTH the sum and the divisor", () => {
    // A month with no recorded outflows is missing data, not a month of free
    // operation. Averaging the zero in would halve burn and double runway.
    const result = trailingAverageBurn(months("300000", "0", "100000"));
    expect(result.avgUsd).toBe(200_000);
    expect(result.monthsUsed).toBe(2);
    expect(result.monthsConsidered).toBe(3);
  });

  it("excludes null, missing, negative and unparseable burn the same way", () => {
    const result = trailingAverageBurn([
      { burnRateUsd: "400000" },
      { burnRateUsd: null },
      { burnRateUsd: "-50000" },
      { burnRateUsd: "not a number" },
      {},
    ]);
    expect(result.avgUsd).toBe(400_000);
    expect(result.monthsUsed).toBe(1);
    expect(result.monthsConsidered).toBe(3);
  });

  it("reports a sample size of 0 with no history at all", () => {
    for (const input of [[], null, undefined]) {
      const result = trailingAverageBurn(input);
      expect(result.avgUsd).toBe(0);
      expect(result.monthsUsed).toBe(0);
      expect(result.monthsConsidered).toBe(0);
    }
  });

  it("reports a sample size of 0 when every prior month is zero-burn", () => {
    const result = trailingAverageBurn(months("0", "0", "0"));
    expect(result.avgUsd).toBe(0);
    expect(result.monthsUsed).toBe(0);
    expect(result.monthsConsidered).toBe(3);
  });

  it("uses only the first `months` entries, most-recent-first", () => {
    const result = trailingAverageBurn(
      months("100000", "100000", "100000", "999999999"),
      3
    );
    expect(result.avgUsd).toBe(100_000);
    expect(result.monthsUsed).toBe(3);
  });

  it("honours a custom window", () => {
    const result = trailingAverageBurn(months("100000", "300000"), 1);
    expect(result.avgUsd).toBe(100_000);
    expect(result.monthsConsidered).toBe(1);
  });

  it("returns an empty result for a non-positive window", () => {
    expect(trailingAverageBurn(months("100000"), 0).monthsUsed).toBe(0);
  });

  it("reports a thin sample rather than padding it", () => {
    const result = trailingAverageBurn(months("150000"));
    expect(result.avgUsd).toBe(150_000);
    expect(result.monthsUsed).toBe(1);
    expect(result.monthsConsidered).toBe(1);
  });
});

describe("burnTrend", () => {
  it("is stable inside the ±15% dead band, at both edges", () => {
    expect(burnTrend(100, 100)).toBe("stable");
    expect(burnTrend(115, 100)).toBe("stable");
    expect(burnTrend(85, 100)).toBe("stable");
  });

  it("accelerates above +15%", () => {
    expect(burnTrend(115.01, 100)).toBe("accelerating");
    expect(burnTrend(400_000, 200_000)).toBe("accelerating");
  });

  it("decelerates below -15%", () => {
    expect(burnTrend(84.99, 100)).toBe("decelerating");
    expect(burnTrend(50_000, 200_000)).toBe("decelerating");
  });

  it("is unknown without a trailing average to compare against", () => {
    expect(burnTrend(100_000, 0)).toBe("unknown");
    expect(burnTrend(100_000, -5)).toBe("unknown");
    expect(burnTrend(100_000, NaN)).toBe("unknown");
  });

  it("is unknown for a zero-burn current period, not 'decelerating'", () => {
    // Same rule as the average: no recorded outflows is missing data. Calling
    // it deceleration would report a sync gap as an efficiency gain.
    expect(burnTrend(0, 200_000)).toBe("unknown");
    expect(burnTrend(NaN, 200_000)).toBe("unknown");
  });
});

describe("liquidRunwayMonths", () => {
  it("divides reserves by average burn", () => {
    expect(liquidRunwayMonths(3_500_000, 200_000)).toBeCloseTo(17.5, 6);
  });

  it("is null — not Infinity, not 0 — when burn is zero or unusable", () => {
    expect(liquidRunwayMonths(3_500_000, 0)).toBeNull();
    expect(liquidRunwayMonths(3_500_000, -1)).toBeNull();
    expect(liquidRunwayMonths(3_500_000, NaN)).toBeNull();
  });

  it("returns 0 months for genuinely empty reserves", () => {
    expect(liquidRunwayMonths(0, 200_000)).toBe(0);
  });

  it("is null for a nonsensical reserves figure", () => {
    expect(liquidRunwayMonths(-1, 200_000)).toBeNull();
    expect(liquidRunwayMonths(NaN, 200_000)).toBeNull();
  });
});
