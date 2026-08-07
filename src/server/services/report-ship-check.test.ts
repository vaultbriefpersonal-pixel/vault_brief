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

  describe("wallet-set shape", () => {
    const barren = [
      {
        walletAddress: "0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f",
        chain: "ethereum",
        tokens: [
          { symbol: "T", valueUsd: 162_500, contractAddress: "0xown" },
          { symbol: "ETH", valueUsd: 78, contractAddress: null },
        ],
      },
    ];
    const project = { tokenSymbol: "T", tokenContract: "0xown" };

    // The Threshold misconfiguration, end to end: a governance multisig
    // standing in for the treasury raises a blocker no other check would.
    it("flags a set where nothing is spendable", () => {
      const blockers = reportShipBlockers({
        validationIssues: [],
        syncWarnings: null,
        balancesDetail: barren,
        project,
      });
      expect(blockers).toHaveLength(1);
      expect(blockers[0]).toContain("not the treasury's wallets");
    });

    it("says nothing once a funded wallet joins the set", () => {
      const blockers = reportShipBlockers({
        validationIssues: [],
        syncWarnings: null,
        balancesDetail: [
          ...barren,
          {
            walletAddress: "0x71E47a4429d35827e0312AA13162197C23287546",
            chain: "ethereum",
            tokens: [{ symbol: "USDC", valueUsd: 234_300, contractAddress: "0xusdc" }],
          },
        ],
        project,
      });
      expect(blockers).toEqual([]);
    });

    // Omitted, not empty: a caller that cannot supply the payload gets no
    // opinion rather than a false all-clear or a false alarm.
    it("skips the check entirely when balancesDetail is not passed", () => {
      expect(
        reportShipBlockers({ validationIssues: [], syncWarnings: null })
      ).toEqual([]);
    });

    it("does not need project identity to reach the same verdict", () => {
      const blockers = reportShipBlockers({
        validationIssues: [],
        syncWarnings: null,
        balancesDetail: barren,
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
