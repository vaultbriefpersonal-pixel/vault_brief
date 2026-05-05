import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { asks } from "@/server/db/schema";
import { requireProject, requireAsk } from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";

const STATUS = ["open", "resolved"] as const;
const CATEGORIES = ["intros", "governance", "hiring", "other"] as const;

export const asksRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.asks.findMany({
        where: eq(asks.projectId, input.projectId),
        orderBy: (a, { desc }) => [desc(a.createdAt)],
      });
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        request: z.string().min(1).max(500),
        category: z.enum(CATEGORIES).optional().nullable(),
        status: z.enum(STATUS).default("open"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const [row] = await ctx.db.insert(asks).values(input).returning();
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        request: z.string().min(1).max(500).optional(),
        category: z.enum(CATEGORIES).optional().nullable(),
        status: z.enum(STATUS).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await requireAsk(ctx, id);
      const [row] = await ctx.db
        .update(asks)
        .set(data)
        .where(eq(asks.id, id))
        .returning();
      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireAsk(ctx, input.id);
      await ctx.db.delete(asks).where(eq(asks.id, input.id));
      return { success: true };
    }),
});
