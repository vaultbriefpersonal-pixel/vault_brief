import { describe, it, expect } from "vitest";
import {
  SIGNAL_FAMILIES,
  SECTION_LIBRARY,
  missingSignalIssues,
  type ReportSection,
} from "./report-sections";

/** A stand-in for an enabled section — only `id` and `title` are read. */
function sec(id: string): ReportSection {
  const real = SECTION_LIBRARY.find((s) => s.id === id);
  if (!real) throw new Error(`no such section id: ${id}`);
  return real;
}

function enabled(...ids: string[]): ReportSection[] {
  return ids.map(sec);
}

describe("SIGNAL_FAMILIES", () => {
  // The families name section ids as strings. A rename in SECTION_LIBRARY
  // would otherwise silently empty a family and disable the check with no
  // test failing anywhere.
  it("references only ids that exist in SECTION_LIBRARY", () => {
    const known = new Set(SECTION_LIBRARY.map((s) => s.id));
    for (const family of SIGNAL_FAMILIES) {
      for (const id of family.sectionIds) {
        expect(known, `${family.key} references unknown id "${id}"`).toContain(id);
      }
    }
  });

  it("excludes balance-only sections from the financial family", () => {
    const financial = SIGNAL_FAMILIES.find((f) => f.key === "financial")!;
    // These render from balances alone and are non-empty on essentially every
    // snapshot — including one where every flow figure failed to read.
    for (const id of [
      "treasury_overview",
      "treasury_by_chain",
      "treasury_concentration",
      "token_metrics",
    ]) {
      expect(financial.sectionIds).not.toContain(id);
    }
  });

  it("excludes plan_deviation from the grant family", () => {
    // It falls back to a canned "No changes to the original plan." with no
    // founder input, so it is never empty and proves nothing.
    const grant = SIGNAL_FAMILIES.find((f) => f.key === "grant")!;
    expect(grant.sectionIds).not.toContain("plan_deviation");
    expect(grant.sectionIds).not.toContain("external_dashboard");
  });
});

describe("missingSignalIssues", () => {
  it("is silent when a financial section carried content", () => {
    const issues = missingSignalIssues(
      enabled("treasury_overview", "financial_health"),
      new Set(["treasury_overview", "financial_health"])
    );
    expect(issues).toEqual([]);
  });

  // The whole point of the family split: one delivered section is enough.
  it("is silent when only ONE of several financial sections delivered", () => {
    const issues = missingSignalIssues(
      enabled("financial_health", "expense_breakdown", "major_transactions"),
      new Set(["expense_breakdown"])
    );
    expect(issues).toEqual([]);
  });

  it("fires when every enabled financial section came back empty", () => {
    const issues = missingSignalIssues(
      enabled("treasury_overview", "financial_health", "expense_breakdown"),
      new Set(["treasury_overview"]) // balances rendered; nothing about movement
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Financial Health");
    expect(issues[0]).toContain("what it did");
  });

  // The Optimism/RetroPGF shape, and the reason this is keyed on enabled
  // sections rather than on report_type. `minimal` ships financial sections
  // OFF on purpose — 0 of 13 real Optimism reports stated fund usage — and
  // must not be nagged for data it never claimed to carry.
  it("does not fire on a narrative report that enables no financial sections", () => {
    const issues = missingSignalIssues(
      enabled("executive_summary", "key_takeaways", "grant_milestone_progress"),
      new Set(["executive_summary", "key_takeaways", "grant_milestone_progress"])
    );
    expect(issues).toEqual([]);
  });

  it("fires per family, independently", () => {
    const issues = missingSignalIssues(
      enabled("financial_health", "grant_fund_usage"),
      new Set() // neither delivered
    );
    expect(issues).toHaveLength(2);
  });

  it("fires on the grant family while the financial family is fine", () => {
    const issues = missingSignalIssues(
      enabled("financial_health", "grant_fund_usage", "leftover_funds"),
      new Set(["financial_health"])
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("grant");
  });

  // A grant report whose only grant content is the canned deviation line has
  // no grant signal, and excluding plan_deviation from the family is what
  // makes that visible.
  it("still fires when only plan_deviation rendered", () => {
    const issues = missingSignalIssues(
      enabled("grant_fund_usage", "grant_milestone_progress", "plan_deviation"),
      new Set(["plan_deviation"])
    );
    expect(issues).toHaveLength(1);
  });

  it("is silent on an empty report", () => {
    expect(missingSignalIssues([], new Set())).toEqual([]);
  });
});
