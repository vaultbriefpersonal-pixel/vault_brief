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

import { db } from "@/server/db";
import { assertCanGenerateReport } from "./plan-limits";

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
    select.mockReturnValueOnce(usersChain([{ plan: "starter" }]) as never);
    // No second mockReturnValueOnce queued for the reports count query — if
    // the implementation incorrectly reached it, db.select would return
    // undefined and the call would throw, failing this test.

    await expect(
      assertCanGenerateReport(OWNER_ID, PROJECT_ID)
    ).resolves.toBeUndefined();

    expect(select).toHaveBeenCalledTimes(1);
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
