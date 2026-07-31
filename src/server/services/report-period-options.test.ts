import { describe, it, expect } from "vitest";
import {
  backfillMonthsToCover,
  buildPeriodOptions,
  resolvePeriodOption,
  snapshotCovering,
  type PeriodSnapshotChoice,
} from "./report-period-options";
import { periodFromRange, periodOfMonth } from "./report-period";

/**
 * The clock every test runs against. Deliberately the LAST DAY of a month, the
 * shape that makes "last completed month" ambiguous if the arithmetic is wrong:
 * on 2026-07-31 the last completed month is June, not July.
 */
const TODAY = "2026-07-31";

function snap(
  id: string,
  snapshotDate: string,
  periodStart: string | null = null,
  basis: "observed" | "reconstructed" = "observed"
): PeriodSnapshotChoice {
  return {
    id,
    snapshotDate,
    periodStart,
    basis,
    reconstruction:
      basis === "reconstructed"
        ? {
            observedAsOf: "2026-06-30",
            stepsFromObserved: 2,
            clampedPositions: 1,
            unpricedPositions: 0,
            unpricedSymbols: [],
            unpricedShareOfTotal: 0,
            carriedForwardWallets: [],
            notes: ["Native-token gas is not a transfer, so this balance is a floor."],
          }
        : null,
  };
}

/** Three consecutive monthly snapshots, the newest observed. */
const MONTHLY: PeriodSnapshotChoice[] = [
  snap("s-jun", "2026-06-30"),
  snap("s-may", "2026-05-31", null, "reconstructed"),
  snap("s-apr", "2026-04-30", null, "reconstructed"),
];

describe("snapshotCovering", () => {
  it("matches a snapshot whose window is exactly the period", () => {
    expect(snapshotCovering(periodOfMonth("2026-05"), MONTHLY)?.id).toBe("s-may");
  });

  it("returns null for a window no snapshot covers", () => {
    expect(snapshotCovering(periodOfMonth("2026-03"), MONTHLY)).toBeNull();
  });

  it("REFUSES a snapshot that merely CONTAINS the period", () => {
    // A grant snapshot spanning Feb–Jun does not license a report labelled
    // "June": its flow columns are totals over the whole window, so reporting
    // them under a one-month label would overstate every one of them.
    const grant = [snap("s-grant", "2026-06-30", "2026-02-14")];
    expect(snapshotCovering(periodOfMonth("2026-06"), grant)).toBeNull();
  });

  it("refuses a snapshot that shares only the end date", () => {
    const grant = [snap("s-grant", "2026-06-30", "2026-02-14")];
    expect(
      snapshotCovering(periodFromRange("2026-02-14", "2026-06-30"), grant)?.id
    ).toBe("s-grant");
    expect(
      snapshotCovering(periodFromRange("2026-02-15", "2026-06-30"), grant)
    ).toBeNull();
  });

  it("steps over a row with an unreadable date instead of throwing", () => {
    const rows = [
      { id: "bad", snapshotDate: "not-a-date", basis: "observed" as const, reconstruction: null },
      ...MONTHLY,
    ];
    expect(snapshotCovering(periodOfMonth("2026-06"), rows)?.id).toBe("s-jun");
  });
});

describe("backfillMonthsToCover", () => {
  it("says 1 for the last completed month", () => {
    expect(backfillMonthsToCover(periodOfMonth("2026-06"), TODAY)).toBe(1);
  });

  it("counts back from the last completed month, not from today's month", () => {
    expect(backfillMonthsToCover(periodOfMonth("2026-05"), TODAY)).toBe(2);
    expect(backfillMonthsToCover(periodOfMonth("2026-04"), TODAY)).toBe(3);
  });

  it("crosses a year boundary by month index", () => {
    expect(backfillMonthsToCover(periodOfMonth("2025-08"), TODAY)).toBe(11);
  });

  it("refuses the in-progress month — no sync ever snapshots it", () => {
    expect(backfillMonthsToCover(periodOfMonth("2026-07"), TODAY)).toBeNull();
  });

  it("refuses past the 12-month ceiling projects.sync itself enforces", () => {
    expect(backfillMonthsToCover(periodOfMonth("2025-07"), TODAY)).toBe(12);
    expect(backfillMonthsToCover(periodOfMonth("2025-06"), TODAY)).toBeNull();
  });

  it("refuses a window that is not a calendar month — no sync can produce one", () => {
    expect(
      backfillMonthsToCover(periodFromRange("2026-02-14", "2026-06-30"), TODAY)
    ).toBeNull();
    // A whole quarter is month-ALIGNED but is not a month, and sync writes one
    // row per month, never one row spanning three.
    expect(
      backfillMonthsToCover(periodFromRange("2026-04-01", "2026-06-30"), TODAY)
    ).toBeNull();
  });
});

describe("resolvePeriodOption", () => {
  it("enables a period a snapshot covers exactly, and reports its basis", () => {
    const r = resolvePeriodOption(periodOfMonth("2026-06"), MONTHLY, TODAY);
    expect(r.disabledReason).toBeNull();
    expect(r.snapshotId).toBe("s-jun");
    expect(r.basis).toBe("observed");
  });

  it("surfaces a reconstructed basis rather than hiding it", () => {
    const r = resolvePeriodOption(periodOfMonth("2026-05"), MONTHLY, TODAY);
    expect(r.disabledReason).toBeNull();
    expect(r.basis).toBe("reconstructed");
    expect(r.reconstruction?.stepsFromObserved).toBe(2);
  });

  it("disables an uncovered month and names the sync depth that would fix it", () => {
    const r = resolvePeriodOption(periodOfMonth("2026-03"), MONTHLY, TODAY);
    expect(r.snapshotId).toBeNull();
    expect(r.disabledReason).toContain("No snapshot covers March 2026");
    // June=1, May=2, April=3, March=4 — counted from the last COMPLETED month.
    expect(r.disabledReason).toContain("Last 4 months");
  });

  it("disables a non-month window and says the product cannot produce one", () => {
    const r = resolvePeriodOption(
      periodFromRange("2026-04-01", "2026-06-30"),
      MONTHLY,
      TODAY
    );
    expect(r.snapshotId).toBeNull();
    expect(r.disabledReason).toContain("whole calendar months");
    expect(r.disabledReason).not.toContain("Sync now");
  });

  it("checks the reconstruction horizon BEFORE coverage", () => {
    // Otherwise a founder is told to run a backfill that projects.sync refuses.
    const r = resolvePeriodOption(periodOfMonth("2024-01"), MONTHLY, TODAY);
    expect(r.disabledReason).toContain("beyond the 12 months");
    expect(r.disabledReason).not.toContain("Sync now");
  });
});

describe("buildPeriodOptions", () => {
  const base = { snapshots: MONTHLY, today: TODAY };

  it("offers the latest synced period first, enabled and selectable", () => {
    const [first] = buildPeriodOptions(base);
    expect(first.id).toBe("latest");
    expect(first.label).toContain("June 2026");
    expect(first.disabledReason).toBeNull();
    expect(first.snapshotId).toBe("s-jun");
  });

  it("resolves the latest period to the SAME window a default generate uses", () => {
    // The back-compat guarantee: picking nothing and picking "latest" must be
    // the same report.
    const [first] = buildPeriodOptions(base);
    expect(first.period?.start).toBe("2026-06-01");
    expect(first.period?.end).toBe("2026-06-30");
    expect(first.period?.kind).toBe("month");
  });

  it("anchors every preset to the newest snapshot, never to today", () => {
    // Anchoring to `today` would claim a window whose final days have no data
    // at all — the treasury has not been read since the last sync.
    const opts = buildPeriodOptions(base);
    for (const o of opts) {
      if (o.period) expect(o.period.end <= "2026-06-30").toBe(true);
    }
  });

  it("offers 'since last report' starting the day AFTER the previous period", () => {
    const opts = buildPeriodOptions({
      ...base,
      lastReportPeriodEnd: "2026-05-31",
    });
    const o = opts.find((x) => x.id === "since_last_report")!;
    expect(o.period?.start).toBe("2026-06-01");
    expect(o.period?.end).toBe("2026-06-30");
    // Which happens to be exactly June, so it resolves.
    expect(o.disabledReason).toBeNull();
    expect(o.snapshotId).toBe("s-jun");
  });

  it("disables 'since last report' when the last report already covers everything", () => {
    const opts = buildPeriodOptions({
      ...base,
      lastReportPeriodEnd: "2026-06-30",
    });
    const o = opts.find((x) => x.id === "since_last_report")!;
    expect(o.period).toBeNull();
    expect(o.disabledReason).toContain("already covers everything");
  });

  it("explains rather than hides the absence of a grant award", () => {
    const o = buildPeriodOptions(base).find((x) => x.id === "since_grant_award")!;
    expect(o.disabledReason).toContain("No grant award is recorded");
  });

  it("builds one option per grant award, from its reporting start date", () => {
    const opts = buildPeriodOptions({
      ...base,
      grantAwards: [
        {
          id: "ga1",
          grantor: "Optimism Foundation",
          awardDate: "2026-02-01",
          reportingStartDate: "2026-02-14",
        },
      ],
    });
    const o = opts.find((x) => x.id === "since_grant_award:ga1")!;
    expect(o.label).toBe("Since Optimism Foundation award");
    expect(o.period?.start).toBe("2026-02-14");
    expect(o.period?.end).toBe("2026-06-30");
    // No snapshot spans that window — every snapshot is a calendar month.
    expect(o.snapshotId).toBeNull();
    expect(o.disabledReason).toContain("whole calendar months");
  });

  it("does not invent a window for an award dated after the newest snapshot", () => {
    const opts = buildPeriodOptions({
      ...base,
      grantAwards: [{ id: "ga2", grantor: "ENS DAO", awardDate: "2026-07-01" }],
    });
    const o = opts.find((x) => x.id === "since_grant_award:ga2")!;
    expect(o.period).toBeNull();
    expect(o.disabledReason).toContain("after the newest snapshot");
  });

  it("counts a trailing window inclusively at both ends", () => {
    const o = buildPeriodOptions(base).find((x) => x.id === "last_30_days")!;
    expect(o.period?.days).toBe(30);
    expect(o.period?.end).toBe("2026-06-30");
    expect(o.period?.start).toBe("2026-06-01");
  });

  it("keeps 90 days at 90 days across month boundaries", () => {
    const o = buildPeriodOptions(base).find((x) => x.id === "last_90_days")!;
    expect(o.period?.days).toBe(90);
    expect(o.period?.start).toBe("2026-04-02");
  });

  it("always ends with a selectable custom entry carrying no window", () => {
    const opts = buildPeriodOptions(base);
    const last = opts[opts.length - 1];
    expect(last.id).toBe("custom");
    expect(last.period).toBeNull();
    expect(last.disabledReason).toBeNull();
  });

  it("offers every preset, disabled with a reason, when nothing is synced", () => {
    const opts = buildPeriodOptions({ snapshots: [], today: TODAY });
    const presets = opts.filter((o) => o.id !== "custom");
    expect(presets.length).toBeGreaterThan(0);
    for (const o of presets) {
      expect(o.disabledReason).not.toBeNull();
      expect(o.snapshotId).toBeNull();
    }
  });
});
