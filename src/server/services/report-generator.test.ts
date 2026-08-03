import { describe, it, expect } from "vitest";
import {
  narrowGrantDataForReport,
  resolveStoredSectionsForReport,
} from "./report-generator";
import type { GrantAward, GrantTranche } from "@/server/db/schema";

// `generateReport` itself hits the database (treasury snapshots, milestones,
// grant awards, presets) and has no existing unit test exercising its full
// pipeline — it is integration-verified only (see the plan's end-to-end
// checklist). Stage 6 adds exactly two pieces of NEW decision logic inside
// it: which grant rows survive the fetch, and which section config feeds
// `buildReportPrompts`. Both were pulled out as pure functions specifically
// so the byte-identity requirement — "a `reports.generate` call with neither
// `grantId` nor `presetId` must be unchanged" — is checkable without a
// database, at exactly the layer where a regression would actually live.
//
// If either function ever returns something different for an
// omitted/undefined/null opt, `generateReport`'s untouched-opts path stops
// being the pre-Stage-6 code, silently.

const AWARD_A: GrantAward = { id: "award-a" } as unknown as GrantAward;
const AWARD_B: GrantAward = { id: "award-b" } as unknown as GrantAward;
const TRANCHE_A1: GrantTranche = {
  id: "t1",
  grantAwardId: "award-a",
} as unknown as GrantTranche;
const TRANCHE_B1: GrantTranche = {
  id: "t2",
  grantAwardId: "award-b",
} as unknown as GrantTranche;

describe("narrowGrantDataForReport — the untouched-opts path must be identity", () => {
  const awards = [AWARD_A, AWARD_B];
  const tranches = [TRANCHE_A1, TRANCHE_B1];

  it("returns the exact same arrays (by reference) when grantId is omitted", () => {
    const result = narrowGrantDataForReport(awards, tranches);
    expect(result.grantAwardRows).toBe(awards);
    expect(result.grantTrancheRows).toBe(tranches);
  });

  it("returns the exact same arrays when grantId is undefined", () => {
    const result = narrowGrantDataForReport(awards, tranches, undefined);
    expect(result.grantAwardRows).toBe(awards);
    expect(result.grantTrancheRows).toBe(tranches);
  });

  it("returns the exact same arrays when grantId is null", () => {
    const result = narrowGrantDataForReport(awards, tranches, null);
    expect(result.grantAwardRows).toBe(awards);
    expect(result.grantTrancheRows).toBe(tranches);
  });

  it("narrows to the one matching award and its tranches when grantId is set", () => {
    const result = narrowGrantDataForReport(awards, tranches, "award-b");
    expect(result.grantAwardRows).toEqual([AWARD_B]);
    expect(result.grantTrancheRows).toEqual([TRANCHE_B1]);
  });

  it("narrows to an empty set for a grantId that matches nothing fetched", () => {
    const result = narrowGrantDataForReport(awards, tranches, "does-not-exist");
    expect(result.grantAwardRows).toEqual([]);
    expect(result.grantTrancheRows).toEqual([]);
  });
});

describe("resolveStoredSectionsForReport — the untouched-opts path must be identity", () => {
  const projectSections = [
    { id: "executive_summary", enabled: true },
    { id: "wins", enabled: false },
  ];
  const presetSections = [{ id: "grant_fund_usage", enabled: true }];

  it("returns the project's own sections unchanged when presetId is omitted", () => {
    expect(
      resolveStoredSectionsForReport(projectSections, undefined, undefined)
    ).toBe(projectSections);
  });

  it("returns the project's own sections unchanged when presetId is null", () => {
    expect(resolveStoredSectionsForReport(projectSections, null, undefined)).toBe(
      projectSections
    );
  });

  it("returns null unchanged when the project has no stored sections and no preset is requested", () => {
    expect(resolveStoredSectionsForReport(null, undefined, undefined)).toBeNull();
  });

  it("uses the preset's blockConfig, not the project's, when presetId is set", () => {
    expect(
      resolveStoredSectionsForReport(projectSections, "preset-1", presetSections)
    ).toBe(presetSections);
  });

  it("falls back to null (not the project's sections) when presetId is set but the config is missing", () => {
    // Defensive case only — the caller (generateReport) throws before this
    // path is reached in practice, since a presetId with no matching row is
    // an error, not a silent fallback to the project's own template.
    expect(
      resolveStoredSectionsForReport(projectSections, "preset-1", null)
    ).toBeNull();
  });
});
