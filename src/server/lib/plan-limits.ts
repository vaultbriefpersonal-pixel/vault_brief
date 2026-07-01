import { eq, desc } from "drizzle-orm";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";

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
