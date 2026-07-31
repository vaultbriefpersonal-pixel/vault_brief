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

describe("trailingAverageBurn — period-length normalisation", () => {
  it("is bit-for-bit unchanged when no entry carries periodDays", () => {
    // The behaviour lock. `period_days` does not exist as a column yet, so
    // EVERY row in the database and every row written today arrives here
    // absent. Anything but the identity restates published reports.
    expect(trailingAverageBurn(months("300000", "200000", "100000")).avgUsd).toBe(
      200_000
    );
    expect(trailingAverageBurn(months("333333.33")).avgUsd).toBe(333_333.33);
    expect(
      trailingAverageBurn([{ burnRateUsd: "150000", periodDays: null }]).avgUsd
    ).toBe(150_000);
    expect(
      trailingAverageBurn([{ burnRateUsd: "150000", periodDays: undefined }])
        .avgUsd
    ).toBe(150_000);
  });

  it("reduces a long window to a monthly figure before averaging", () => {
    // A 182-day window that spent $1.2M did NOT burn $1.2M a month; it burned
    // about $200K a month. Averaged raw against one-month rows it would sit
    // six times too high and flow straight into runway and the burn trend.
    const sixMonths = trailingAverageBurn([
      { burnRateUsd: "1200000", periodDays: 182 },
    ]);
    expect(sixMonths.avgUsd).toBeCloseTo(1_200_000 / (182 / 30.4375), 6);
    expect(sixMonths.avgUsd).toBeCloseTo(200_686.81, 2);
    expect(sixMonths.monthsUsed).toBe(1);
  });

  it("averages a long window and a short one as monthly equals, not as peers", () => {
    // $200K/mo from a six-month window and $200K from a month must average to
    // $200K, not to $700K.
    const mixed = trailingAverageBurn([
      { burnRateUsd: String(200_000 * (182 / 30.4375)), periodDays: 182 },
      { burnRateUsd: "200000" },
    ]);
    expect(mixed.avgUsd).toBeCloseTo(200_000, 6);
    expect(mixed.monthsUsed).toBe(2);
  });

  it("does not resurrect a zero-burn period as a real one", () => {
    // The header's load-bearing rule, unchanged: a zero total is missing data
    // at any period length. Normalisation runs only on rows that already
    // cleared the exclusion, so a zero cannot be divided into existence.
    const result = trailingAverageBurn([
      { burnRateUsd: "600000", periodDays: 91 },
      { burnRateUsd: "0", periodDays: 91 },
      { burnRateUsd: "-1", periodDays: 91 },
      { burnRateUsd: "not a number", periodDays: 91 },
    ]);
    expect(result.monthsUsed).toBe(1);
    expect(result.monthsConsidered).toBe(3);
    expect(result.avgUsd).toBeCloseTo(600_000 / (91 / 30.4375), 6);
  });

  it("ignores a periodDays that cannot be a period length", () => {
    // Same failure posture as the rest of this module: fall back to the
    // pre-existing arithmetic rather than emit NaN or Infinity into a figure
    // an investor reads as a runway.
    for (const bad of [0, -30, NaN, Infinity]) {
      expect(
        trailingAverageBurn([{ burnRateUsd: "100000", periodDays: bad }]).avgUsd
      ).toBe(100_000);
    }
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
