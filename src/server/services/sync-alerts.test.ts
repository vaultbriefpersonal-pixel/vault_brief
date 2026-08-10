import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Structural guard, in the shape `plan-limits.test.ts` already established for
 * the same hazard.
 *
 * A sync can complete by two routes — the monthly cron, through
 * `createMonthlySnapshot`, and the founder pressing Sync now, through
 * `projects.sync` — and an alert wired into only one of them is worse than
 * none, because the half that stays silent is indistinguishable from a healthy
 * sync. This codebase has shipped exactly that twice: `reportAllowance` landed
 * in `reports.generate` alone and the cap was bypassable through the product's
 * most-used button, and the same pair of paths caught the grant auto-generate
 * bug later.
 *
 * There is no unit-testable seam here — one path is a Trigger job and the
 * other a DB-wired mutation, neither with a harness — so this asserts the call
 * exists rather than that it fires. Deliberately shallow, and better than
 * nothing, which is what the alternative was.
 */
describe("every sync path pushes incomplete-sync alerts", () => {
  const paths = [
    // The monthly cron reaches the alert through this function.
    "src/server/services/data-sync.ts",
    // The founder pressing Sync now.
    "src/server/trpc/routers/projects.ts",
  ];

  for (const path of paths) {
    it(`${path} calls notifyNewSyncIssues`, () => {
      const src = readFileSync(path, "utf8");
      expect(src).toContain("notifyNewSyncIssues");
      expect(src.indexOf("notifyNewSyncIssues(")).toBeGreaterThan(-1);
    });
  }

  it("does NOT alert from writeSnapshot, which a backfill calls per period", () => {
    // `projects.sync` writes one snapshot per reconstructed period. A chain
    // that is unreachable is unreachable in all of them, so an alert inside
    // the write would turn one broken chain into one notice per month
    // backfilled. The call belongs after the loop, on the newest snapshot.
    const src = readFileSync("src/server/services/data-sync.ts", "utf8");
    const writeStart = src.indexOf("export async function writeSnapshot");
    expect(writeStart).toBeGreaterThan(-1);
    const writeEnd = src.indexOf("export async function", writeStart + 10);
    const writeBody = src.slice(writeStart, writeEnd > -1 ? writeEnd : undefined);
    expect(writeBody).not.toContain("notifyNewSyncIssues");
  });

  it("alerts on the NEWEST snapshot in the manual path, not inside the loop", () => {
    const src = readFileSync("src/server/trpc/routers/projects.ts", "utf8");
    const call = src.indexOf("notifyNewSyncIssues(");
    const loopWrite = src.indexOf("await writeSnapshot(row)");
    expect(loopWrite).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(loopWrite);
    // It reads the newest snapshot the loop landed on.
    expect(src.slice(call, call + 300)).toContain("latestSnapshot");
  });
});
