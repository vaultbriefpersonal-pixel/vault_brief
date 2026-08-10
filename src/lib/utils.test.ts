import { describe, it, expect, afterEach } from "vitest";
import { formatDate } from "./utils";

/**
 * These tests move the process timezone, which Node re-reads on the next Date
 * operation. Without that they would be decorative: CI runs in UTC, where the
 * bug below is invisible, so a fixed-expectation test would have passed both
 * before and after the fix.
 */
const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("formatDate — a calendar date must not drift with the timezone", () => {
  it("keeps the stored month west of Greenwich", () => {
    // The regression. `new Date("2026-04-01")` is UTC midnight; rendered in New
    // York that instant is 31 March, so the label used to read "March 2026".
    process.env.TZ = "America/New_York";
    expect(formatDate("2026-04-01")).toBe("April 2026");
  });

  it("keeps the stored YEAR across a January boundary", () => {
    // The worst version of the same bug: a January report labelled as the
    // previous December.
    process.env.TZ = "America/New_York";
    expect(formatDate("2026-01-01")).toBe("January 2026");
  });

  it("gives the same answer in every zone", () => {
    const zones = ["America/Los_Angeles", "America/New_York", "UTC", "Europe/Kyiv", "Asia/Tokyo"];
    const results = zones.map((tz) => {
      process.env.TZ = tz;
      return formatDate("2026-01-01");
    });
    // The property that matters, stated directly: the label is a function of
    // the stored date alone, not of where the code happens to run.
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("January 2026");
  });

  it("still handles a mid-month date and a period end", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(formatDate("2026-04-30")).toBe("April 2026");
    expect(formatDate("2026-07-31")).toBe("July 2026");
  });

  it("leaves a real timestamp rendering in the reader's own zone", () => {
    // Deliberately NOT pinned to UTC: an instant is a moment in time, and
    // showing it locally is correct. 2026-01-01T03:00Z is still 31 Dec in NY.
    const instant = new Date("2026-01-01T03:00:00Z");
    process.env.TZ = "America/New_York";
    expect(formatDate(instant)).toBe("December 2025");
    process.env.TZ = "UTC";
    expect(formatDate(instant)).toBe("January 2026");
  });
});
