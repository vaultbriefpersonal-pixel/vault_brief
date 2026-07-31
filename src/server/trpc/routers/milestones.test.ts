import { describe, it, expect, vi, beforeEach } from "vitest";

// Same isolation as grant-awards.test.ts: the guards and the trial gate have
// their own coverage, so mocking them leaves this file testing exactly one
// thing — that attaching a milestone to a grant award cannot cross a project
// boundary.
vi.mock("../guards", () => ({
  requireProject: vi.fn(),
  requireMilestone: vi.fn(),
  requireGrantAward: vi.fn(),
}));

vi.mock("@/server/lib/plan-limits", () => ({
  assertTrialActive: vi.fn(),
}));

import {
  requireProject,
  requireMilestone,
  requireGrantAward,
} from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";
import { createCallerFactory } from "../trpc";
import { milestonesRouter } from "./milestones";

const createCaller = createCallerFactory(milestonesRouter);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const AWARD_ID = "22222222-2222-4222-8222-222222222222";
const MILESTONE_ID = "44444444-4444-4444-8444-444444444444";

/** insert().values().returning() and update().set().where().returning(). */
function fakeCtx() {
  const returning = vi.fn().mockResolvedValue([{ id: MILESTONE_ID }]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return {
    session: { user: { id: "founder-user" } },
    db: { insert, values, update, set, where, returning },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProject).mockResolvedValue({ id: PROJECT_ID } as never);
  vi.mocked(assertTrialActive).mockResolvedValue(undefined as never);
  vi.mocked(requireMilestone).mockResolvedValue({
    id: MILESTONE_ID,
    projectId: PROJECT_ID,
  } as never);
});

describe("milestonesRouter — attaching a grant award", () => {
  it("attaches an award that belongs to the same project", async () => {
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: PROJECT_ID,
    } as never);
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);

    await caller.update({ id: MILESTONE_ID, grantAwardId: AWARD_ID });

    expect(ctx.db.set).toHaveBeenCalledWith(
      expect.objectContaining({ grantAwardId: AWARD_ID })
    );
  });

  it("REFUSES an award belonging to a different project", async () => {
    // `requireGrantAward` proves the caller may touch the award — it does not
    // prove the award and the milestone share a project. Without this check a
    // user who owns two projects could put project A's deliverable into
    // project B's grant report, in front of a funder who never commissioned
    // it. Same class of hole as `grantAwards.updateTranche`'s destination
    // check.
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: OTHER_PROJECT_ID,
    } as never);
    const caller = createCaller(fakeCtx() as never);

    await expect(
      caller.update({ id: MILESTONE_ID, grantAwardId: AWARD_ID })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses a cross-project award on create too", async () => {
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: OTHER_PROJECT_ID,
    } as never);
    const caller = createCaller(fakeCtx() as never);

    await expect(
      caller.add({
        projectId: PROJECT_ID,
        title: "Ship the SDK",
        grantAwardId: AWARD_ID,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("detaches on an explicit null without resolving any award", async () => {
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);

    await caller.update({ id: MILESTONE_ID, grantAwardId: null });

    expect(requireGrantAward).not.toHaveBeenCalled();
    expect(ctx.db.set).toHaveBeenCalledWith(
      expect.objectContaining({ grantAwardId: null })
    );
  });

  it("leaves the attachment alone when the field is absent", async () => {
    // A PATCH, not a PUT: omitting `grantAwardId` must not silently detach a
    // milestone from its award as a side effect of renaming it.
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);

    await caller.update({ id: MILESTONE_ID, title: "Renamed" });

    expect(requireGrantAward).not.toHaveBeenCalled();
    const patch = ctx.db.set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("grantAwardId");
  });

  it("creates an ordinary milestone with no award attached", async () => {
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);

    await caller.add({ projectId: PROJECT_ID, title: "Roadmap work" });

    expect(requireGrantAward).not.toHaveBeenCalled();
    expect(ctx.db.values).toHaveBeenCalledWith(
      expect.objectContaining({ grantAwardId: null })
    );
  });

  it("rejects a grantAwardId that is not a uuid", async () => {
    const caller = createCaller(fakeCtx() as never);
    await expect(
      caller.update({ id: MILESTONE_ID, grantAwardId: "not-a-uuid" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
