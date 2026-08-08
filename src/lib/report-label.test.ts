import { describe, it, expect } from "vitest";
import { describeReport } from "./report-label";

describe("describeReport", () => {
  describe("kind", () => {
    it("names a grant report as one", () => {
      expect(describeReport({ reportType: "grant", periodEnd: "2026-04-30" }).kind).toBe(
        "Grant Report"
      );
    });

    it("treats everything else as an investor update", () => {
      for (const t of ["investor", null, undefined, "", "something_new"]) {
        expect(describeReport({ reportType: t, periodEnd: "2026-04-30" }).kind).toBe(
          "Investor Update"
        );
      }
    });
  });

  describe("period", () => {
    it("labels a calendar month as that month", () => {
      expect(
        describeReport({ periodStart: "2026-04-01", periodEnd: "2026-04-30" }).period
      ).toBe("April 2026");
    });

    // The bug this module exists for: a non-month period was labelled
    // "Monthly ... " and dated by its end month, so a 90-day report and a
    // since-grant-award report both read as if they covered one month.
    it("labels a multi-month range as a range, not a month", () => {
      const period = describeReport({
        periodStart: "2026-02-14",
        periodEnd: "2026-07-31",
      }).period;
      expect(period).toContain("Feb");
      expect(period).toContain("Jul");
      expect(period).not.toBe("July 2026");
    });

    it("labels a partial month as a range too", () => {
      const period = describeReport({
        periodStart: "2026-04-05",
        periodEnd: "2026-04-30",
      }).period;
      expect(period).not.toBe("April 2026");
    });

    // Rows written before `period_start` existed still have to render.
    it("falls back to the end month when there is no start bound", () => {
      for (const start of [null, undefined, ""]) {
        expect(
          describeReport({ periodStart: start, periodEnd: "2026-04-30" }).period
        ).toBe("April 2026");
      }
    });

    // A cosmetic label must never take down an investor-facing page.
    it("falls back instead of throwing on an unparseable start", () => {
      expect(() =>
        describeReport({ periodStart: "not-a-date", periodEnd: "2026-04-30" })
      ).not.toThrow();
      expect(
        describeReport({ periodStart: "not-a-date", periodEnd: "2026-04-30" }).period
      ).toBe("April 2026");
    });

    it("accepts Date objects as well as ISO strings", () => {
      expect(
        describeReport({
          periodStart: new Date(Date.UTC(2026, 3, 1)),
          periodEnd: new Date(Date.UTC(2026, 3, 30)),
        }).period
      ).toBe("April 2026");
    });
  });

  it("combines both halves for a grant report over a custom window", () => {
    const out = describeReport({
      reportType: "grant",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(out.kind).toBe("Grant Report");
    expect(out.period).not.toContain("Monthly");
    expect(out.period).toMatch(/Jan|Mar/);
  });
});
