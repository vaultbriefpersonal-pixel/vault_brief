import { describe, it, expect, vi, beforeEach } from "vitest";

// assertCanGenerateReport (unlike most of this codebase's tested logic)
// reaches for `db` imported at module scope rather than via ctx, so there's
// no existing ctx-mocking precedent to reuse here (see
// project-members.test.ts / investors.test.ts for that style). Instead we
// mock the `@/server/db` singleton directly and shape the mock's chained
// methods to match exactly what plan-limits.ts calls:
//   - users lookup:   db.select(...).from(...).where(...).limit(1)
//   - reports lookup: db.select(...).from(...).where(...)            (no .limit)
vi.mock("@/server/db", () => ({
  db: { select: vi.fn() },
}));

import { readFileSync } from "node:fs";
import { db } from "@/server/db";
import {
  assertCanGenerateReport,
  reportAllowance,
  FREE_REPORT_LIMIT,
} from "./plan-limits";

const OWNER_ID = "owner-user";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

/** Builds the `.from().where().limit()` chain used for the users lookup. */
function usersChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return { from, where, limit };
}

/** Builds the `.from().where()` chain used for the reports count lookup. */
function reportsChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  return { from, where };
}

const select = vi.mocked(db.select);

beforeEach(() => {
  select.mockReset();
});

describe("assertCanGenerateReport", () => {
  it("resolves without throwing when the owner is on a paid plan, regardless of report count", async () => {
    select
      .mockReturnValueOnce(usersChain([{ plan: "starter" }]) as never)
      // The count IS queried for a paid owner, where it used to be
      // short-circuited past: `reportAllowance` (which this now delegates to)
      // returns `used` as part of its answer, so it always looks it up. A high
      // count here is the point — it must not change the verdict.
      .mockReturnValueOnce(reportsChain([{ count: 9 }]) as never);

    await expect(
      assertCanGenerateReport(OWNER_ID, PROJECT_ID)
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing for a free-plan owner with 0 existing reports (the free report)", async () => {
    select
      .mockReturnValueOnce(usersChain([{ plan: "free" }]) as never)
      .mockReturnValueOnce(reportsChain([{ count: 0 }]) as never);

    await expect(
      assertCanGenerateReport(OWNER_ID, PROJECT_ID)
    ).resolves.toBeUndefined();
  });

  it("throws FORBIDDEN for a free-plan owner with 1 existing report", async () => {
    select
      .mockReturnValueOnce(usersChain([{ plan: "free" }]) as never)
      .mockReturnValueOnce(reportsChain([{ count: 1 }]) as never);

    await expect(
      assertCanGenerateReport(OWNER_ID, PROJECT_ID)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN for a free-plan owner with 2+ existing reports (limit is 'at least N', not 'exactly N')", async () => {
    select
      .mockReturnValueOnce(usersChain([{ plan: "free" }]) as never)
      .mockReturnValueOnce(reportsChain([{ count: 3 }]) as never);

    await expect(
      assertCanGenerateReport(OWNER_ID, PROJECT_ID)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// The non-throwing form. This is the one background callers use, and the
// distinction that matters is that a refusal here is a RETURN, not an
// exception — a sync that has already written a good snapshot must not lose
// it because the report is capped.
describe("reportAllowance", () => {
  it("allows a paid-plan owner and reports usage without consulting the report count as a verdict", async () => {
    select
      .mockReturnValueOnce(usersChain([{ plan: "starter" }]) as never)
      .mockReturnValueOnce(reportsChain([{ count: 7 }]) as never);

    await expect(reportAllowance(OWNER_ID, PROJECT_ID)).resolves.toEqual({
      allowed: true,
      used: 7,
      limit: FREE_REPORT_LIMIT,
      reason: null,
    });
  });

  it("allows a free-plan owner who has not used the free report", async () => {
    select
      .mockReturnValueOnce(usersChain([{ plan: "free" }]) as never)
      .mockReturnValueOnce(reportsChain([{ count: 0 }]) as never);

    await expect(reportAllowance(OWNER_ID, PROJECT_ID)).resolves.toEqual({
      allowed: true,
      used: 0,
      limit: FREE_REPORT_LIMIT,
      reason: null,
    });
  });

  it("REFUSES BY RETURNING, never by throwing, once the free report is spent", async () => {
    select
      .mockReturnValueOnce(usersChain([{ plan: "free" }]) as never)
      .mockReturnValueOnce(reportsChain([{ count: 1 }]) as never);

    const allowance = await reportAllowance(OWNER_ID, PROJECT_ID);

    expect(allowance.allowed).toBe(false);
    expect(allowance.used).toBe(1);
    // The reason is user-facing and must actually say something actionable —
    // a bare "false" leaves the UI with nothing to render.
    expect(allowance.reason).toContain("hello@vaultbrief.io");
  });

  it("treats a missing owner row as free rather than as unlimited", async () => {
    select
      .mockReturnValueOnce(usersChain([]) as never)
      .mockReturnValueOnce(reportsChain([{ count: 1 }]) as never);

    await expect(reportAllowance(OWNER_ID, PROJECT_ID)).resolves.toMatchObject({
      allowed: false,
    });
  });
});

// Structural, deliberately. The bug this guards against was not wrong logic in
// `reportAllowance` — it was two write paths that never asked it. Both are
// long integration functions with no test harness (a network sync and a
// Trigger.dev cron), so the cheap durable guard is that the call still exists.
// If either file is restructured, this test should be updated to point at
// whatever consults the policy — not deleted.
describe("every report-writing path consults the cap", () => {
  const paths = [
    "src/server/trpc/routers/projects.ts",
    "src/server/jobs/auto-generate-reports.ts",
  ];

  for (const path of paths) {
    it(`${path} calls reportAllowance before generating a report`, () => {
      const src = readFileSync(path, "utf8");

      expect(src).toContain("reportAllowance");

      const gate = src.indexOf("reportAllowance(");
      const write = src.indexOf("generateAndSaveReport(");
      expect(gate).toBeGreaterThan(-1);
      expect(write).toBeGreaterThan(-1);
      // The gate must precede the write, not merely coexist with it.
      expect(gate).toBeLessThan(write);
    });
  }
});
