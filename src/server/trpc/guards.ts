import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  projects,
  projectMembers,
  reports,
  investors,
  wallets,
  grants,
  governanceProposals,
  partners,
  asks,
  qaHighlights,
  milestones,
  projectBudgets,
  grantAwards,
  grantTranches,
  presets,
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

/**
 * Owner OR any invited project_members row (TODO-026, phase 1 — every
 * member is editor-equivalent regardless of role; viewer read-only
 * enforcement is a deliberate follow-up, not done here). Existing
 * solo-owner projects hit only the owner check below — same single
 * query as before this change, no behavior change for them.
 */
export async function requireProject(ctx: GuardCtx, projectId: string) {
  const uid = userId(ctx);
  const project = await ctx.db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  if (project.userId === uid) return project;

  const membership = await ctx.db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, uid)
    ),
  });
  if (!membership) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
}

/**
 * Owner OR a member with role='admin'. Used for member management
 * (invite/remove/change role) and deleting the project itself — actions
 * an ordinary editor-level collaborator must not be able to take.
 * FORBIDDEN (not NOT_FOUND) once we know the caller has SOME access —
 * the NOT_FOUND-for-enumeration concern only applies to non-members.
 */
export async function requireProjectAdmin(ctx: GuardCtx, projectId: string) {
  const project = await requireProject(ctx, projectId);
  const uid = userId(ctx);
  if (project.userId === uid) return project;

  const membership = await ctx.db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, uid)
    ),
  });
  if (membership?.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required for this action",
    });
  }
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

export async function requireGrant(ctx: GuardCtx, id: string) {
  const row = await ctx.db.query.grants.findFirst({ where: eq(grants.id, id) });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, row.projectId);
  return row;
}

export async function requireGovernanceProposal(ctx: GuardCtx, id: string) {
  const row = await ctx.db.query.governanceProposals.findFirst({
    where: eq(governanceProposals.id, id),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, row.projectId);
  return row;
}

export async function requirePartner(ctx: GuardCtx, id: string) {
  const row = await ctx.db.query.partners.findFirst({
    where: eq(partners.id, id),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, row.projectId);
  return row;
}

export async function requireAsk(ctx: GuardCtx, id: string) {
  const row = await ctx.db.query.asks.findFirst({ where: eq(asks.id, id) });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, row.projectId);
  return row;
}

export async function requireQaHighlight(ctx: GuardCtx, id: string) {
  const row = await ctx.db.query.qaHighlights.findFirst({
    where: eq(qaHighlights.id, id),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, row.projectId);
  return row;
}

export async function requireProjectBudget(ctx: GuardCtx, id: string) {
  const row = await ctx.db.query.projectBudgets.findFirst({
    where: eq(projectBudgets.id, id),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, row.projectId);
  return row;
}

/**
 * An award this project RECEIVED. Not `requireGrant` above — that guards the
 * `grants` table, which is money the project GAVE OUT. Two tables, two guards,
 * and passing an id to the wrong one NOT_FOUNDs rather than silently
 * authorising across them.
 */
export async function requireGrantAward(ctx: GuardCtx, id: string) {
  const row = await ctx.db.query.grantAwards.findFirst({
    where: eq(grantAwards.id, id),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, row.projectId);
  return row;
}

/**
 * Resolves ownership off the tranche's own `projectId` rather than joining
 * through `grantAwards` — the reason that column is denormalised onto the row
 * (see schema.ts). Same two-step shape as every other guard here.
 */
export async function requireGrantTranche(ctx: GuardCtx, id: string) {
  const row = await ctx.db.query.grantTranches.findFirst({
    where: eq(grantTranches.id, id),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, row.projectId);
  return row;
}

export async function requireMilestone(ctx: GuardCtx, id: string) {
  const row = await ctx.db.query.milestones.findFirst({
    where: eq(milestones.id, id),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  await requireProject(ctx, row.projectId);
  return row;
}

/**
 * A preset usable for GENERATION by this project — either a system preset
 * (`projectId === null`, usable by every project) or one this project itself
 * owns. NOT_FOUND for both "missing" and "belongs to another project", same
 * enumeration-safety reasoning as every other guard here.
 */
export async function requirePresetUsableBy(
  ctx: GuardCtx,
  presetId: string,
  projectId: string
) {
  const row = await ctx.db.query.presets.findFirst({
    where: eq(presets.id, presetId),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  if (row.projectId !== null && row.projectId !== projectId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return row;
}

/**
 * A preset this project OWNS — required for edit/delete. A system preset
 * (`projectId === null`) is FORBIDDEN rather than NOT_FOUND: unlike an
 * unrelated project's private row, a system preset is visible to everyone via
 * `presets.list`, so its existence is not a secret — the caller just may not
 * modify it.
 */
export async function requireOwnedPreset(ctx: GuardCtx, presetId: string) {
  const row = await ctx.db.query.presets.findFirst({
    where: eq(presets.id, presetId),
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  if (row.projectId === null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "System presets cannot be modified.",
    });
  }
  await requireProject(ctx, row.projectId);
  return row;
}
