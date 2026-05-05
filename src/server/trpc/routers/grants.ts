import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { grants } from "@/server/db/schema";
import { requireProject, requireGrant } from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";

const PERIOD_RE = /^\d{4}-\d{2}$/;
const STATUS = ["committed", "disbursed"] as const;

export const grantsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.grants.findMany({
        where: eq(grants.projectId, input.projectId),
        orderBy: (g, { desc }) => [desc(g.createdAt)],
      });
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        recipient: z.string().min(1).max(200),
        amountUsd: z.number().positive(),
        status: z.enum(STATUS).default("committed"),
        category: z.string().max(100).optional().nullable(),
        period: z.string().regex(PERIOD_RE),
        notes: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const [row] = await ctx.db
        .insert(grants)
        .values({
          ...input,
          amountUsd: input.amountUsd.toString(), // numeric column wants string
        })
        .returning();
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        recipient: z.string().min(1).max(200).optional(),
        amountUsd: z.number().positive().optional(),
        status: z.enum(STATUS).optional(),
        category: z.string().max(100).optional().nullable(),
        period: z.string().regex(PERIOD_RE).optional(),
        notes: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, amountUsd, ...rest } = input;
      await requireGrant(ctx, id);
      const [row] = await ctx.db
        .update(grants)
        .set({
          ...rest,
          ...(amountUsd !== undefined
            ? { amountUsd: amountUsd.toString() }
            : {}),
        })
        .where(eq(grants.id, id))
        .returning();
      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireGrant(ctx, input.id);
      await ctx.db.delete(grants).where(eq(grants.id, input.id));
      return { success: true };
    }),
});
