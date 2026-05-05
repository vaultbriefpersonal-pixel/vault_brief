import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { qaHighlights } from "@/server/db/schema";
import { requireProject, requireQaHighlight } from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";

const PERIOD_RE = /^\d{4}-\d{2}$/;

export const qaHighlightsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.qaHighlights.findMany({
        where: eq(qaHighlights.projectId, input.projectId),
        orderBy: (q, { asc, desc }) => [
          asc(q.displayOrder),
          desc(q.createdAt),
        ],
      });
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        question: z.string().min(1).max(500),
        answer: z.string().min(1).max(2000),
        askedBy: z.string().max(120).optional().nullable(),
        period: z.string().regex(PERIOD_RE),
        displayOrder: z.number().int().min(0).max(999).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const [row] = await ctx.db
        .insert(qaHighlights)
        .values(input)
        .returning();
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        question: z.string().min(1).max(500).optional(),
        answer: z.string().min(1).max(2000).optional(),
        askedBy: z.string().max(120).optional().nullable(),
        period: z.string().regex(PERIOD_RE).optional(),
        displayOrder: z.number().int().min(0).max(999).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await requireQaHighlight(ctx, id);
      const [row] = await ctx.db
        .update(qaHighlights)
        .set(data)
        .where(eq(qaHighlights.id, id))
        .returning();
      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireQaHighlight(ctx, input.id);
      await ctx.db
        .delete(qaHighlights)
        .where(eq(qaHighlights.id, input.id));
      return { success: true };
    }),
});
