import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  projects,
  reports,
  investors,
  wallets,
} from "@/server/db/schema";
import type { Context } from "./context";

/**
 * Single source of truth for "does this signed-in user own that resource".
 * Every router should reach for these helpers instead of rolling its own
 * assertOwner. Adding a new resource type? Extend this file, not each router.
 *
 * NOT_FOUND is returned for both "missing" and "not yours" — leaking the
 * difference would let attackers enumerate resource IDs.
 */

// Matches what protectedProcedure produces: session is non-null, but user.id is
// still optional in next-auth's type. We narrow at runtime via userId().
type GuardCtx = Context & { session: NonNullable<Context["session"]> };

function userId(ctx: GuardCtx): string {
  const id = ctx.session.user?.id;
  if (!id) throw new TRPCError({ code: "UNAUTHORIZED" });
  return id;
}

export async function requireProject(ctx: GuardCtx, projectId: string) {
  const project = await ctx.db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId(ctx))),
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
}

export async function requireReport(ctx: GuardCtx, reportId: string) {
  const report = await ctx.db.query.reports.findFirst({
    where: eq(reports.id, reportId),
  });
  if (!report) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, report.projectId);
  return report;
}

export async function requireWallet(ctx: GuardCtx, walletId: string) {
  const wallet = await ctx.db.query.wallets.findFirst({
    where: eq(wallets.id, walletId),
  });
  if (!wallet) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, wallet.projectId);
  return wallet;
}

export async function requireInvestor(ctx: GuardCtx, investorId: string) {
  const investor = await ctx.db.query.investors.findFirst({
    where: eq(investors.id, investorId),
  });
  if (!investor) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, investor.projectId);
  return investor;
}
