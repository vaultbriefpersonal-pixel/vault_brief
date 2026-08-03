import { describe, it, expect } from "vitest";
import {
  REMINDER_LEAD_DAYS,
  reminderCutoffDate,
  isAwardDueForReminder,
} from "./grant-report-reminders";

describe("reminderCutoffDate", () => {
  it("adds REMINDER_LEAD_DAYS to today, in UTC", () => {
    const today = new Date("2026-08-03T12:00:00Z");
    expect(reminderCutoffDate(today)).toBe("2026-08-10");
  });

  it("respects an explicit lead-days override", () => {
    const today = new Date("2026-08-03T12:00:00Z");
    expect(reminderCutoffDate(today, 0)).toBe("2026-08-03");
    expect(reminderCutoffDate(today, 30)).toBe("2026-09-02");
  });

  it("rolls over a month boundary correctly", () => {
    const today = new Date("2026-08-28T00:00:00Z");
    expect(reminderCutoffDate(today, REMINDER_LEAD_DAYS)).toBe("2026-09-04");
  });

  it("rolls over a year boundary correctly", () => {
    const today = new Date("2026-12-28T00:00:00Z");
    expect(reminderCutoffDate(today, REMINDER_LEAD_DAYS)).toBe("2027-01-04");
  });

  it("is unaffected by the time-of-day component (uses UTC calendar fields, not epoch millis)", () => {
    const earlyUtc = new Date("2026-08-03T00:01:00Z");
    const lateUtc = new Date("2026-08-03T23:59:00Z");
    expect(reminderCutoffDate(earlyUtc)).toBe(reminderCutoffDate(lateUtc));
  });
});

describe("isAwardDueForReminder", () => {
  const CUTOFF = "2026-08-10";

  it("is due when the award is active, has a due date at or before cutoff, and was never reminded", () => {
    expect(
      isAwardDueForReminder(
        { status: "active", nextReportDue: "2026-08-10", lastRemindedAt: null },
        CUTOFF
      )
    ).toBe(true);
  });

  it("is due when the due date has already passed (overdue is more useful than no reminder)", () => {
    expect(
      isAwardDueForReminder(
        { status: "active", nextReportDue: "2026-01-01", lastRemindedAt: null },
        CUTOFF
      )
    ).toBe(true);
  });

  it("is NOT due when the due date is beyond the lead-time window", () => {
    expect(
      isAwardDueForReminder(
        { status: "active", nextReportDue: "2026-08-11", lastRemindedAt: null },
        CUTOFF
      )
    ).toBe(false);
  });

  it("is NOT due when the award is not active", () => {
    for (const status of ["completed", "terminated"]) {
      expect(
        isAwardDueForReminder(
          { status, nextReportDue: "2026-08-01", lastRemindedAt: null },
          CUTOFF
        )
      ).toBe(false);
    }
  });

  it("is NOT due when there is no due date set", () => {
    expect(
      isAwardDueForReminder(
        { status: "active", nextReportDue: null, lastRemindedAt: null },
        CUTOFF
      )
    ).toBe(false);
  });

  it("is NOT due when it was already reminded for the current due date", () => {
    expect(
      isAwardDueForReminder(
        {
          status: "active",
          nextReportDue: "2026-08-01",
          lastRemindedAt: new Date("2026-08-01T09:00:00Z"),
        },
        CUTOFF
      )
    ).toBe(false);
  });
});
