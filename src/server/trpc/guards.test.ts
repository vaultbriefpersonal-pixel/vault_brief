import { describe, it, expect, vi } from "vitest";
import { requireProject, requireProjectAdmin } from "./guards";

// Minimal fake of ctx.db.query — guards.ts only ever calls
// .findFirst on projects / projectMembers, so that's all we stub.
// Real end-to-end coverage against Postgres isn't feasible here (no
// SESSION_TOKEN / authed E2E fixture in this environment) — this is the
// compensating verification for TODO-026's access-control logic, which
// is exactly the kind of thing that must not regress silently.
function fakeCtx({
  project,
  membership,
}: {
  project: { userId: string } | undefined;
  membership: { role: string } | undefined;
}) {
  return {
    session: { user: { id: "user-under-test" } },
    db: {
      query: {
        projects: { findFirst: vi.fn().mockResolvedValue(project) },
        projectMembers: { findFirst: vi.fn().mockResolvedValue(membership) },
      },
    },
  } as unknown as Parameters<typeof requireProject>[0];
}

describe("requireProject", () => {
  it("allows the owner (existing solo-project behavior, unchanged)", async () => {
    const ctx = fakeCtx({
      project: { userId: "user-under-test" },
      membership: undefined,
    });
    await expect(requireProject(ctx, "proj-1")).resolves.toEqual({
      userId: "user-under-test",
    });
  });

  it("allows an invited member (any role)", async () => {
    const ctx = fakeCtx({
      project: { userId: "someone-else" },
      membership: { role: "viewer" },
    });
    await expect(requireProject(ctx, "proj-1")).resolves.toEqual({
      userId: "someone-else",
    });
  });

  it("rejects a user who is neither owner nor member (NOT_FOUND, not FORBIDDEN — no enumeration leak)", async () => {
    const ctx = fakeCtx({
      project: { userId: "someone-else" },
      membership: undefined,
    });
    await expect(requireProject(ctx, "proj-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects when the project doesn't exist at all", async () => {
    const ctx = fakeCtx({ project: undefined, membership: undefined });
    await expect(requireProject(ctx, "proj-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("requireProjectAdmin", () => {
  it("allows the owner", async () => {
    const ctx = fakeCtx({
      project: { userId: "user-under-test" },
      membership: undefined,
    });
    await expect(requireProjectAdmin(ctx, "proj-1")).resolves.toEqual({
      userId: "user-under-test",
    });
  });

  it("allows a member with role='admin'", async () => {
    const ctx = fakeCtx({
      project: { userId: "someone-else" },
      membership: { role: "admin" },
    });
    await expect(requireProjectAdmin(ctx, "proj-1")).resolves.toEqual({
      userId: "someone-else",
    });
  });

  it("rejects an editor member with FORBIDDEN (they have access, just not admin — must not leak as NOT_FOUND)", async () => {
    const ctx = fakeCtx({
      project: { userId: "someone-else" },
      membership: { role: "editor" },
    });
    await expect(requireProjectAdmin(ctx, "proj-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects a viewer member with FORBIDDEN", async () => {
    const ctx = fakeCtx({
      project: { userId: "someone-else" },
      membership: { role: "viewer" },
    });
    await expect(requireProjectAdmin(ctx, "proj-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects a non-member with NOT_FOUND (delegates to requireProject first)", async () => {
    const ctx = fakeCtx({
      project: { userId: "someone-else" },
      membership: undefined,
    });
    await expect(requireProjectAdmin(ctx, "proj-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
