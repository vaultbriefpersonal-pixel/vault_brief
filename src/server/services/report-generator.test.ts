import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  cacheKey,
  isOutputCacheable,
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

// Stage 10 fix #3: `cacheKey` grows two optional trailing params
// (grantId/presetId) so `llm_cache` rows stop being ambiguous across
// differently-scoped generations. The one property that MUST hold is that
// the untouched-opts path — every report generated before this stage, and
// every automatic path that never populates grantId/presetId — hashes
// IDENTICALLY to the old 3-arg formula, so no existing `llm_cache` row is
// orphaned. This is the critical regression test the plan calls for.
describe("cacheKey — the default (no grantId, no presetId) path is byte-identical to pre-Stage-10", () => {
  const system = "SYSTEM PROMPT";
  const user = "USER PROMPT";
  const model = "google/gemini-2.5-flash";

  // The exact pre-fix formula: `${model}\0${system}\0${user}`, NUL-separated
  // — see report-generator.ts's own note on why this file uses literal NUL
  // bytes as a separator instead of a printable one.
  const preFixHash = createHash("sha256")
    .update(`${model}\0${system}\0${user}`)
    .digest("hex");

  it("matches the pre-fix hash when grantId/presetId are simply omitted", () => {
    expect(cacheKey(system, user, model)).toBe(preFixHash);
  });

  it("matches the pre-fix hash when grantId/presetId are explicitly undefined", () => {
    expect(cacheKey(system, user, model, undefined, undefined)).toBe(preFixHash);
  });

  it("matches the pre-fix hash when grantId/presetId are explicitly null", () => {
    expect(cacheKey(system, user, model, null, null)).toBe(preFixHash);
  });
});

describe("cacheKey — a grantId or presetId changes the hash", () => {
  const system = "SYSTEM PROMPT";
  const user = "USER PROMPT";
  const model = "google/gemini-2.5-flash";
  const base = cacheKey(system, user, model);

  it("diverges from the base hash when only grantId is set", () => {
    expect(cacheKey(system, user, model, "grant-1")).not.toBe(base);
  });

  it("diverges from the base hash when only presetId is set", () => {
    expect(cacheKey(system, user, model, undefined, "preset-1")).not.toBe(base);
  });

  it("diverges between two different grantIds (same everything else)", () => {
    expect(cacheKey(system, user, model, "grant-1")).not.toBe(
      cacheKey(system, user, model, "grant-2")
    );
  });

  it("is deterministic for the same inputs", () => {
    expect(cacheKey(system, user, model, "grant-1", "preset-1")).toBe(
      cacheKey(system, user, model, "grant-1", "preset-1")
    );
  });
});

// Real production incident: a 473-character completion, cut off mid-sentence,
// was cached unconditionally under the old rule ("non-empty is enough") and
// then replayed byte-for-byte on every Regenerate, since `llm_cache` has no
// TTL or eviction. `isOutputCacheable` is the fix, pulled out as a pure
// predicate for the same reason `cacheKey` itself is exported — `callLLM`
// needs a DB + a real/mocked OpenRouter client to exercise directly.
describe("isOutputCacheable", () => {
  it("refuses to cache an empty completion regardless of validation", () => {
    expect(isOutputCacheable("", { passed: true })).toBe(false);
  });

  it("refuses to cache a non-empty completion that failed validation", () => {
    expect(isOutputCacheable("some text", { passed: false })).toBe(false);
  });

  it("allows caching a non-empty completion that passed validation", () => {
    expect(isOutputCacheable("some text", { passed: true })).toBe(true);
  });
});
