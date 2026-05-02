import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { projects } from "@/server/db/schema";
import { slugify } from "@/lib/utils";
import { TRPCError } from "@trpc/server";
import { requireProject } from "../guards";
import { checkLimit, projectCreateLimiter } from "@/server/lib/ratelimit";

const PLAN_PROJECT_LIMITS: Record<string, number> = {
  free: 1,
  starter: 1,
  growth: 1,
  vc_suite: 30,
};

export const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.projects.findMany({
      where: eq(projects.userId, ctx.session.user.id!),
      with: { wallets: true },
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        website: z.string().url().optional(),
        description: z.string().max(500).optional(),
        tokenSymbol: z.string().max(20).optional(),
        tokenContract: z.string().optional(),
        tokenChain: z.string().optional(),
        githubOrg: z.string().optional(),
        teamSize: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id!;
      await checkLimit(projectCreateLimiter, userId);
      const existing = await ctx.db.query.projects.findMany({
        where: eq(projects.userId, userId),
      });

      const plan = (ctx.session.user as { plan?: string }).plan ?? "free";
      const limit = PLAN_PROJECT_LIMITS[plan] ?? 1;
      if (existing.length >= limit) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your plan allows up to ${limit} project(s). Upgrade to add more.`,
        });
      }

      const baseSlug = slugify(input.name);
      // Ensure unique slug
      let slug = baseSlug;
      let attempt = 0;
      while (true) {
        const conflict = await ctx.db.query.projects.findFirst({
          where: eq(projects.slug, slug),
        });
        if (!conflict) break;
        attempt++;
        slug = `${baseSlug}-${attempt}`;
      }

      const [project] = await ctx.db
        .insert(projects)
        .values({ ...input, userId, slug })
        .returning();
      return project;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Ownership via guard, then refetch with relations.
      await requireProject(ctx, input.id);
      return ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.id),
        with: { wallets: true, milestones: true },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        website: z.string().url().optional().nullable(),
        description: z.string().max(500).optional().nullable(),
        tokenSymbol: z.string().max(20).optional().nullable(),
        tokenContract: z.string().optional().nullable(),
        tokenChain: z.string().optional().nullable(),
        githubOrg: z.string().optional().nullable(),
        teamSize: z.number().int().positive().optional().nullable(),
        foundedDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional()
          .nullable(),
        lastFundingRound: z.string().max(50).optional().nullable(),
        lastFundingAmount: z
          .union([z.number().positive(), z.string()])
          .optional()
          .nullable()
          .transform((v) => {
            if (v === null || v === undefined || v === "") return null;
            // Drizzle numeric columns accept strings; normalise to string for safety.
            return typeof v === "number" ? v.toString() : v;
          }),
        reportFrequency: z.enum(["monthly", "quarterly"]).optional(),
        reportDay: z.number().int().min(1).max(28).optional(),
        reportTimezone: z.string().optional(),
        customBranding: z
          .object({ primaryColor: z.string(), logoUrl: z.string() })
          .optional()
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await requireProject(ctx, id);
      const [updated] = await ctx.db
        .update(projects)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireProject(ctx, input.id);
      await ctx.db.delete(projects).where(eq(projects.id, input.id));
      return { success: true };
    }),
});
