import { describe, it, expect } from "vitest";
import { reportShipBlockers } from "./report-ship-check";

const clean = { validationIssues: [], syncWarnings: null };

describe("reportShipBlockers", () => {
  it("returns nothing for a checked, clean report on a clean snapshot", () => {
    expect(reportShipBlockers(clean)).toEqual([]);
  });

  // The distinction the column was designed around. A report generated before
  // the verdict existed was never graded; treating that as a failure would
  // slap a warning on every historical report in the database.
  it("says nothing when the report was never checked", () => {
    for (const never of [null, undefined, "nonsense", {}]) {
      expect(
        reportShipBlockers({ validationIssues: never, syncWarnings: null })
      ).toEqual([]);
    }
  });

  it("surfaces each validation issue verbatim", () => {
    const blockers = reportShipBlockers({
      validationIssues: [
        "Report appears cut off mid-sentence",
        "Key Takeaways contains a bullet with no figure",
      ],
      syncWarnings: null,
    });
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toBe("Report appears cut off mid-sentence");
  });

  it("drops blank and non-string entries rather than rendering empty bullets", () => {
    expect(
      reportShipBlockers({
        validationIssues: ["  ", 42, null, "real issue"],
        syncWarnings: null,
      })
    ).toEqual(["real issue"]);
  });

  describe("snapshot coverage", () => {
    it("flags incomplete balances and names the affected figures", () => {
      const [blocker] = reportShipBlockers({
        validationIssues: [],
        syncWarnings: [
          {
            walletAddress: "0xAAA",
            chain: "ethereum",
            scope: "balance",
            severity: "failed",
            error: "timeout",
          },
        ],
      });
      expect(blocker).toContain("treasury total");
      expect(blocker).not.toContain("Burn");
    });

    // The live Base case: balances fine, transfers 403. The treasury total is
    // quotable and burn is not, and only the second may raise a blocker.
    it("flags flows alone when only transfers failed", () => {
      const blockers = reportShipBlockers({
        validationIssues: [],
        syncWarnings: [
          {
            walletAddress: "0xAAA",
            chain: "base",
            scope: "transfers",
            severity: "failed",
            error: "HTTP 403",
          },
        ],
      });
      expect(blockers).toHaveLength(1);
      expect(blockers[0]).toContain("Burn, inflows and outflows");
    });

    it("raises one blocker per dimension, not one per wallet", () => {
      const blockers = reportShipBlockers({
        validationIssues: [],
        syncWarnings: [
          { walletAddress: "0xA", chain: "base", scope: "transfers", severity: "failed", error: "a" },
          { walletAddress: "0xB", chain: "base", scope: "transfers", severity: "failed", error: "b" },
          { walletAddress: "0xC", chain: "base", scope: "transfers", severity: "partial", error: "c" },
        ],
      });
      expect(blockers).toHaveLength(1);
    });

    it("treats a page-capped read as a blocker too — a floor is not a total", () => {
      const blockers = reportShipBlockers({
        validationIssues: [],
        syncWarnings: [
          { walletAddress: "0xA", chain: "ethereum", scope: "balance", severity: "partial", error: "cap" },
        ],
      });
      expect(blockers).toHaveLength(1);
    });
  });

  it("combines both sources", () => {
    const blockers = reportShipBlockers({
      validationIssues: ["Report appears cut off mid-sentence"],
      syncWarnings: [
        { walletAddress: "0xA", chain: "base", scope: "transfers", severity: "failed", error: "403" },
      ],
    });
    expect(blockers).toHaveLength(2);
  });
});
