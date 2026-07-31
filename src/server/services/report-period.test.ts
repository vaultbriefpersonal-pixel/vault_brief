import { describe, it, expect } from "vitest";
import {
  periodFromRange,
  periodOfMonth,
  periodFromSnapshot,
  matchesPeriod,
  dateInPeriod,
  monthsInPeriod,
  monthsInDateRange,
  DAYS_PER_MONTH,
  longGapDaysFor,
  comparablePeriods,
  comparableTrailing,
  burnPeriodDays,
  snapshotPeriodStart,
  snapshotPeriodConflicts,
  assertPeriodSupported,
} from "./report-period";

/** The shape every report in production has had until now. */
const APRIL = periodOfMonth("2026-04");
/** A grant window: starts mid-month, spans six months, ends today. */
const GRANT_WINDOW = periodFromRange("2026-02-14", "2026-07-31");

describe("periodFromRange", () => {
  it("counts both ends — a period is inclusive, so a single day is one day", () => {
    const p = periodFromRange("2026-04-10", "2026-04-10");
    expect(p.days).toBe(1);
    expect(p.start).toBe("2026-04-10");
    expect(p.end).toBe("2026-04-10");
  });

  it("treats a single day as custom — one day is not a calendar month", () => {
    expect(periodFromRange("2026-04-10", "2026-04-10").kind).toBe("custom");
    expect(periodFromRange("2026-04-10", "2026-04-10").monthAligned).toBe(false);
  });

  it("labels a single day as one date, not a range against itself", () => {
    expect(periodFromRange("2026-02-14", "2026-02-14").label).toBe("14 Feb 2026");
  });

  it("does its arithmetic in UTC — a date column is UTC midnight, not local", () => {
    // If any getUTC* here were the local variant, a generator running west of
    // Greenwich would read 2026-04-01 as March 31st and produce a 32-day
    // "April" that is not a month. report-generator.ts:208-209 has exactly
    // that bug today; this module must not inherit it.
    const p = periodFromRange("2026-04-01", "2026-04-30");
    expect(p.kind).toBe("month");
    expect(p.days).toBe(30);
    expect(p.months).toEqual(["2026-04"]);
  });

  it("accepts a timestamp string and keeps only its UTC day", () => {
    const p = periodFromRange("2026-04-01T00:00:00.000Z", "2026-04-30T23:59:59.000Z");
    expect(p.start).toBe("2026-04-01");
    expect(p.end).toBe("2026-04-30");
    expect(p.kind).toBe("month");
  });

  it("accepts Date objects, reading them as UTC days", () => {
    const p = periodFromRange(
      new Date("2026-04-01T00:00:00Z"),
      new Date("2026-04-30T00:00:00Z")
    );
    expect(p.tag).toBe("2026-04");
  });
});

describe("months enumeration", () => {
  it("crosses a year boundary by month index, not by adding days", () => {
    // December → January is the case a naive "+30 days" loop gets wrong, and
    // the failure is silent: the report simply omits a month of manual rows.
    const p = periodFromRange("2025-12-15", "2026-02-10");
    expect(p.months).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("includes the boundary months in full, however partial the overlap", () => {
    // A period starting on the 14th still touches all of that month, because
    // manual rows are tagged by month and cannot be resolved any finer. The
    // report discloses this rather than dropping rows; see `monthAligned`.
    expect(GRANT_WINDOW.months).toEqual([
      "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
    ]);
  });

  it("is never empty — even a one-day period touches one month", () => {
    expect(periodFromRange("2026-04-10", "2026-04-10").months).toEqual(["2026-04"]);
  });

  it("spans a whole year without drifting", () => {
    const p = periodFromRange("2026-01-01", "2026-12-31");
    expect(p.months).toHaveLength(12);
    expect(p.months[0]).toBe("2026-01");
    expect(p.months[11]).toBe("2026-12");
  });
});

describe("kind vs monthAligned", () => {
  it("calls a whole calendar month a month", () => {
    expect(APRIL.kind).toBe("month");
    expect(APRIL.monthAligned).toBe(true);
    expect(APRIL.tag).toBe("2026-04");
    expect(APRIL.label).toBe("April 2026");
  });

  it("calls a full quarter month-aligned but NOT a month", () => {
    // The distinction Phase 1 depends on: a quarter needs no month-granularity
    // disclosure (its edges ARE month edges) but must not take the
    // exactly-one-month short-circuit in monthsInPeriod.
    const q = periodFromRange("2026-02-01", "2026-04-30");
    expect(q.monthAligned).toBe(true);
    expect(q.kind).toBe("custom");
    expect(q.months).toHaveLength(3);
    expect(q.tag).toBe("2026-02-01..2026-04-30");
  });

  it("is not month-aligned when only one end lands on a boundary", () => {
    expect(periodFromRange("2026-02-01", "2026-04-15").monthAligned).toBe(false);
    expect(periodFromRange("2026-02-14", "2026-04-30").monthAligned).toBe(false);
  });

  it("recognises a month-end without a days-in-month table", () => {
    expect(periodFromRange("2026-02-01", "2026-02-28").kind).toBe("month");
    expect(periodFromRange("2028-02-01", "2028-02-29").kind).toBe("month");
    // 28 Feb is NOT the month end in a leap year — the naive rule would say it is.
    expect(periodFromRange("2028-02-01", "2028-02-28").kind).toBe("custom");
  });
});

describe("label", () => {
  it("names a month in full — 'April 2026'", () => {
    expect(APRIL.label).toBe("April 2026");
  });

  it("uses an en-dash range within a year, with the year stated once", () => {
    expect(GRANT_WINDOW.label).toBe("14 Feb – 31 Jul 2026");
  });

  it("states both years when the period crosses one", () => {
    expect(periodFromRange("2025-12-15", "2026-02-10").label).toBe(
      "15 Dec 2025 – 10 Feb 2026"
    );
  });
});

describe("periodOfMonth", () => {
  it("produces kind 'month' — the identity path for every existing report", () => {
    expect(periodOfMonth("2026-04")).toMatchObject({
      start: "2026-04-01",
      end: "2026-04-30",
      days: 30,
      kind: "month",
      tag: "2026-04",
      monthAligned: true,
    });
  });

  it("gets a 31-day month right", () => {
    const jan = periodOfMonth("2026-01");
    expect(jan.days).toBe(31);
    expect(jan.end).toBe("2026-01-31");
    expect(jan.kind).toBe("month");
  });

  it("gets a leap February right — 2028 has 29 days", () => {
    const feb = periodOfMonth("2028-02");
    expect(feb.days).toBe(29);
    expect(feb.end).toBe("2028-02-29");
    expect(feb.kind).toBe("month");
  });

  it("gets a non-leap February right", () => {
    expect(periodOfMonth("2026-02").days).toBe(28);
    // 2100 is divisible by 4 but not a leap year; Date.UTC knows, a table wouldn't.
    expect(periodOfMonth("2100-02").days).toBe(28);
  });

  it("crosses December correctly — day 0 of month 12 is 31 Dec", () => {
    expect(periodOfMonth("2026-12")).toMatchObject({
      start: "2026-12-01",
      end: "2026-12-31",
      days: 31,
    });
  });
});

describe("malformed input", () => {
  // The policy: constructors throw, predicates return false. A caller handing
  // a constructor garbage is a bug and there is no honest period to return;
  // a malformed value on one manual row must not cost the whole report.

  it("throws on an unparseable start — there is no period to return", () => {
    expect(() => periodFromRange("not-a-date", "2026-04-30")).toThrow(
      /unparseable period start/
    );
  });

  it("throws on an unparseable end", () => {
    expect(() => periodFromRange("2026-04-01", "")).toThrow(/unparseable period end/);
  });

  it("rejects a loose date string that new Date() would happily accept", () => {
    // new Date('2026-4-1') parses in V8. Accepting it is how an unpadded value
    // gets absorbed into a report instead of being caught at the door.
    expect(() => periodFromRange("2026-4-1", "2026-04-30")).toThrow();
  });

  it("rejects a date that overflows its month rather than rolling it forward", () => {
    // Date.UTC turns 2026-02-30 into March 2nd without complaint.
    expect(() => periodFromRange("2026-02-01", "2026-02-30")).toThrow();
  });

  it("rejects an Invalid Date object", () => {
    expect(() => periodFromRange(new Date("nope"), "2026-04-30")).toThrow();
  });

  it("throws when end precedes start — an inverted period is always a bug", () => {
    expect(() => periodFromRange("2026-04-30", "2026-04-01")).toThrow(/precedes start/);
  });

  it("throws on a month that is not 'YYYY-MM'", () => {
    expect(() => periodOfMonth("2026-4")).toThrow();
    expect(() => periodOfMonth("2026-13")).toThrow();
    expect(() => periodOfMonth("2026-00")).toThrow();
  });

  it("does NOT throw from the predicates — one bad row must not lose a report", () => {
    expect(matchesPeriod("2026-4", APRIL)).toBe(false);
    expect(matchesPeriod(null, APRIL)).toBe(false);
    expect(dateInPeriod("garbage", APRIL)).toBe(false);
    expect(dateInPeriod(null, APRIL)).toBe(false);
  });
});

describe("periodFromSnapshot", () => {
  it("reads periodStart when the column holds a value", () => {
    const p = periodFromSnapshot({
      snapshotDate: "2026-07-31",
      periodStart: "2026-02-14",
    });
    expect(p.start).toBe("2026-02-14");
    expect(p.end).toBe("2026-07-31");
    expect(p.kind).toBe("custom");
  });

  it("falls back to the first of the snapshot month when the column is absent", () => {
    // The column does not exist yet. Every write path that has ever run
    // produced a calendar month, so this reconstructs the real period.
    const p = periodFromSnapshot({ snapshotDate: "2026-04-30" });
    expect(p.start).toBe("2026-04-01");
    expect(p.kind).toBe("month");
    expect(p.tag).toBe("2026-04");
  });

  it("treats an explicit null the same as an absent column", () => {
    expect(periodFromSnapshot({ snapshotDate: "2026-04-30", periodStart: null })).toEqual(
      periodFromSnapshot({ snapshotDate: "2026-04-30" })
    );
  });

  it("reads identically before and after the migration for a month-shaped snapshot", () => {
    // THE equivalence that lets later phases ship ahead of the migration:
    // a backfilled period_start of date_trunc('month', snapshot_date) and the
    // NULL fallback must produce the same period, field for field.
    const beforeMigration = periodFromSnapshot({ snapshotDate: "2026-04-30" });
    const afterMigration = periodFromSnapshot({
      snapshotDate: "2026-04-30",
      periodStart: "2026-04-01",
    });
    expect(beforeMigration).toEqual(afterMigration);
    expect(beforeMigration.kind).toBe("month");
  });

  it("holds that equivalence across a leap February", () => {
    expect(periodFromSnapshot({ snapshotDate: "2028-02-29" })).toEqual(
      periodFromSnapshot({ snapshotDate: "2028-02-29", periodStart: "2028-02-01" })
    );
  });

  it("accepts Date columns as well as strings", () => {
    expect(periodFromSnapshot({ snapshotDate: new Date("2026-04-30T00:00:00Z") }).tag).toBe(
      "2026-04"
    );
  });

  it("throws on an unparseable snapshotDate — a snapshot with no date is broken", () => {
    expect(() => periodFromSnapshot({ snapshotDate: "" })).toThrow();
  });
});

describe("matchesPeriod", () => {
  it("matches a row tagged with any month the period touches", () => {
    expect(matchesPeriod("2026-04", APRIL)).toBe(true);
    for (const m of GRANT_WINDOW.months) {
      expect(matchesPeriod(m, GRANT_WINDOW)).toBe(true);
    }
  });

  it("rejects a month outside the period on either side", () => {
    expect(matchesPeriod("2026-03", APRIL)).toBe(false);
    expect(matchesPeriod("2026-05", APRIL)).toBe(false);
    expect(matchesPeriod("2026-01", GRANT_WINDOW)).toBe(false);
    expect(matchesPeriod("2026-08", GRANT_WINDOW)).toBe(false);
  });

  it("rejects a malformed tag that a >=/<= range check would have admitted", () => {
    // A full date typed into a month field sorts cleanly INSIDE the range:
    // '2026-04-15' >= '2026-02' and <= '2026-07' are both true, so a
    // lexicographic implementation pulls the row in and nothing says so.
    // Membership matches no member of `months` and drops it.
    expect("2026-04-15" >= "2026-02" && "2026-04-15" <= "2026-07").toBe(true);
    expect(matchesPeriod("2026-04-15", GRANT_WINDOW)).toBe(false);
    // Unpadded months are rejected too, by the same mechanism.
    expect(matchesPeriod("2026-4", GRANT_WINDOW)).toBe(false);
  });

  it("treats an untagged row as belonging to no period", () => {
    expect(matchesPeriod(null, APRIL)).toBe(false);
    expect(matchesPeriod(undefined, APRIL)).toBe(false);
    expect(matchesPeriod("", APRIL)).toBe(false);
    expect(matchesPeriod("   ", APRIL)).toBe(false);
  });

  it("ignores surrounding whitespace on an otherwise well-formed tag", () => {
    expect(matchesPeriod(" 2026-04 ", APRIL)).toBe(true);
  });
});

describe("dateInPeriod", () => {
  it("is inclusive at both ends", () => {
    expect(dateInPeriod("2026-04-01", APRIL)).toBe(true);
    expect(dateInPeriod("2026-04-30", APRIL)).toBe(true);
  });

  it("excludes the days either side", () => {
    expect(dateInPeriod("2026-03-31", APRIL)).toBe(false);
    expect(dateInPeriod("2026-05-01", APRIL)).toBe(false);
  });

  it("resolves a boundary month exactly, where a month tag cannot", () => {
    // A milestone completed 2026-02-03 carries the tag '2026-02', which the
    // grant window matches — but the real date is before the window opened.
    // This is why rows with real date columns use dateInPeriod.
    expect(matchesPeriod("2026-02", GRANT_WINDOW)).toBe(true);
    expect(dateInPeriod("2026-02-03", GRANT_WINDOW)).toBe(false);
    expect(dateInPeriod("2026-02-14", GRANT_WINDOW)).toBe(true);
  });

  it("compares UTC days, ignoring any time component", () => {
    expect(dateInPeriod("2026-04-30T23:59:00.000Z", APRIL)).toBe(true);
    expect(dateInPeriod(new Date("2026-04-15T12:00:00Z"), APRIL)).toBe(true);
  });

  it("is false for anything it cannot parse, rather than throwing", () => {
    expect(dateInPeriod("2026-04", APRIL)).toBe(false);
    expect(dateInPeriod(new Date("nope"), APRIL)).toBe(false);
    expect(dateInPeriod(undefined, APRIL)).toBe(false);
  });
});

describe("monthsInPeriod", () => {
  it("returns EXACTLY 1 for a 31-day month — not 1.018", () => {
    // The load-bearing short-circuit. 31 / 30.4375 = 1.0185, and dividing by
    // it would shift the burn rate of every already-published 31-day report
    // by 1.8% with no visible cause.
    expect(monthsInPeriod(periodOfMonth("2026-01"))).toBe(1);
  });

  it("returns exactly 1 for every calendar month, long or short", () => {
    for (const m of ["2026-01", "2026-02", "2026-04", "2028-02", "2026-12"]) {
      expect(monthsInPeriod(periodOfMonth(m))).toBe(1);
    }
  });

  it("normalises a custom period against 365.25/12", () => {
    const q = periodFromRange("2026-02-01", "2026-04-30");
    expect(q.days).toBe(89);
    expect(monthsInPeriod(q)).toBeCloseTo(89 / 30.4375, 10);
    // A quarter is about three months — close enough that runway derived from
    // it is not off by a month.
    expect(monthsInPeriod(q)).toBeCloseTo(2.92, 2);
  });

  it("makes a 181-day window six months, not one", () => {
    const p = periodFromRange("2026-02-14", "2026-08-13");
    expect(p.days).toBe(181);
    expect(monthsInPeriod(p)).toBeCloseTo(5.947, 3);
  });

  it("makes a year twelve months", () => {
    expect(monthsInPeriod(periodFromRange("2026-01-01", "2026-12-31"))).toBeCloseTo(12, 1);
  });
});

describe("monthsInDateRange", () => {
  /**
   * Exactly how `getLastMonthPeriod` (data-sync.ts:11-16) and the backfill
   * loop (trpc/routers/projects.ts:590-595) build a period: LOCAL-time
   * constructors, and an `end` carrying 23:59:59 rather than midnight. Every
   * assertion below runs against that real shape, because the two ways this
   * helper could be wrong — reading UTC fields, and subtracting raw
   * timestamps — are both invisible against tidy midnight-to-midnight inputs.
   */
  function syncPeriod(
    year: number,
    monthIndex: number
  ): { start: Date; end: Date } {
    return {
      start: new Date(year, monthIndex, 1),
      end: new Date(year, monthIndex + 1, 0, 23, 59, 59),
    };
  }

  it("returns EXACTLY 1 for every calendar month the sync path produces", () => {
    // The whole point. Every snapshot this product has ever written came from
    // one of these, so anything but exactly 1 restates published reports.
    for (let m = 0; m < 12; m++) {
      expect(monthsInDateRange(syncPeriod(2026, m))).toBe(1);
    }
    expect(monthsInDateRange(syncPeriod(2028, 1))).toBe(1); // leap February
  });

  it("does not depend on the local timezone offset of the running process", () => {
    // The trap this helper exists for: `start` is local midnight on the 1st,
    // which east of Greenwich is the PREVIOUS month in UTC. Reading UTC fields
    // here — directly, or by round-tripping through toISOString() into
    // periodFromRange — would classify a genuine calendar month as a custom
    // range and switch normalisation on for every monthly sync in that zone.
    const p = syncPeriod(2026, 3); // April 2026
    expect(p.start.getDate()).toBe(1);
    expect(monthsInDateRange(p)).toBe(1);
    // Documented rather than asserted as a claim about the runner: whatever
    // the offset, the local reading is the one that recovers the caller's month.
    expect(p.start.getMonth()).toBe(3);
    expect(p.end.getMonth()).toBe(3);
  });

  it("counts inclusive calendar days, not raw elapsed time", () => {
    // 23:59:59 on the last day is 29.99999 days after midnight on the 1st of a
    // 30-day month. `Math.round(elapsed / 86_400_000) + 1` reads that as 31.
    // Anchoring both endpoints to their calendar day first is what avoids it.
    const q = { start: new Date(2026, 1, 1), end: new Date(2026, 3, 30, 23, 59, 59) };
    expect(monthsInDateRange(q)).toBeCloseTo(89 / DAYS_PER_MONTH, 12);
    expect(monthsInDateRange(q)).not.toBeCloseTo(90 / DAYS_PER_MONTH, 12);
  });

  it("scales a six-month grant window to about six months", () => {
    const w = {
      start: new Date(2026, 1, 14),
      end: new Date(2026, 7, 13, 23, 59, 59),
    };
    expect(monthsInDateRange(w)).toBeCloseTo(181 / DAYS_PER_MONTH, 12);
    expect(monthsInDateRange(w)).toBeCloseTo(5.947, 3);
  });

  it("agrees with monthsInPeriod on the same window, month or custom", () => {
    // The two normalisation paths must not drift: one feeds the stored
    // runway_months column, the other every per-month figure in the report.
    expect(monthsInDateRange(syncPeriod(2026, 0))).toBe(
      monthsInPeriod(periodOfMonth("2026-01"))
    );
    expect(
      monthsInDateRange({
        start: new Date(2026, 1, 14),
        end: new Date(2026, 6, 31, 23, 59, 59),
      })
    ).toBeCloseTo(monthsInPeriod(periodFromRange("2026-02-14", "2026-07-31")), 12);
  });

  it("treats a partial month as the days it covers, not as a month", () => {
    // Starts on the 1st but stops early — month-shaped at one end only.
    const half = { start: new Date(2026, 3, 1), end: new Date(2026, 3, 15, 23, 59, 59) };
    expect(monthsInDateRange(half)).toBeCloseTo(15 / DAYS_PER_MONTH, 12);
  });

  it("is 1 for a single day, so a one-day window cannot explode the runway", () => {
    const day = { start: new Date(2026, 3, 10), end: new Date(2026, 3, 10, 23, 59, 59) };
    expect(monthsInDateRange(day)).toBeCloseTo(1 / DAYS_PER_MONTH, 12);
  });

  it("falls back to 1 — never NaN, never a throw — on unusable input", () => {
    // This runs inside a sync about to persist runway_months. NaN would reach
    // a numeric column the dashboard charts; a throw would cost the snapshot.
    // 1 degrades to the arithmetic the line used before normalisation existed.
    expect(monthsInDateRange({ start: new Date("nope"), end: new Date(2026, 3, 30) })).toBe(1);
    expect(monthsInDateRange({ start: new Date(2026, 3, 1), end: new Date("nope") })).toBe(1);
    expect(
      monthsInDateRange({ start: new Date(2026, 3, 30), end: new Date(2026, 3, 1) })
    ).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(monthsInDateRange({ start: "2026-04-01", end: "2026-04-30" } as any)).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(monthsInDateRange(undefined as any)).toBe(1);
  });
});

describe("the stored runway derivation (transaction-sync.ts fetchAndClassify)", () => {
  /**
   * A local restatement of the one line this helper exists to serve:
   *
   *     const periodMonths = monthsInDateRange(period);
   *     const burnPerMonthUsd = burnRateUsd / periodMonths;
   *     runwayMonths = burnRateUsd > 0 ? totalBalanceUsd / burnPerMonthUsd : null;
   *
   * transaction-sync.ts reaches Alchemy, the classifier and price-resolver at
   * module scope and is not unit-testable in this suite (no existing test
   * imports it). Pinning the arithmetic here is what stops the unit of
   * `runway_months` from silently changing again — the column is charted on
   * the dashboard tile and read as months by anomalies.ts.
   */
  function storedRunway(
    totalBalanceUsd: number,
    burnRateUsd: number,
    period: { start: Date; end: Date }
  ): number | null {
    const burnPerMonthUsd = burnRateUsd / monthsInDateRange(period);
    return burnRateUsd > 0 ? totalBalanceUsd / burnPerMonthUsd : null;
  }

  const APRIL_SYNC = {
    start: new Date(2026, 3, 1),
    end: new Date(2026, 3, 30, 23, 59, 59),
  };
  const JANUARY_SYNC = {
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, 31, 23, 59, 59),
  };
  /** 2026-02-01 → 2026-07-30 inclusive: 180 days. */
  const SIX_MONTH_SYNC = {
    start: new Date(2026, 1, 1),
    end: new Date(2026, 6, 30, 23, 59, 59),
  };

  it("leaves a calendar month's runway exactly where it was", () => {
    // The naive figure and the normalised one must be the SAME NUMBER, not
    // close: this is what every snapshot in the database was written with.
    expect(storedRunway(8_500_000, 320_000, APRIL_SYNC)).toBe(
      8_500_000 / 320_000
    );
    expect(storedRunway(8_500_000, 320_000, JANUARY_SYNC)).toBe(
      8_500_000 / 320_000
    );
  });

  it("makes a 180-day period's runway ~6x the naive figure, because it is", () => {
    // The bug: $1.92M spent over 180 days against an $8.5M treasury is 2.7
    // "periods" of runway — which the column would have called 2.7 MONTHS.
    // It is really about 16 months.
    const naive = 8_500_000 / 1_920_000;
    const normalised = storedRunway(8_500_000, 1_920_000, SIX_MONTH_SYNC);
    expect(naive).toBeCloseTo(4.43, 2);
    expect(normalised).toBeCloseTo(26.18, 2);
    expect(normalised! / naive).toBeCloseTo(180 / DAYS_PER_MONTH, 6);
  });

  it("still returns null rather than 0 or Infinity when nothing was spent", () => {
    expect(storedRunway(8_500_000, 0, SIX_MONTH_SYNC)).toBeNull();
    expect(storedRunway(8_500_000, 0, APRIL_SYNC)).toBeNull();
  });
});

describe("DAYS_PER_MONTH", () => {
  it("is 365.25/12 and is the only definition of a month length", () => {
    // Exported so burn-metrics.ts can normalise against the same value. Two
    // copies would let the trailing average and the current period's runway be
    // denominated differently inside one report, with nothing failing.
    expect(DAYS_PER_MONTH).toBe(30.4375);
    expect(DAYS_PER_MONTH).toBe(365.25 / 12);
  });
});

describe("longGapDaysFor", () => {
  it("returns exactly 45 for EVERY calendar month, whatever its length", () => {
    // This is the whole point of the `kind === "month"` short-circuit, and it
    // is a behaviour lock, not a coincidence of the formula. 28/29/30-day
    // months reach 45 via the floor, but a 31-day month computes 46.5 → 47.
    // Without the short-circuit, seven months of the year would silently widen
    // the threshold and suppress a long-gap disclosure that ships today.
    expect(longGapDaysFor(periodOfMonth("2026-02"))).toBe(45); // 28 days
    expect(longGapDaysFor(periodOfMonth("2028-02"))).toBe(45); // 29 days, leap
    expect(longGapDaysFor(periodOfMonth("2026-04"))).toBe(45); // 30 days
    expect(longGapDaysFor(periodOfMonth("2026-01"))).toBe(45); // 31 days
    expect(longGapDaysFor(periodOfMonth("2026-12"))).toBe(45); // 31 days
  });

  it("a month-length CUSTOM period still scales — the floor is not the rule", () => {
    // 31 days that are not a calendar month get the formula, not the
    // short-circuit: this is the case that proves the exemption is keyed on
    // `kind`, not on length.
    expect(longGapDaysFor(periodFromRange("2026-01-15", "2026-02-14"))).toBe(47);
  });

  it("scales with a long period rather than flagging every stale sync", () => {
    expect(longGapDaysFor(periodFromRange("2026-02-14", "2026-08-13"))).toBe(272);
  });

  it("never drops below the floor for a very short period", () => {
    expect(longGapDaysFor(periodFromRange("2026-04-10", "2026-04-10"))).toBe(45);
  });
});

describe("comparablePeriods", () => {
  it("admits February into an average of January-length months", () => {
    // 28 vs 31 is a 3-day difference against a floor of 7. If this were false,
    // every trailing burn average in the product would lose a month a year.
    const feb = periodOfMonth("2026-02");
    const jan = periodOfMonth("2026-01");
    expect(feb.days).toBe(28);
    expect(jan.days).toBe(31);
    expect(comparablePeriods(feb, jan)).toBe(true);
    expect(comparablePeriods(jan, feb)).toBe(true);
  });

  it("admits any two calendar months, in any order", () => {
    const months = ["2026-01", "2026-02", "2026-04", "2028-02"].map(periodOfMonth);
    for (const a of months) {
      for (const b of months) {
        expect(comparablePeriods(a, b)).toBe(true);
      }
    }
  });

  it("keeps a 181-day period out of an average of 30-day periods", () => {
    const month = periodFromRange("2026-04-01", "2026-04-30");
    const halfYear = periodFromRange("2026-02-14", "2026-08-13");
    expect(month.days).toBe(30);
    expect(halfYear.days).toBe(181);
    expect(comparablePeriods(month, halfYear)).toBe(false);
  });

  it("is deliberately asymmetric — the CURRENT period sets the tolerance", () => {
    // 60 vs 45: as the current period, 60 tolerates 15 days and admits 45.
    // As the current period, 45 tolerates 11.25 and rejects 60. Callers must
    // pass the period being measured first.
    const long = periodFromRange("2026-01-01", "2026-03-01"); // 60 days
    const short = periodFromRange("2026-01-01", "2026-02-14"); // 45 days
    expect(long.days).toBe(60);
    expect(short.days).toBe(45);
    expect(comparablePeriods(long, short)).toBe(true);
    expect(comparablePeriods(short, long)).toBe(false);
  });
});

describe("assertPeriodSupported", () => {
  it("accepts a period ending today", () => {
    expect(assertPeriodSupported(periodFromRange("2026-02-14", "2026-07-31"), "2026-07-31"))
      .toEqual({ ok: true });
  });

  it("accepts 'through yesterday' and one more day of timezone slop", () => {
    const p = periodOfMonth("2026-07"); // ends 2026-07-31
    expect(assertPeriodSupported(p, "2026-08-01").ok).toBe(true);
    expect(assertPeriodSupported(p, "2026-08-02").ok).toBe(true);
  });

  // P3.1 changed the rule this gate expresses. A past period is no longer
  // refused for being past — `projects.sync` reconstructs its balances and
  // discloses them — so the only remaining refusal is a period ending beyond
  // what any sync in this product can walk back to.
  it("accepts a period that ended weeks ago, now that it can be reconstructed", () => {
    expect(assertPeriodSupported(periodOfMonth("2026-07"), "2026-08-03").ok).toBe(true);
    expect(assertPeriodSupported(periodOfMonth("2026-04"), "2026-07-31").ok).toBe(true);
  });

  it("accepts a period at the edge of the reconstruction horizon", () => {
    // 12 months * 30.4375 = 365.25 days of tolerance from the period's end.
    expect(
      assertPeriodSupported(periodFromRange("2025-08-01", "2025-08-31"), "2026-07-31").ok
    ).toBe(true);
  });

  it("refuses a period beyond the reconstruction horizon, with the real cause", () => {
    const result = assertPeriodSupported(
      periodFromRange("2024-07-01", "2024-09-30"),
      "2026-07-31"
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("PERIOD_BEYOND_RECONSTRUCTION");
    expect(result.reason).toContain("2024-09-30");
    expect(result.reason).toContain("12 months");
    expect(result.reason).toContain("walked backwards");
  });

  it("no longer names historical reconstruction as the blocker — it exists now", () => {
    const result = assertPeriodSupported(
      periodFromRange("2020-01-01", "2020-01-31"),
      "2026-07-31"
    );
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).not.toContain("Historical reconstruction is planned");
    expect(result.reason).not.toContain("read live from chain");
  });

  it("allows a period ending in the future — a different problem, not this gate's", () => {
    expect(assertPeriodSupported(periodOfMonth("2026-12"), "2026-07-31").ok).toBe(true);
  });

  it("returns a result rather than throwing, so a UI can render the reason", () => {
    expect(() =>
      assertPeriodSupported(periodFromRange("2020-01-01", "2020-01-31"), "2026-07-31")
    ).not.toThrow();
  });

  it("throws on an unparseable clock — an auth gate must not fail open", () => {
    expect(() => assertPeriodSupported(APRIL, "whenever")).toThrow(/unparseable 'today'/);
  });

  it("accepts a Date for today", () => {
    expect(assertPeriodSupported(periodOfMonth("2026-07"), new Date("2026-07-31T18:00:00Z")).ok)
      .toBe(true);
  });
});

// в”Ђв”Ђв”Ђ Phase 4: the stored period в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
//
// These four helpers are the testable core of a change that otherwise lives in
// data-sync.ts and report-generator.ts, neither of which can be unit-tested at
// all (both import `db`), and whose migration cannot be run anywhere before a
// human applies it to production. Same reasoning that put the sampling rule in
// transaction-sample.ts: the decision moves here, the caller just calls it.

/**
 * The two Date constructors data-sync.ts's `getLastMonthPeriod` uses, verbatim.
 * LOCAL, deliberately вЂ” reproducing the skew is the point of these tests, and a
 * UTC-built fixture would test a code path the product does not have.
 */
function localMonthRange(year: number, month1: number) {
  return {
    start: new Date(year, month1 - 1, 1),
    end: new Date(year, month1, 0, 23, 59, 59),
  };
}
/** What data-sync.ts stores in `snapshot_date`, from the same range. */
function snapshotDateOf(range: { end: Date }) {
  return range.end.toISOString().split("T")[0];
}

describe("snapshotPeriodStart", () => {
  it("stores the first of the snapshot's month for a calendar month", () => {
    const june = localMonthRange(2026, 6);
    const snapshotDate = snapshotDateOf(june);
    expect(snapshotPeriodStart(june, snapshotDate)).toBe(
      `${snapshotDate.slice(0, 7)}-01`
    );
  });

  it("writing the column cannot change the period of a monthly snapshot", () => {
    // THE LOAD-BEARING INVARIANT. `periodFromSnapshot` reconstructs a NULL
    // period_start as the calendar month ending on snapshot_date. If storing a
    // value produced anything else, applying the migration would restate
    // reports that have already been sent. Asserted across a whole year so 28-,
    // 30- and 31-day months are all covered, and phrased against the fallback
    // rather than a literal so it holds in EVERY timezone: the naive
    // `period.start.toISOString()` fails this at UTC+2, where June converts to
    // 2026-05-31..2026-06-30 вЂ” 31 days, kind "custom", burn divided by 1.0185
    // and every published figure 1.8% off.
    for (let month = 1; month <= 12; month++) {
      const range = localMonthRange(2026, month);
      const snapshotDate = snapshotDateOf(range);
      const stored = periodFromSnapshot({
        snapshotDate,
        periodStart: snapshotPeriodStart(range, snapshotDate),
      });
      expect(stored).toEqual(periodFromSnapshot({ snapshotDate }));
    }
  });

  it("keeps a monthly sync on the calendar-month path, so nothing normalises", () => {
    const january = localMonthRange(2026, 1);
    const snapshotDate = snapshotDateOf(january);
    const period = periodFromSnapshot({
      snapshotDate,
      periodStart: snapshotPeriodStart(january, snapshotDate),
    });
    expect(period.kind).toBe("month");
    expect(monthsInPeriod(period)).toBe(1);
  });

  it("stores the real start for a window that is not a calendar month", () => {
    const grant = {
      start: new Date(2026, 1, 14),
      end: new Date(2026, 6, 31, 23, 59, 59),
    };
    const snapshotDate = snapshotDateOf(grant);
    // Asserted against the same UTC projection `snapshot_date` gets, so the
    // pair stays internally consistent whatever the generator's timezone.
    expect(snapshotPeriodStart(grant, snapshotDate)).toBe(
      grant.start.toISOString().split("T")[0]
    );
  });

  it("degrades to the calendar month rather than inventing an impossible range", () => {
    const snapshotDate = "2026-06-30";
    const backwards = {
      start: new Date(2026, 11, 1),
      end: new Date(2026, 5, 30, 23, 59, 59),
    };
    expect(snapshotPeriodStart(backwards, snapshotDate)).toBe("2026-06-01");
    const broken = { start: new Date("nope"), end: new Date("nope") };
    expect(snapshotPeriodStart(broken, snapshotDate)).toBe("2026-06-01");
  });

  it("throws on an unparseable snapshot date rather than guessing one", () => {
    expect(() =>
      snapshotPeriodStart(localMonthRange(2026, 6), "whenever")
    ).toThrow(/unparseable snapshotDate/);
  });
});

describe("snapshotPeriodConflicts", () => {
  it("allows a re-sync of the same period вЂ” the upsert must still overwrite", () => {
    const row = { snapshotDate: "2026-06-30", periodStart: "2026-06-01" };
    expect(snapshotPeriodConflicts(row, row).ok).toBe(true);
  });

  it("refuses a different period ending on the same day", () => {
    const result = snapshotPeriodConflicts(
      { snapshotDate: "2026-07-31", periodStart: "2026-07-01" },
      { snapshotDate: "2026-07-31", periodStart: "2026-02-14" }
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.existingStart).toBe("2026-07-01");
    expect(result.incomingStart).toBe("2026-02-14");
    // The refusal has to name the real cause, not "duplicate key".
    expect(result.reason).toContain("2026-07-31");
    expect(result.reason).toContain("2026-07-01");
    expect(result.reason).toContain("2026-02-14");
    expect(result.reason).toContain("under an existing report");
  });

  it("treats a NULL stored period_start as the calendar month, not as a waiver", () => {
    // THE DOCUMENTED CHOICE. Every row in the table is pre-backfill today, so
    // waiving the check on NULL would wave through the single most likely
    // instance of the bug: a grant window landing on an existing monthly
    // snapshot's date. Resolved through periodFromSnapshot instead.
    const preBackfill = { snapshotDate: "2026-07-31", periodStart: null };
    expect(
      snapshotPeriodConflicts(preBackfill, {
        snapshotDate: "2026-07-31",
        periodStart: "2026-07-01",
      }).ok
    ).toBe(true);
    expect(
      snapshotPeriodConflicts(preBackfill, {
        snapshotDate: "2026-07-31",
        periodStart: "2026-02-14",
      }).ok
    ).toBe(false);
  });

  it("treats an absent period_start field the same as a NULL one", () => {
    expect(
      snapshotPeriodConflicts(
        { snapshotDate: "2026-07-31" },
        { snapshotDate: "2026-07-31", periodStart: "2026-07-01" }
      ).ok
    ).toBe(true);
  });

  it("is not a conflict when there is no row to overwrite", () => {
    const incoming = { snapshotDate: "2026-07-31", periodStart: "2026-02-14" };
    expect(snapshotPeriodConflicts(null, incoming).ok).toBe(true);
    expect(snapshotPeriodConflicts(undefined, incoming).ok).toBe(true);
  });

  it("is not a conflict when the dates differ вЂ” different rows cannot collide", () => {
    expect(
      snapshotPeriodConflicts(
        { snapshotDate: "2026-06-30", periodStart: "2026-06-01" },
        { snapshotDate: "2026-07-31", periodStart: "2026-07-01" }
      ).ok
    ).toBe(true);
  });

  it("accepts Date values on either side", () => {
    expect(
      snapshotPeriodConflicts(
        { snapshotDate: new Date("2026-07-31T00:00:00Z"), periodStart: null },
        {
          snapshotDate: "2026-07-31",
          periodStart: new Date("2026-07-01T00:00:00Z"),
        }
      ).ok
    ).toBe(true);
  });

  it("fails open on unparseable input rather than losing a whole sync", () => {
    expect(
      snapshotPeriodConflicts(
        { snapshotDate: "not a date" },
        { snapshotDate: "2026-07-31", periodStart: "2026-02-14" }
      ).ok
    ).toBe(true);
    expect(() =>
      snapshotPeriodConflicts(
        { snapshotDate: "2026-07-31" },
        { snapshotDate: "also not a date" }
      )
    ).not.toThrow();
  });
});

describe("comparableTrailing", () => {
  const MONTHS = [
    { snapshotDate: "2026-06-30", periodStart: "2026-06-01" },
    { snapshotDate: "2026-05-31", periodStart: "2026-05-01" },
    { snapshotDate: "2026-04-30", periodStart: "2026-04-01" },
    { snapshotDate: "2026-03-31", periodStart: "2026-03-01" },
    { snapshotDate: "2026-02-28", periodStart: "2026-02-01" },
  ];

  it("is the identity for monthly snapshots вЂ” today's behaviour, unchanged", () => {
    // 28 vs 31 days is 3, against a floor of 7, so every calendar month is
    // comparable with every other and the first three survive, in order.
    expect(comparableTrailing(periodOfMonth("2026-07"), MONTHS)).toEqual(
      MONTHS.slice(0, 3)
    );
  });

  it("works identically before the backfill, with no period_start at all", () => {
    const preBackfill = MONTHS.map((m) => ({ snapshotDate: m.snapshotDate }));
    expect(comparableTrailing(periodOfMonth("2026-07"), preBackfill)).toEqual(
      preBackfill.slice(0, 3)
    );
  });

  it("skips an odd-length window and reaches further back to fill the slots", () => {
    const withGrantWindow = [
      MONTHS[0],
      { snapshotDate: "2026-05-31", periodStart: "2025-12-02" }, // 181 days
      MONTHS[2],
      MONTHS[3],
    ];
    expect(comparableTrailing(periodOfMonth("2026-07"), withGrantWindow)).toEqual([
      MONTHS[0],
      MONTHS[2],
      MONTHS[3],
    ]);
  });

  it("returns nothing for a first grant-window report, gating comparisons off", () => {
    // Correct, not a loss: month-over-month, the forecast and anomalies all
    // read `trailing`, and none of them can honestly compare 168 days to 30.
    expect(comparableTrailing(GRANT_WINDOW, MONTHS)).toEqual([]);
  });

  it("respects the limit and its edges", () => {
    expect(comparableTrailing(periodOfMonth("2026-07"), MONTHS, 1)).toEqual([
      MONTHS[0],
    ]);
    expect(comparableTrailing(periodOfMonth("2026-07"), MONTHS, 0)).toEqual([]);
    expect(comparableTrailing(periodOfMonth("2026-07"), MONTHS, 99)).toEqual(
      MONTHS
    );
  });

  it("skips a malformed candidate instead of failing the whole report", () => {
    const withJunk = [{ snapshotDate: "nope" }, ...MONTHS];
    expect(comparableTrailing(periodOfMonth("2026-07"), withJunk)).toEqual(
      MONTHS.slice(0, 3)
    );
  });

  it("returns an empty list for a missing or non-array input", () => {
    expect(comparableTrailing(APRIL, null)).toEqual([]);
    expect(comparableTrailing(APRIL, undefined)).toEqual([]);
    expect(comparableTrailing(APRIL, [])).toEqual([]);
  });
});

describe("burnPeriodDays", () => {
  it("is undefined for a calendar month вЂ” the field's 'exactly one month'", () => {
    expect(
      burnPeriodDays({ snapshotDate: "2026-04-30", periodStart: "2026-04-01" })
    ).toBeUndefined();
  });

  it("is undefined for a 31-day January, the 1.8% restatement trap", () => {
    // A raw day count cannot carry the exemption: 31 is a January AND an
    // arbitrary 31-day window. Passing 31 here would divide January's burn by
    // 1.0185 and restate every already-published 31-day report.
    expect(
      burnPeriodDays({ snapshotDate: "2026-01-31", periodStart: "2026-01-01" })
    ).toBeUndefined();
  });

  it("is undefined before the backfill, so legacy rows normalise by 1", () => {
    expect(burnPeriodDays({ snapshotDate: "2026-04-30" })).toBeUndefined();
    expect(
      burnPeriodDays({ snapshotDate: "2026-04-30", periodStart: null })
    ).toBeUndefined();
  });

  it("is the day count for a genuine custom window", () => {
    expect(
      burnPeriodDays({ snapshotDate: "2026-07-31", periodStart: "2026-02-14" })
    ).toBe(168);
    // An arbitrary 30-day window is NOT exempt, unlike the January above.
    expect(
      burnPeriodDays({ snapshotDate: "2026-07-31", periodStart: "2026-07-02" })
    ).toBe(30);
  });

  it("is undefined for unusable input rather than poisoning an average", () => {
    expect(burnPeriodDays(null)).toBeUndefined();
    expect(burnPeriodDays(undefined)).toBeUndefined();
    expect(burnPeriodDays({ snapshotDate: "nope" })).toBeUndefined();
    // The shape report-sections.test.ts uses for its trailing fixtures.
    expect(
      burnPeriodDays({} as unknown as { snapshotDate: string })
    ).toBeUndefined();
  });
});
