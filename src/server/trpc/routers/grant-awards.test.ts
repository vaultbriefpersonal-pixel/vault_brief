import { describe, it, expect, vi, beforeEach } from "vitest";

// Guard internals and the trial gate have their own coverage — mock them so
// this file isolates grant-awards.ts's own logic: input validation, and the
// fact that a tranche's owning project is DERIVED from its award rather than
// accepted from the caller.
vi.mock("../guards", () => ({
  requireProject: vi.fn(),
  requireGrantAward: vi.fn(),
  requireGrantTranche: vi.fn(),
}));

vi.mock("@/server/lib/plan-limits", () => ({
  assertTrialActive: vi.fn(),
}));

import { TRPCError } from "@trpc/server";
import {
  requireProject,
  requireGrantAward,
  requireGrantTranche,
} from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";
import { createCallerFactory } from "../trpc";
import { grantAwardsRouter } from "./grant-awards";

const createCaller = createCallerFactory(grantAwardsRouter);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const AWARD_ID = "22222222-2222-4222-8222-222222222222";
const TRANCHE_ID = "44444444-4444-4444-8444-444444444444";

/** Minimal chainable db double: insert().values().returning(). */
function fakeCtx({ insertResult }: { insertResult?: unknown } = {}) {
  const returning = vi
    .fn()
    .mockResolvedValue(insertResult ? [insertResult] : [{ id: "row-1" }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    session: { user: { id: "founder-user" } },
    db: { insert, values, returning },
  };
}

const validAward = {
  projectId: PROJECT_ID,
  grantor: "Optimism Foundation",
  awardDate: "2026-03-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProject).mockResolvedValue({ id: PROJECT_ID } as never);
  vi.mocked(assertTrialActive).mockResolvedValue(undefined as never);
});

describe("grantAwardsRouter.createAward — input validation", () => {
  it("rejects an award_date that is not YYYY-MM-DD", async () => {
    const caller = createCaller(fakeCtx() as never);
    await expect(
      caller.createAward({ ...validAward, awardDate: "2026-03" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a YYYY-MM-DD-shaped value carrying a time component", async () => {
    const caller = createCaller(fakeCtx() as never);
    await expect(
      caller.createAward({ ...validAward, awardDate: "2026-03-01T00:00:00Z" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a status outside active | completed | terminated", async () => {
    const caller = createCaller(fakeCtx() as never);
    await expect(
      caller.createAward({
        ...validAward,
        status: "disbursed" as never, // a `grants` status — wrong table
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts each of the three real statuses", async () => {
    for (const status of ["active", "completed", "terminated"] as const) {
      const caller = createCaller(fakeCtx() as never);
      await expect(
        caller.createAward({ ...validAward, status })
      ).resolves.toBeTruthy();
    }
  });

  it("rejects NaN and Infinity award amounts (superjson carries both intact)", async () => {
    const caller = createCaller(fakeCtx() as never);
    for (const bad of [NaN, Infinity, -Infinity]) {
      await expect(
        caller.createAward({ ...validAward, awardAmountUsd: bad })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("rejects a negative award amount", async () => {
    const caller = createCaller(fakeCtx() as never);
    await expect(
      caller.createAward({ ...validAward, awardAmountUsd: -1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts a token-only award — award_amount_usd is nullable on purpose", async () => {
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);
    await caller.createAward({
      ...validAward,
      awardAmountToken: 30_000_000,
      awardTokenSymbol: "OP",
    });
    expect(ctx.db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        awardAmountUsd: null,
        awardAmountToken: "30000000", // numeric column takes a string
      })
    );
  });

  it("rejects a reporting cadence outside the four allowed values", async () => {
    const caller = createCaller(fakeCtx() as never);
    for (const bad of ["weekly", "annual", "MONTHLY", "milestone"]) {
      await expect(
        caller.createAward({ ...validAward, reportingCadence: bad as never })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("accepts each of the four real reporting cadences", async () => {
    for (const reportingCadence of [
      "monthly",
      "quarterly",
      "milestone_based",
      "ad_hoc",
    ] as const) {
      const caller = createCaller(fakeCtx() as never);
      await expect(
        caller.createAward({ ...validAward, reportingCadence })
      ).resolves.toBeTruthy();
    }
  });

  it("defaults the three new fields to null when the agreement states none", async () => {
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);
    await caller.createAward(validAward);
    expect(ctx.db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        reportingCadence: null,
        nextReportDue: null,
        amountUsdAtReceipt: null,
      })
    );
  });

  it("rejects a next_report_due that is not YYYY-MM-DD", async () => {
    const caller = createCaller(fakeCtx() as never);
    await expect(
      caller.createAward({ ...validAward, nextReportDue: "2026-09" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects NaN, Infinity and negative amount_usd_at_receipt", async () => {
    const caller = createCaller(fakeCtx() as never);
    for (const bad of [NaN, Infinity, -Infinity, -1]) {
      await expect(
        caller.createAward({ ...validAward, amountUsdAtReceipt: bad })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  /**
   * The distinction the column exists for: `awardAmountUsd` is what the
   * agreement stated (nothing, for a token grant) and `amountUsdAtReceipt` is
   * what the tokens were worth on arrival. They must reach the row as two
   * independent values — one must never be derived from or overwrite the
   * other, or a report quotes the grantor a number the grant never contained.
   */
  it("keeps amount_usd_at_receipt independent of award_amount_usd", async () => {
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);
    await caller.createAward({
      ...validAward,
      awardAmountToken: 30_000_000,
      awardTokenSymbol: "OP",
      amountUsdAtReceipt: 48_200_000,
    });
    expect(ctx.db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        awardAmountUsd: null, // the agreement stated no USD figure
        awardAmountToken: "30000000",
        amountUsdAtReceipt: "48200000", // numeric column takes a string
      })
    );
  });
});

/** Chainable db double for update().set().where().returning(). */
function fakeUpdateCtx({ updateResult }: { updateResult?: unknown } = {}) {
  const returning = vi
    .fn()
    .mockResolvedValue(updateResult ? [updateResult] : [{ id: AWARD_ID }]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });

  return {
    session: { user: { id: "founder-user" } },
    db: { update, set, where, returning },
  };
}

describe("grantAwardsRouter.updateAward — last_reminded_at reset semantics", () => {
  /**
   * Stage 8: `lastRemindedAt` must read "have we already reminded for the
   * due date that's set RIGHT NOW", not "have we ever reminded". A
   * resubmission of the SAME next_report_due (e.g. the form re-saving
   * unrelated fields) must not clear it — only an actual value change does.
   */
  it("does NOT clear last_reminded_at when next_report_due is resubmitted unchanged", async () => {
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: PROJECT_ID,
      nextReportDue: "2026-09-01",
    } as never);
    const ctx = fakeUpdateCtx();
    const caller = createCaller(ctx as never);

    await caller.updateAward({
      id: AWARD_ID,
      nextReportDue: "2026-09-01", // identical to the stored value
      notes: "unrelated edit",
    });

    const setArg = ctx.db.set.mock.calls[0][0];
    expect(setArg).not.toHaveProperty("lastRemindedAt");
    expect(setArg.nextReportDue).toBe("2026-09-01");
  });

  it("clears last_reminded_at when next_report_due changes to a new value", async () => {
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: PROJECT_ID,
      nextReportDue: "2026-09-01",
    } as never);
    const ctx = fakeUpdateCtx();
    const caller = createCaller(ctx as never);

    await caller.updateAward({ id: AWARD_ID, nextReportDue: "2026-10-15" });

    expect(ctx.db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        nextReportDue: "2026-10-15",
        lastRemindedAt: null,
      })
    );
  });

  it("clears last_reminded_at when next_report_due is explicitly cleared to null", async () => {
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: PROJECT_ID,
      nextReportDue: "2026-09-01",
    } as never);
    const ctx = fakeUpdateCtx();
    const caller = createCaller(ctx as never);

    await caller.updateAward({ id: AWARD_ID, nextReportDue: null });

    expect(ctx.db.set).toHaveBeenCalledWith(
      expect.objectContaining({ nextReportDue: null, lastRemindedAt: null })
    );
  });

  it("leaves next_report_due and last_reminded_at untouched when the field is absent from the PATCH", async () => {
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: PROJECT_ID,
      nextReportDue: "2026-09-01",
    } as never);
    const ctx = fakeUpdateCtx();
    const caller = createCaller(ctx as never);

    await caller.updateAward({ id: AWARD_ID, notes: "just a note edit" });

    const setArg = ctx.db.set.mock.calls[0][0];
    expect(setArg).not.toHaveProperty("nextReportDue");
    expect(setArg).not.toHaveProperty("lastRemindedAt");
  });
});

describe("grantAwardsRouter.createTranche — ownership comes from the award", () => {
  it("cannot attach a tranche to an award the caller does not own", async () => {
    vi.mocked(requireGrantAward).mockRejectedValue(
      new TRPCError({ code: "NOT_FOUND" })
    );
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);

    await expect(
      caller.createTranche({
        grantAwardId: AWARD_ID,
        label: "Tranche 1",
        amountUsd: 50_000,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The guard is the gate: nothing was written.
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("derives project_id from the award, never from the caller", async () => {
    // The award belongs to OTHER_PROJECT_ID. The input has no projectId field
    // at all — that is the point: there is nothing for a caller to spoof.
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: OTHER_PROJECT_ID,
    } as never);
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);

    await caller.createTranche({
      grantAwardId: AWARD_ID,
      label: "Tranche 1 — on signature",
      amountUsd: 50_000,
    });

    expect(ctx.db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        grantAwardId: AWARD_ID,
        projectId: OTHER_PROJECT_ID,
        amountUsd: "50000",
        receivedDate: null, // not yet disbursed
      })
    );
  });

  it("rejects NaN, Infinity and negative tranche amounts", async () => {
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: PROJECT_ID,
    } as never);
    const caller = createCaller(fakeCtx() as never);
    for (const bad of [NaN, Infinity, -1]) {
      await expect(
        caller.createTranche({
          grantAwardId: AWARD_ID,
          label: "Tranche 1",
          amountUsd: bad,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("rejects a received_date that is not YYYY-MM-DD", async () => {
    vi.mocked(requireGrantAward).mockResolvedValue({
      id: AWARD_ID,
      projectId: PROJECT_ID,
    } as never);
    const caller = createCaller(fakeCtx() as never);
    await expect(
      caller.createTranche({
        grantAwardId: AWARD_ID,
        label: "Tranche 1",
        amountUsd: 1,
        receivedDate: "01/03/2026",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("grantAwardsRouter.updateTranche — re-parenting is re-authorised", () => {
  it("checks the DESTINATION award, not just the tranche the caller owns", async () => {
    vi.mocked(requireGrantTranche).mockResolvedValue({
      id: TRANCHE_ID,
      projectId: PROJECT_ID,
    } as never);
    // Caller owns the tranche but not the award they are pushing it into.
    vi.mocked(requireGrantAward).mockRejectedValue(
      new TRPCError({ code: "NOT_FOUND" })
    );
    const ctx = fakeCtx();
    const caller = createCaller(ctx as never);

    await expect(
      caller.updateTranche({ id: TRANCHE_ID, grantAwardId: AWARD_ID })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(requireGrantAward).toHaveBeenCalledWith(
      expect.anything(),
      AWARD_ID
    );
  });
});
