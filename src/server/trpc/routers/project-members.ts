import { z } from "zod";
import { eq, and, ilike } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { projectMembers, users } from "@/server/db/schema";
import { requireProject, requireProjectAdmin } from "../guards";
import { checkLimit, inviteLimiter } from "@/server/lib/ratelimit";
import { TRPCError } from "@trpc/server";

const ROLES = ["admin", "editor", "viewer"] as const;

/**
 * TODO-026 phase 1 — invited collaborators on a project. Every member is
 * treated as editor-equivalent by `requireProject` regardless of stored
 * role (see guards.ts); `role` is persisted now so a follow-up phase can
 * enforce viewer read-only / admin-only actions without a second
 * migration. Only `requireProjectAdmin` (owner or role='admin') can
 * invite, change roles, or remove members.
 */
export const projectMembersRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const project = await requireProject(ctx, input.projectId);
      const owner = await ctx.db.query.users.findFirst({
        where: eq(users.id, project.userId),
      });
      const members = await ctx.db.query.projectMembers.findMany({
        where: eq(projectMembers.projectId, input.projectId),
        with: { user: true },
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      });
      return {
        owner: owner
          ? { id: owner.id, email: owner.email, name: owner.name }
          : null,
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          email: m.user?.email ?? null,
          name: m.user?.name ?? null,
        })),
      };
    }),

  // Requires the invitee to already have a VaultBrief account (signed in
  // at least once) — we need a real users.id to key the membership row
  // on. No pending-invite/email-notification flow in phase 1; a founder
  // who wants to add a co-founder tells them to sign in first. A
  // magic-link-style pending invite (mirroring the Investor Portal
  // design) is a reasonable phase-2 addition, not built here.
  invite: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        email: z.string().trim().email(),
        role: z.enum(ROLES).default("editor"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await requireProjectAdmin(ctx, input.projectId);
      // Throttle before the enumeration-capable lookup runs, not just the
      // eventual write — probing arbitrary emails is the thing to bound.
      await checkLimit(inviteLimiter, ctx.session.user.id!);
      const email = input.email.toLowerCase();

      // Case-insensitive: users.email is never normalized to lowercase at
      // write time (see src/lib/auth.ts), so an exact match could silently
      // miss a real account. orderBy is a deterministic tie-break for the
      // (currently theoretical) case where two rows differ only by case.
      const invitee = await ctx.db.query.users.findFirst({
        where: ilike(users.email, email),
        orderBy: (u, { asc }) => [asc(u.createdAt)],
      });
      if (!invitee) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No VaultBrief account found for that email yet — ask them to sign in once first, then invite them.",
        });
      }
      if (invitee.id === project.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That's already the project owner.",
        });
      }

      const [member] = await ctx.db
        .insert(projectMembers)
        .values({ projectId: input.projectId, userId: invitee.id, role: input.role })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set: { role: input.role },
        })
        .returning();
      return member;
    }),

  updateRole: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        memberId: z.string().uuid(),
        role: z.enum(ROLES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAdmin(ctx, input.projectId);
      const [updated] = await ctx.db
        .update(projectMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(projectMembers.id, input.memberId),
            eq(projectMembers.projectId, input.projectId)
          )
        )
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  remove: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), memberId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAdmin(ctx, input.projectId);
      await ctx.db
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.id, input.memberId),
            eq(projectMembers.projectId, input.projectId)
          )
        );
      return { success: true };
    }),
});
