import { eq, desc } from "drizzle-orm";
import { db } from "@/server/db";
import { projects, users } from "@/server/db/schema";

/**
 * Per-plan project caps. Mirrors the limits enforced at create-time in the
 * projects router. Source of truth for cron-side soft-blocking.
 */
const PROJECT_LIMITS: Record<string, number> = {
  free: 1,
  starter: 1,
  growth: 1,
  vc_suite: 30,
};

/**
 * Returns the set of project IDs the user is currently allowed to sync. If
 * they're over their plan limit (e.g. after a downgrade or expired sub), the
 * most recently created N stay eligible and the rest are silently skipped by
 * the cron jobs.
 *
 * Read-only — does NOT mutate `projects.isActive`. Frontend can show an
 * "upgrade to sync more" banner via a similar query.
 */
export async function eligibleProjectIds(userId: string): Promise<Set<string>> {
  const [user] = await db
    .select({ plan: users.plan, expiresAt: users.planExpiresAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return new Set();

  // An expired subscription falls back to the free-tier limits even if the
  // plan column still reads "vc_suite" (Stripe webhook may not have caught up).
  const effectivePlan =
    user.expiresAt && user.expiresAt < new Date() ? "free" : user.plan;
  const limit = PROJECT_LIMITS[effectivePlan] ?? 1;

  const userProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  return new Set(userProjects.slice(0, limit).map((p) => p.id));
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
