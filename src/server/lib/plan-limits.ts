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

/**
 * Throws FORBIDDEN when `projectId` has already used its free report and its
 * OWNER (`ownerId` — pass `project.userId` from `requireProject`, never the
 * calling session user, since a project member acting on someone else's
 * project must be judged by the OWNER's plan) is still on the free plan.
 */
export async function assertCanGenerateReport(
  ownerId: string,
  projectId: string
): Promise<void> {
  const [owner] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);
  if (owner?.plan && owner.plan !== "free") return;

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(reports)
    .where(eq(reports.projectId, projectId));

  if (Number(row?.count ?? 0) >= FREE_REPORT_LIMIT) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `The free plan includes ${FREE_REPORT_LIMIT} report per project. Contact hello@vaultbrief.io to keep generating reports for this project.`,
    });
  }
}
