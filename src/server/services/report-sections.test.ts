import { describe, it, expect } from "vitest";
import {
  resolveSections,
  SECTION_LIBRARY,
  type SectionConfigEntry,
} from "./report-sections";

// These tests are about ordering, not content, so everything is asserted on
// id arrays. Ordering is load-bearing: buildSystemPrompt joins the fragments
// in sequence and tells the model to emit sections "in the order shown", so a
// section landing in the wrong slot changes the shape of a real report.

const LIBRARY_IDS = SECTION_LIBRARY.map((s) => s.id);
const DEFAULT_IDS = SECTION_LIBRARY.filter((s) => s.defaultEnabled).map(
  (s) => s.id
);

function ids(stored: SectionConfigEntry[] | null): string[] {
  return resolveSections(stored).map((s) => s.id);
}

/** A stored config listing the whole library, enabled, in library order. */
function fullConfig(): SectionConfigEntry[] {
  return LIBRARY_IDS.map((id) => ({ id, enabled: true }));
}

describe("resolveSections — no stored config", () => {
  it("returns library defaults in library order when stored is null", () => {
    expect(ids(null)).toEqual(DEFAULT_IDS);
  });

  it("returns library defaults in library order when stored is empty", () => {
    expect(ids([])).toEqual(DEFAULT_IDS);
  });
});

describe("resolveSections — stored config covers the library", () => {
  it("is a no-op when every library section is listed", () => {
    expect(ids(fullConfig())).toEqual(LIBRARY_IDS);
  });

  it("preserves a deliberate reorder when every section is listed", () => {
    const reversed = [...LIBRARY_IDS].reverse();
    const stored = reversed.map((id) => ({ id, enabled: true }));
    expect(ids(stored)).toEqual(reversed);
  });
});

describe("resolveSections — sections missing from the stored config", () => {
  it("splices a missing middle section to its library position, not the tail", () => {
    // treasury_overview sits at library index 3, between lows_concerns and
    // treasury_by_chain. A founder who saved before it existed has a config
    // without it.
    const stored = fullConfig().filter((e) => e.id !== "treasury_overview");
    const result = ids(stored);

    expect(result).toEqual(LIBRARY_IDS);
    expect(result.at(-1)).not.toBe("treasury_overview");
    expect(result[result.indexOf("lows_concerns") + 1]).toBe(
      "treasury_overview"
    );
  });

  it("keeps several consecutive missing sections in their relative order", () => {
    const omitted = [
      "treasury_by_chain",
      "previous_month_comparison",
      "financial_health",
    ];
    const stored = fullConfig().filter((e) => !omitted.includes(e.id));
    const result = ids(stored);

    expect(result).toEqual(LIBRARY_IDS);
    // Not just "all present" — the run must not have stacked up backwards.
    expect(result.indexOf("treasury_by_chain")).toBeLessThan(
      result.indexOf("previous_month_comparison")
    );
    expect(result.indexOf("previous_month_comparison")).toBeLessThan(
      result.indexOf("financial_health")
    );
  });

  it("splices a missing first section to the front", () => {
    const stored = fullConfig().filter((e) => e.id !== "executive_summary");
    expect(ids(stored)[0]).toBe("executive_summary");
  });

  it("does not rewrite a user's deliberate reorder", () => {
    // The important regression. This founder moved token_metrics up to second
    // and dropped lows_concerns below treasury_overview — the fix must splice
    // the one missing section in without "correcting" any of that.
    const stored: SectionConfigEntry[] = [
      { id: "executive_summary", enabled: true },
      { id: "token_metrics", enabled: true },
      { id: "wins", enabled: true },
      { id: "treasury_overview", enabled: true },
      { id: "lows_concerns", enabled: true },
      { id: "anomalies", enabled: true },
    ];
    const result = ids(stored);
    const configured = stored.map((e) => e.id);

    // The founder's own sequence survives verbatim as a subsequence.
    expect(result.filter((id) => configured.includes(id))).toEqual(configured);
    // And every unlisted default still made it in.
    for (const id of DEFAULT_IDS) expect(result).toContain(id);
  });

  it("anchors a spliced section on its nearest present library predecessor", () => {
    // Library order is [... treasury_overview, treasury_by_chain,
    // previous_month_comparison ...]. With treasury_by_chain unlisted and the
    // list reordered, it belongs directly after treasury_overview — wherever
    // the founder happened to put that.
    const stored: SectionConfigEntry[] = [
      { id: "anomalies", enabled: true },
      { id: "treasury_overview", enabled: true },
      { id: "executive_summary", enabled: true },
    ];
    const result = ids(stored);
    expect(result[result.indexOf("treasury_overview") + 1]).toBe(
      "treasury_by_chain"
    );
  });
});

describe("resolveSections — entries that must not surface", () => {
  it("ignores unknown ids in the stored config", () => {
    const stored: SectionConfigEntry[] = [
      { id: "executive_summary", enabled: true },
      { id: "a_section_removed_in_a_deploy", enabled: true },
      { id: "wins", enabled: true },
    ];
    const result = ids(stored);
    expect(result).not.toContain("a_section_removed_in_a_deploy");
    expect(result.slice(0, 2)).toEqual(["executive_summary", "wins"]);
  });

  it("does not re-add an explicitly disabled section", () => {
    const stored = fullConfig().map((e) =>
      e.id === "treasury_overview" ? { ...e, enabled: false } : e
    );
    expect(ids(stored)).not.toContain("treasury_overview");
  });

  it("keeps a disabled section out even when it sits mid-library", () => {
    // Disabled *and* surrounded by missing entries — the splice pass walks the
    // whole library, so this is where a botched `seenIds` check would show up.
    const stored: SectionConfigEntry[] = [
      { id: "executive_summary", enabled: true },
      { id: "treasury_by_chain", enabled: false },
      { id: "financial_health", enabled: true },
    ];
    const result = ids(stored);
    expect(result).not.toContain("treasury_by_chain");
    expect(result).toContain("treasury_overview"); // unlisted default, spliced in
  });

  it("does not splice in sections that are off by default", () => {
    const offByDefault = SECTION_LIBRARY.filter((s) => !s.defaultEnabled).map(
      (s) => s.id
    );
    expect(offByDefault.length).toBeGreaterThan(0);
    const result = ids([{ id: "executive_summary", enabled: true }]);
    for (const id of offByDefault) expect(result).not.toContain(id);
  });
});
