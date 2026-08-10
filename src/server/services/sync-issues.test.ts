import { describe, it, expect } from "vitest";
import {
  syncIssueGroups,
  syncIssueKey,
  syncIssueHref,
  periodTagOf,
  describeSyncIssue,
} from "./sync-issues";

const w = (over: Record<string, unknown> = {}) => ({
  walletAddress: "0xAAA",
  chain: "base",
  scope: "balance",
  severity: "failed",
  error: "BASE_MAINNET is not enabled",
  ...over,
});

describe("syncIssueGroups", () => {
  it("treats an absent, empty or malformed payload as no issues", () => {
    // A clean snapshot and a snapshot predating the field must both be silent.
    expect(syncIssueGroups(null)).toEqual([]);
    expect(syncIssueGroups(undefined)).toEqual([]);
    expect(syncIssueGroups([])).toEqual([]);
    expect(syncIssueGroups("nonsense")).toEqual([]);
    expect(syncIssueGroups({ not: "an array" })).toEqual([]);
  });

  it("survives junk entries inside an otherwise valid array", () => {
    const groups = syncIssueGroups([null, "x", 42, w()]);
    expect(groups).toHaveLength(1);
    expect(groups[0].chain).toBe("base");
  });

  it("collapses many wallets on one chain into ONE issue", () => {
    // The reason this module exists. A provider outage hits every wallet on
    // the chain; alerting per wallet turns one fault into a mailbox full.
    const groups = syncIssueGroups([
      w({ walletAddress: "0xAAA" }),
      w({ walletAddress: "0xBBB" }),
      w({ walletAddress: "0xCCC" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].wallets).toEqual(["0xaaa", "0xbbb", "0xccc"]);
  });

  it("keeps balance and transfer faults apart — they cost different figures", () => {
    const groups = syncIssueGroups([
      w({ scope: "balance" }),
      w({ scope: "transfers" }),
    ]);
    expect(groups.map(syncIssueKey)).toEqual([
      "base:balance:failed",
      "base:transfers:failed",
    ]);
  });

  it("keeps chains apart", () => {
    const groups = syncIssueGroups([w({ chain: "base" }), w({ chain: "optimism" })]);
    expect(groups).toHaveLength(2);
  });

  it("reads a legacy warning's missing scope/severity as unknown, not as a default", () => {
    // Claiming a pre-taxonomy warning was a balance failure would invent
    // history; `summarizeSyncWarnings` follows the same rule.
    const groups = syncIssueGroups([
      { walletAddress: "0xAAA", chain: "base", error: "boom" },
    ]);
    expect(groups[0].scope).toBe("unknown");
    expect(groups[0].severity).toBe("unknown");
    expect(syncIssueKey(groups[0])).toBe("base:unknown:unknown");
  });

  it("falls back to an 'unknown' chain rather than dropping the warning", () => {
    expect(syncIssueGroups([w({ chain: undefined })])[0].chain).toBe("unknown");
  });

  it("dedupes repeated messages but keeps genuinely different ones", () => {
    const groups = syncIssueGroups([
      w({ error: "same" }),
      w({ walletAddress: "0xBBB", error: "same" }),
      w({ walletAddress: "0xCCC", error: "different" }),
    ]);
    expect(groups[0].messages).toEqual(["same", "different"]);
  });

  it("orders worst-first so the top line of an alert is the worst news", () => {
    const groups = syncIssueGroups([
      w({ chain: "optimism", severity: "partial" }),
      w({ chain: "base", severity: "failed" }),
      w({ chain: "polygon", severity: undefined }),
    ]);
    expect(groups.map((g) => g.severity)).toEqual(["failed", "unknown", "partial"]);
  });
});

describe("syncIssueHref — the dedup handle sets the cadence", () => {
  const P = "11111111-2222-3333-4444-555555555555";

  it("is identical for the same issue in the same month", () => {
    // What keeps a multi-period backfill, which writes many snapshots in one
    // run, from sending one email per period.
    expect(syncIssueHref(P, "base:balance:failed", "2026-08")).toBe(
      syncIssueHref(P, "base:balance:failed", "2026-08")
    );
  });

  it("differs next month, so an unfixed problem is raised again", () => {
    expect(syncIssueHref(P, "base:balance:failed", "2026-08")).not.toBe(
      syncIssueHref(P, "base:balance:failed", "2026-09")
    );
  });

  it("differs per project and per issue", () => {
    expect(syncIssueHref(P, "base:balance:failed", "2026-08")).not.toBe(
      syncIssueHref("other", "base:balance:failed", "2026-08")
    );
    expect(syncIssueHref(P, "base:balance:failed", "2026-08")).not.toBe(
      syncIssueHref(P, "base:transfers:failed", "2026-08")
    );
  });

  it("points at the wallets page and encodes the handle safely", () => {
    const href = syncIssueHref(P, "base:balance:failed", "2026-08");
    expect(href.startsWith(`/projects/${P}/wallets?syncIssue=`)).toBe(true);
    expect(href).not.toContain(" ");
  });
});

describe("periodTagOf", () => {
  it("reads the month off a date string without a timezone in the way", () => {
    // Same hazard as formatDate: `new Date("2026-01-01")` is UTC midnight, and
    // a local read of it can land in the previous month.
    expect(periodTagOf("2026-01-01")).toBe("2026-01");
    expect(periodTagOf("2026-08-31")).toBe("2026-08");
  });

  it("handles a Date by reading it in UTC", () => {
    expect(periodTagOf(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
});

describe("describeSyncIssue", () => {
  it("states the consequence, not just the fault", () => {
    // "balance read failed" does not tell a founder their treasury total is
    // wrong. That sentence is the entire point of the alert.
    const [g] = syncIssueGroups([w()]);
    const text = describeSyncIssue(g);
    expect(text).toContain("Balances on base");
    expect(text).toContain("could not be read at all");
    expect(text).toContain("treasury total and composition exclude");
  });

  it("distinguishes a floor from an absence", () => {
    const [g] = syncIssueGroups([w({ severity: "partial" })]);
    expect(describeSyncIssue(g)).toContain("read only in part");
  });

  it("names the flow figures for a transfers fault", () => {
    const [g] = syncIssueGroups([w({ scope: "transfers" })]);
    expect(describeSyncIssue(g)).toContain("burn, inflows and outflows");
  });

  it("does not claim a family of figures for a legacy warning", () => {
    // Found by dry-running this against real snapshots: two production rows
    // carry pre-taxonomy warnings, and the sentence read "Balances on
    // ethereum…" — asserting the one thing the stored data does not say. The
    // grouping was right to keep the scope `unknown`; the prose then threw
    // that care away.
    const [g] = syncIssueGroups([
      { walletAddress: "0xAAA", chain: "ethereum", error: "boom" },
    ]);
    const text = describeSyncIssue(g);
    expect(text).not.toContain("Balances");
    expect(text).not.toContain("Transfers");
    expect(text).toContain("Some data on ethereum");
    expect(text).toContain("may be incomplete");
  });

  it("counts wallets, and does so in the singular when there is one", () => {
    const [one] = syncIssueGroups([w()]);
    expect(describeSyncIssue(one)).toContain("1 wallet —");
    const [many] = syncIssueGroups([w(), w({ walletAddress: "0xBBB" })]);
    expect(describeSyncIssue(many)).toContain("2 wallets");
  });
});
