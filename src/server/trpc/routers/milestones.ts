import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { milestones } from "@/server/db/schema";
import {
  requireProject,
  requireMilestone,
  requireGrantAward,
} from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";

const STATUS = ["planned", "in_progress", "delayed", "completed"] as const;

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/**
 * Resolve the grant award a milestone is being attached to, and refuse one
 * that belongs to a different project.
 *
 * `requireGrantAward` alone proves the CALLER may touch the award. It does not
 * prove the award and the milestone belong to the same project — and a user
 * who owns two projects could otherwise attach project A's deliverable to
 * project B's award, putting a milestone into a grant report written for a
 * funder who never commissioned it. Same class of hole as the destination
 * check on `grantAwards.updateTranche`.
 *
 * `null` is the detach case and needs no award at all.
 */
async function resolveGrantAwardId(
  ctx: Parameters<typeof requireGrantAward>[0],
  grantAwardId: string | null | undefined,
  projectId: string
): Promise<string | null | undefined> {
  if (grantAwardId === undefined) return undefined; // absent in a PATCH
  if (grantAwardId === null) return null; // detach
  const award = await requireGrantAward(ctx, grantAwardId);
  if (award.projectId !== projectId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That grant award belongs to a different project.",
    });
  }
  return award.id;
}

export const milestonesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      const rows = await ctx.db.query.milestones.findMany({
        where: eq(milestones.projectId, input.projectId),
        orderBy: (m, { desc }) => [desc(m.createdAt)],
      });
      // Active work (planned/in_progress/delayed) sorts above completed.
      // The DB-level ORDER BY can't easily express this without
      // introducing CASE expressions; doing it in JS keeps the SQL clean
      // and the list is small (per-project, not paginated).
      const isActive = (s: string) => s !== "completed";
      return rows.sort((a, b) => {
        const aa = isActive(a.status) ? 0 : 1;
        const bb = isActive(b.status) ? 0 : 1;
        if (aa !== bb) return aa - bb;
        return 0; // preserve createdAt-desc within each bucket
      });
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(1000).optional().nullable(),
        status: z.enum(STATUS).default("planned"),
        targetDate: ISO_DATE.optional().nullable(),
        completedDate: ISO_DATE.optional().nullable(),
        /**
         * Optional link to a grant award this milestone is a deliverable for.
         * Null and absent both mean "ordinary roadmap work", which is the
         * normal case — the FK carries the fact, there is no boolean beside it.
         * Set, it is what makes the row visible to `grant_milestone_progress`.
         */
        grantAwardId: z.string().uuid().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const grantAwardId = await resolveGrantAwardId(
        ctx,
        input.grantAwardId,
        input.projectId
      );
      const [row] = await ctx.db
        .insert(milestones)
        .values({ ...input, grantAwardId: grantAwardId ?? null })
        .returning();
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(1000).optional().nullable(),
        status: z.enum(STATUS).optional(),
        targetDate: ISO_DATE.optional().nullable(),
        completedDate: ISO_DATE.optional().nullable(),
        /** Null detaches the milestone from its award without deleting it. */
        grantAwardId: z.string().uuid().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, grantAwardId, ...data } = input;
      // The milestone's own project is the authority for the cross-project
      // check — never a projectId from the client, which this procedure
      // deliberately does not accept.
      const existing = await requireMilestone(ctx, id);
      const resolved = await resolveGrantAwardId(
        ctx,
        grantAwardId,
        existing.projectId
      );
      const [row] = await ctx.db
        .update(milestones)
        .set({
          ...data,
          ...(resolved !== undefined ? { grantAwardId: resolved } : {}),
        })
        .where(eq(milestones.id, id))
        .returning();
      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMilestone(ctx, input.id);
      await ctx.db.delete(milestones).where(eq(milestones.id, input.id));
      return { success: true };
    }),
});
