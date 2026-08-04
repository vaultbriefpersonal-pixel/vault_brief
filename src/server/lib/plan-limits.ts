import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { projects, users, reports } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";

/**
 * Returns the set of project IDs the user is allowed to sync.
 *
 * Public-goods pivot: VaultBrief is free with no plan limits, so every
 * project a user owns is eligible. (Previously this sliced the list to a
 * per-plan cap; that gating has been removed.) Kept as a function so the
 * cron filter below and its call sites stay unchanged.
 */
export async function eligibleProjectIds(userId: string): Promise<Set<string>> {
  const userProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  return new Set(userProjects.map((p) => p.id));
}

/**
 * Trial gate — now a no-op.
 *
 * Public-goods pivot: VaultBrief is free, so there is no trial wall. This
 * function is intentionally retained (and still called from ~15 mutations)
 * so the pivot is a one-line revert if paid plans ever return — restore the
 * plan/trial lookup here and gating comes back everywhere at once.
 */
export async function assertTrialActive(_userId: string): Promise<void> {
  return;
}

/**
 * Filter a list of project rows down to the ones the user is allowed to sync.
 * Groups by userId to avoid N+1 lookups when the input mixes many users.
 */
export async function filterEligibleProjects<
  T extends { id: string; userId: string },
>(rows: T[]): Promise<T[]> {
  const byUser = new Map<string, T[]>();
  for (const row of rows) {
    const arr = byUser.get(row.userId) ?? [];
    arr.push(row);
    byUser.set(row.userId, arr);
  }

  const allowed: T[] = [];
  for (const [userId, owned] of byUser) {
    const eligible = await eligibleProjectIds(userId);
    allowed.push(...owned.filter((r) => eligible.has(r.id)));
  }
  return allowed;
}

/**
 * How many reports a free-plan project may generate before its owner needs a
 * paid plan. Usage-based, and deliberately separate from `assertTrialActive`
 * above (a time-based trial wall, left a no-op on purpose): a founder can
 * fully set up a project — wallets, budgets, milestones, everything — for
 * free, with no limit. The one thing this gates is generating more than one
 * report for the same project. Regenerating an existing report
 * (`reports.regenerate`) is a different code path and is unaffected.
 *
 * There is no self-serve checkout for a paid plan yet (Stripe checkout is
 * disabled behind placeholder price IDs) — paying clients are onboarded
 * manually by flipping `users.plan` directly; see `scripts/set-user-plan.mjs`.
 */
export const FREE_REPORT_LIMIT = 1;

/** Whether this project may generate another report, and the numbers behind it. */
export interface ReportAllowance {
  allowed: boolean;
  /** Reports already generated for this project. Display only, never the verdict. */
  used: number;
  limit: number;
  /** The message to show a user. Null when `allowed`. */
  reason: string | null;
}

/**
 * THE report cap, in its non-throwing form, and the single place the rule lives.
 *
 * Two shapes are needed because two kinds of caller ask the question, and they
 * need opposite things from the answer:
 *
 *   • An explicit user action ("generate this report") wants `assertCanGenerateReport`
 *     — refusing IS the outcome, and a FORBIDDEN carrying the reason is right.
 *   • A background or compound action (a sync that ends by generating a report,
 *     the monthly cron) must NOT throw. The snapshot it just wrote is good and
 *     must be kept; only the report is skipped. Throwing there would either
 *     lose the sync's work or turn a normal free-plan state into an error the
 *     founder cannot act on.
 *
 * Both go through this function, so there is exactly one definition of "is the
 * owner on a paid plan, and how many reports has this project used". A second
 * copy is one edit away from a free-tier hole.
 *
 * `ownerId` is the PROJECT OWNER (`project.userId` from `requireProject`), never
 * the calling session user: a project member acting on someone else's project
 * is judged by the owner's plan.
 */
export async function reportAllowance(
  ownerId: string,
  projectId: string
): Promise<ReportAllowance> {
  // Plan first, usage second — same order the throwing form has always used.
  //
  // Both queries always run, where the throwing form used to stop after the
  // first for a paid owner. That is deliberate: `used` is part of the answer
  // now (the UI renders "1 of 1 used"), and a shape that reports usage must
  // not report a number it did not look up. One indexed count against the
  // cost of the LLM call this gates is not a trade worth making.
  const [owner] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(reports)
    .where(eq(reports.projectId, projectId));
  const used = Number(row?.count ?? 0);

  if (owner?.plan && owner.plan !== "free") {
    return { allowed: true, used, limit: FREE_REPORT_LIMIT, reason: null };
  }

  if (used >= FREE_REPORT_LIMIT) {
    return {
      allowed: false,
      used,
      limit: FREE_REPORT_LIMIT,
      reason: `The free plan includes ${FREE_REPORT_LIMIT} report per project. Contact hello@vaultbrief.io to keep generating reports for this project.`,
    };
  }
  return { allowed: true, used, limit: FREE_REPORT_LIMIT, reason: null };
}

/**
 * Throws FORBIDDEN when `projectId` has already used its free report and its
 * OWNER is still on the free plan. The throwing form of `reportAllowance`, for
 * callers where refusing is the outcome.
 */
export async function assertCanGenerateReport(
  ownerId: string,
  projectId: string
): Promise<void> {
  const allowance = await reportAllowance(ownerId, projectId);
  if (allowance.allowed) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: allowance.reason ?? "Report limit reached",
  });
}

/**
 * Should `projects.sync`'s and the monthly cron's auto-generate branches be
 * skipped because this project has never had ANY report yet and is actively
 * set up for grant reporting?
 *
 * Scoped to "no report EVER" (not "no report for this exact period"): the
 * risk is a fresh project's ONE free report (`FREE_REPORT_LIMIT`) being spent
 * as a generic investor report before the founder ever opens the period
 * picker to choose grant/investor + period + preset. Once ANY report exists
 * for the project, the founder has already engaged with report generation at
 * least once and normal auto-generate behavior resumes for later periods —
 * this only narrows the very-first-report path, it does not remove
 * auto-generate as a feature.
 *
 * `grant_awards` existence, not a new column: same "existence over a new
 * boolean" reasoning as `milestones.grantAwardId` and `presets.projectId`
 * elsewhere in this codebase — a project either has a grant award on file or
 * it doesn't, and that fact cannot disagree with itself.
 */
export function shouldSkipAutoGenerateForFreshGrantProject(
  hasAnyReport: boolean,
  hasGrantAward: boolean
): boolean {
  return !hasAnyReport && hasGrantAward;
}
