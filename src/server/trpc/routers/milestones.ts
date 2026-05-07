import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { milestones } from "@/server/db/schema";
import { requireProject, requireMilestone } from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";

const STATUS = ["planned", "in_progress", "delayed", "completed"] as const;

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const milestonesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.milestones.findMany({
        where: eq(milestones.projectId, input.projectId),
        // Targeted/upcoming first, then planned, then completed (most
        // recent at top within each bucket). Lets the editor surface
        // "what's actively shipping" without users sorting manually.
        orderBy: (m, { asc, desc }) => [asc(m.completedDate), desc(m.createdAt)],
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const [row] = await ctx.db.insert(milestones).values(input).returning();
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await requireMilestone(ctx, id);
      const [row] = await ctx.db
        .update(milestones)
        .set(data)
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
