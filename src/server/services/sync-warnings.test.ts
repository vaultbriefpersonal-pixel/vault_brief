import { describe, it, expect } from "vitest";
import {
  summarizeSyncWarnings,
  describeSyncCoverage,
  type SyncWarning,
} from "./sync-warnings";

function w(over: Partial<SyncWarning> = {}): SyncWarning {
  return {
    walletAddress: "0xAAA",
    chain: "ethereum",
    scope: "balance",
    severity: "failed",
    error: "boom",
    ...over,
  };
}

describe("summarizeSyncWarnings", () => {
  it("reports a clean snapshot as complete", () => {
    for (const empty of [null, undefined, [], "nonsense", {}]) {
      const s = summarizeSyncWarnings(empty);
      expect(s.balancesIncomplete).toBe(false);
      expect(s.flowsIncomplete).toBe(false);
      expect(s.messages).toEqual([]);
    }
  });

  it("separates the balance dimension from the transfers dimension", () => {
    const s = summarizeSyncWarnings([
      w({ scope: "balance", severity: "failed" }),
      w({ walletAddress: "0xBBB", scope: "transfers", severity: "partial" }),
    ]);
    expect(s.balanceFailed).toHaveLength(1);
    expect(s.transfersPartial).toHaveLength(1);
    expect(s.balancesIncomplete).toBe(true);
    expect(s.flowsIncomplete).toBe(true);
  });

  // The live Base case: balances read fine, transfers 403'd. The treasury
  // total is trustworthy and burn is not, and the summary has to say so.
  it("leaves balances complete when only transfers failed", () => {
    const s = summarizeSyncWarnings([
      w({ scope: "transfers", severity: "failed", error: "HTTP 403 outgoing" }),
      w({ scope: "transfers", severity: "failed", error: "HTTP 403 incoming" }),
    ]);
    expect(s.balancesIncomplete).toBe(false);
    expect(s.flowsIncomplete).toBe(true);
  });

  // The bug this taxonomy exists to fix, half one: one wallet that warned
  // twice is one wallet with a problem, not two.
  it("counts distinct wallets, not warnings", () => {
    const s = summarizeSyncWarnings([
      w({ scope: "transfers", severity: "failed", error: "outgoing" }),
      w({ scope: "transfers", severity: "failed", error: "incoming" }),
    ]);
    expect(s.transfersFailed).toHaveLength(1);
    expect(s.messages).toHaveLength(2);
  });

  it("keeps the same address on two chains apart", () => {
    const s = summarizeSyncWarnings([
      w({ chain: "ethereum", scope: "balance", severity: "failed" }),
      w({ chain: "polygon", scope: "balance", severity: "failed" }),
    ]);
    expect(s.balanceFailed).toHaveLength(2);
  });

  describe("legacy rows", () => {
    // Snapshots written before scope/severity existed. Their nature is
    // genuinely unknown and must not be guessed at.
    const legacy = [{ walletAddress: "0xAAA", chain: "base", error: "HTTP 403" }];

    it("files them as unclassified rather than assuming a scope", () => {
      const s = summarizeSyncWarnings(legacy);
      expect(s.unclassified).toHaveLength(1);
      expect(s.balanceFailed).toEqual([]);
      expect(s.transfersFailed).toEqual([]);
    });

    it("taints BOTH dimensions, because either could be the affected one", () => {
      const s = summarizeSyncWarnings(legacy);
      expect(s.balancesIncomplete).toBe(true);
      expect(s.flowsIncomplete).toBe(true);
    });

    it("treats a half-populated row as legacy too", () => {
      const s = summarizeSyncWarnings([
        { walletAddress: "0xAAA", chain: "base", scope: "balance", error: "x" },
      ]);
      expect(s.unclassified).toHaveLength(1);
    });
  });

  it("skips malformed entries without losing the good ones", () => {
    const s = summarizeSyncWarnings([null, 42, w({ error: "real" })]);
    expect(s.messages).toEqual(["real"]);
    expect(s.balanceFailed).toHaveLength(1);
  });
});

describe("describeSyncCoverage", () => {
  it("says nothing when nothing is wrong", () => {
    expect(describeSyncCoverage(summarizeSyncWarnings([]))).toBeNull();
  });

  // The bug this taxonomy exists to fix, half two: a page-capped read is a
  // wallet that DID return data. Calling it a failure sent founders hunting
  // for a broken integration that was working.
  it("does not call a page-capped read a failure", () => {
    const note = describeSyncCoverage(
      summarizeSyncWarnings([w({ scope: "balance", severity: "partial" })])
    );
    expect(note).not.toBeNull();
    expect(note!.detail).toContain("floor");
    expect(note!.detail).not.toContain("could not be read");
  });

  it("names the figures a reader is about to quote", () => {
    const balanceOnly = describeSyncCoverage(
      summarizeSyncWarnings([w({ scope: "balance", severity: "failed" })])
    );
    expect(balanceOnly!.detail).toContain("treasury total");
    expect(balanceOnly!.detail).not.toContain("burn");

    const transfersOnly = describeSyncCoverage(
      summarizeSyncWarnings([w({ scope: "transfers", severity: "failed" })])
    );
    expect(transfersOnly!.detail).toContain("burn");
    expect(transfersOnly!.detail).not.toContain("treasury total");
  });

  it("pluralises on distinct wallets", () => {
    const one = describeSyncCoverage(
      summarizeSyncWarnings([w({ error: "a" }), w({ error: "b" })])
    );
    expect(one!.detail).toContain("1 wallet");
    expect(one!.detail).not.toContain("1 wallets");

    const two = describeSyncCoverage(
      summarizeSyncWarnings([w(), w({ walletAddress: "0xBBB" })])
    );
    expect(two!.detail).toContain("2 wallets");
  });
});
