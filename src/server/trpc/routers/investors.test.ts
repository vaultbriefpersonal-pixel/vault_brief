import { describe, it, expect, vi, beforeEach } from "vitest";

// Guard internals, trial-gate and rate-limiting are already covered by their
// own test files — mock them here so this file isolates investors.ts's own
// logic, specifically the human sign-off gate in `sendReport` (only reports
// in `review` or `sent` status may be emailed to investors).
vi.mock("../guards", () => ({
  requireProject: vi.fn(),
  requireInvestor: vi.fn(),
}));

vi.mock("@/server/lib/plan-limits", () => ({
  assertTrialActive: vi.fn(),
}));

vi.mock("@/server/lib/ratelimit", () => ({
  checkLimit: vi.fn(),
  bulkImportLimiter: "bulkImportLimiter-placeholder",
  sendReportLimiter: "sendReportLimiter-placeholder",
}));

import { requireProject } from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";
import { checkLimit } from "@/server/lib/ratelimit";
import { createCallerFactory } from "../trpc";
import { investorsRouter } from "./investors";

const createCaller = createCallerFactory(investorsRouter);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "22222222-2222-4222-8222-222222222222";

function fakeCtx({ findFirstResult }: { findFirstResult: unknown }) {
  const findFirst = vi.fn().mockResolvedValue(findFirstResult);
  return {
    session: { user: { id: "founder-user" } },
    db: {
      query: {
        reports: { findFirst },
      },
    },
  };
}

describe("investorsRouter.sendReport — human sign-off gate", () => {
  beforeEach(() => {
    vi.mocked(requireProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Test Project",
    } as never);
    vi.mocked(assertTrialActive).mockResolvedValue(undefined as never);
    vi.mocked(checkLimit).mockResolvedValue(undefined as never);
  });

  it("rejects with PRECONDITION_FAILED when the report is still a draft (locks investors.ts:135-144)", async () => {
    const ctx = fakeCtx({
      findFirstResult: {
        id: REPORT_ID,
        projectId: PROJECT_ID,
        status: "draft",
        contentMd: "some content",
      },
    });
    const caller = createCaller(ctx as never);

    await expect(
      caller.sendReport({ reportId: REPORT_ID, projectId: PROJECT_ID })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("throws NOT_FOUND when the report doesn't exist", async () => {
    const ctx = fakeCtx({ findFirstResult: undefined });
    const caller = createCaller(ctx as never);

    await expect(
      caller.sendReport({ reportId: REPORT_ID, projectId: PROJECT_ID })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
