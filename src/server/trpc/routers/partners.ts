import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { partners } from "@/server/db/schema";
import { requireProject, requirePartner } from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";

const PERIOD_RE = /^\d{4}-\d{2}$/;
const TYPES = [
  "partnership",
  "integration",
  "listing",
  "bridge",
  "other",
] as const;

export const partnersRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.partners.findMany({
        where: eq(partners.projectId, input.projectId),
        orderBy: (p, { desc }) => [desc(p.createdAt)],
      });
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(200),
        type: z.enum(TYPES).optional().nullable(),
        url: z.string().url().optional().nullable(),
        period: z.string().regex(PERIOD_RE),
        notes: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const [row] = await ctx.db.insert(partners).values(input).returning();
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        type: z.enum(TYPES).optional().nullable(),
        url: z.string().url().optional().nullable(),
        period: z.string().regex(PERIOD_RE).optional(),
        notes: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await requirePartner(ctx, id);
      const [row] = await ctx.db
        .update(partners)
        .set(data)
        .where(eq(partners.id, id))
        .returning();
      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requirePartner(ctx, input.id);
      await ctx.db.delete(partners).where(eq(partners.id, input.id));
      return { success: true };
    }),
});
