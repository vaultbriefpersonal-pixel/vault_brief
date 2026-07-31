import { describe, it, expect } from "vitest";
import {
  periodFromRange,
  periodOfMonth,
  periodFromSnapshot,
  matchesPeriod,
  dateInPeriod,
  monthsInPeriod,
  longGapDaysFor,
  comparablePeriods,
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

  it("refuses the day tolerance runs out", () => {
    expect(assertPeriodSupported(periodOfMonth("2026-07"), "2026-08-03").ok).toBe(false);
  });

  it("refuses a past period with the real cause, not a generic error", () => {
    // Balances are read live (fetchAllBalances takes no period argument), so a
    // report for Q3 2025 would print today's balances under a 2025 date with
    // nothing in the output saying so.
    const result = assertPeriodSupported(
      periodFromRange("2025-07-01", "2025-09-30"),
      "2026-07-31"
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("PAST_PERIOD_UNSUPPORTED");
    expect(result.reason).toContain("2025-09-30");
    expect(result.reason).toContain("read live from chain");
    expect(result.reason).toContain("Historical reconstruction is planned");
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
