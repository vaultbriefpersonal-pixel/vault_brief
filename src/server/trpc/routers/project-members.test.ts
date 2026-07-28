import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Guard internals are already covered by guards.test.ts — mock them here
// so these tests isolate project-members.ts's own logic (the enumeration
// rate-limit + case-insensitive lookup fixes), not auth/membership rules.
vi.mock("../guards", () => ({
  requireProject: vi.fn(),
  requireProjectAdmin: vi.fn(),
}));

vi.mock("@/server/lib/ratelimit", () => ({
  checkLimit: vi.fn(),
  inviteLimiter: "inviteLimiter-placeholder",
}));

import { requireProjectAdmin } from "../guards";
import { checkLimit } from "@/server/lib/ratelimit";
import { createCallerFactory } from "../trpc";
import { projectMembersRouter } from "./project-members";

const createCaller = createCallerFactory(projectMembersRouter);

function fakeCtx({
  findFirstResult,
  insertResult,
}: {
  findFirstResult: unknown;
  insertResult?: unknown;
}) {
  const findFirst = vi.fn().mockResolvedValue(findFirstResult);
  const returning = vi.fn().mockResolvedValue(insertResult ? [insertResult] : []);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    session: { user: { id: "admin-user" } },
    db: {
      query: { users: { findFirst } },
      insert,
    },
  };
}

describe("projectMembersRouter.invite", () => {
  beforeEach(() => {
    vi.mocked(requireProjectAdmin).mockResolvedValue({
      userId: "owner-user",
    } as never);
    vi.mocked(checkLimit).mockResolvedValue(undefined);
  });

  it("throws BAD_REQUEST when no account exists for the email", async () => {
    const ctx = fakeCtx({ findFirstResult: undefined });
    const caller = createCaller(ctx as never);

    await expect(
      caller.invite({
        projectId: "11111111-1111-4111-8111-111111111111",
        email: "nobody@example.com",
        role: "editor",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("finds the invitee via a case-insensitive email match (regression test for Finding 2)", async () => {
    // Stored email has different casing than what the admin typed — the
    // old eq()-based exact match would have missed this.
    const ctx = fakeCtx({
      findFirstResult: { id: "invitee-1", email: "CoFounder@Example.com" },
      insertResult: { id: "member-1", role: "editor" },
    });
    const caller = createCaller(ctx as never);

    const result = await caller.invite({
      projectId: "11111111-1111-4111-8111-111111111111",
      email: "cofounder@example.com",
      role: "editor",
    });

    expect(result).toEqual({ id: "member-1", role: "editor" });
    // The where clause was built from ilike, not eq — confirm the lookup
    // was actually attempted (not skipped), the case-sensitivity itself
    // is exercised by ilike's real behavior against Postgres, not by this
    // mock. This test locks in that a match proceeds to the insert step.
    expect(ctx.db.query.users.findFirst).toHaveBeenCalledTimes(1);
    expect(ctx.db.insert).toHaveBeenCalledTimes(1);
  });

  it("rejects inviting the project owner", async () => {
    const ctx = fakeCtx({
      findFirstResult: { id: "owner-user", email: "owner@example.com" },
    });
    const caller = createCaller(ctx as never);

    await expect(
      caller.invite({
        projectId: "11111111-1111-4111-8111-111111111111",
        email: "owner@example.com",
        role: "editor",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("propagates TOO_MANY_REQUESTS from the rate limiter without ever querying users (regression test for Finding 1)", async () => {
    vi.mocked(checkLimit).mockRejectedValueOnce(
      new TRPCError({ code: "TOO_MANY_REQUESTS", message: "slow down" })
    );
    const ctx = fakeCtx({ findFirstResult: undefined });
    const caller = createCaller(ctx as never);

    await expect(
      caller.invite({
        projectId: "11111111-1111-4111-8111-111111111111",
        email: "probe@example.com",
        role: "editor",
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    expect(ctx.db.query.users.findFirst).not.toHaveBeenCalled();
  });
});
