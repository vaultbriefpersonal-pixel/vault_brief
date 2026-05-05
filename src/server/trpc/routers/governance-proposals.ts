import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { governanceProposals } from "@/server/db/schema";
import { requireProject, requireGovernanceProposal } from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";

const PERIOD_RE = /^\d{4}-\d{2}$/;
const STATUS = ["submitted", "passed", "rejected", "active"] as const;

export const governanceProposalsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.governanceProposals.findMany({
        where: eq(governanceProposals.projectId, input.projectId),
        orderBy: (p, { desc }) => [desc(p.createdAt)],
      });
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1).max(300),
        status: z.enum(STATUS).default("submitted"),
        url: z.string().url().optional().nullable(),
        voteResult: z.string().max(200).optional().nullable(),
        period: z.string().regex(PERIOD_RE),
        notes: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const [row] = await ctx.db
        .insert(governanceProposals)
        .values(input)
        .returning();
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(300).optional(),
        status: z.enum(STATUS).optional(),
        url: z.string().url().optional().nullable(),
        voteResult: z.string().max(200).optional().nullable(),
        period: z.string().regex(PERIOD_RE).optional(),
        notes: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await requireGovernanceProposal(ctx, id);
      const [row] = await ctx.db
        .update(governanceProposals)
        .set(data)
        .where(eq(governanceProposals.id, id))
        .returning();
      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireGovernanceProposal(ctx, input.id);
      await ctx.db
        .delete(governanceProposals)
        .where(eq(governanceProposals.id, input.id));
      return { success: true };
    }),
});
