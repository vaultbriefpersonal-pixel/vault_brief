import { z } from "zod";
import { and, eq, gte, lte } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { projects, reports, wallets } from "@/server/db/schema";
import { slugify } from "@/lib/utils";
import { TRPCError } from "@trpc/server";
import { requireProject } from "../guards";
import {
  checkLimit,
  projectCreateLimiter,
  syncLimiter,
  backfillLimiter,
} from "@/server/lib/ratelimit";
import { createMonthlySnapshot, getLastMonthPeriod } from "@/server/services/data-sync";
import { generateAndSaveReport } from "@/server/services/report-generator";

// Mirror of validation in walletsRouter — keep in sync. Inlined here so the
// create-project mutation can validate wallets before any DB writes (one
// failed wallet shouldn't leave a half-onboarded project sitting around).
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const WALLET_CHAINS = [
  "ethereum",
  "polygon",
  "arbitrum",
  "base",
  "optimism",
  "solana",
] as const;
function isValidWalletAddress(address: string, chain: string): boolean {
  if (chain === "solana") return SOLANA_ADDRESS_RE.test(address);
  return EVM_ADDRESS_RE.test(address);
}

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
        // .trim() on every text input so a stray copy-paste space doesn't
        // wreck downstream API calls. We hit a real bug where ` ensdomains`
        // (leading space) hit GitHub as `/orgs/ ensdomains/repos` → 404 →
        // commits silently 0. Trim at the gateway, not the consumer.
        name: z.string().trim().min(1).max(100),
        website: z.string().trim().url().optional(),
        description: z.string().trim().max(500).optional(),
        tokenSymbol: z.string().trim().max(20).optional(),
        tokenContract: z.string().trim().optional(),
        tokenChain: z.string().trim().optional(),
        githubOrg: z.string().trim().optional(),
        teamSize: z.number().int().positive().optional(),
        // Optional onboarding context — surfaced in the report prompt and
        // makes the LLM narrative materially less generic on first runs.
        foundedDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional(),
        lastFundingRound: z.string().max(50).optional(),
        lastFundingAmount: z
          .union([z.number().positive(), z.string()])
          .optional()
          .transform((v) => {
            if (v === undefined || v === "") return undefined;
            return typeof v === "number" ? v.toString() : v;
          }),
        // Treasury wallets supplied during onboarding. Validated up-front so
        // a typo'd address doesn't create a half-onboarded project. Empty
        // array is fine (user can add later on /wallets), but providing them
        // here is the recommended path because it makes the post-create
        // dashboard non-empty on first visit.
        initialWallets: z
          .array(
            z.object({
              address: z.string().min(1),
              chain: z.enum(WALLET_CHAINS),
              label: z.string().max(100).optional(),
            })
          )
          .max(20)
          .optional(),
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

      // Pre-flight wallet validation. Pull this BEFORE the slug-uniqueness
      // loop so a bad address fails fast without N round-trips to Postgres.
      const initialWallets = input.initialWallets ?? [];
      for (const w of initialWallets) {
        if (!isValidWalletAddress(w.address, w.chain)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid ${w.chain} address: ${w.address.slice(0, 10)}…`,
          });
        }
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

      // Strip the wallets array — it's not a column on `projects`. Drizzle
      // would otherwise try to INSERT it and blow up.
      const { initialWallets: _omit, ...projectFields } = input;
      void _omit;

      const [project] = await ctx.db
        .insert(projects)
        .values({ ...projectFields, userId, slug })
        .returning();

      if (initialWallets.length > 0) {
        await ctx.db.insert(wallets).values(
          initialWallets.map((w) => ({
            projectId: project.id,
            address: w.address,
            chain: w.chain,
            label: w.label,
          }))
        );
      }

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
        name: z.string().trim().min(1).max(100).optional(),
        website: z.string().trim().url().optional().nullable(),
        description: z.string().trim().max(500).optional().nullable(),
        tokenSymbol: z.string().trim().max(20).optional().nullable(),
        tokenContract: z.string().trim().optional().nullable(),
        tokenChain: z.string().trim().optional().nullable(),
        githubOrg: z.string().trim().optional().nullable(),
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

  /**
   * Manual sync trigger — runs the same path as the monthly cron, but on-demand.
   * Default: last completed month. With months > 1, walks N most recent months
   * (oldest first so prev-month comparisons resolve correctly). Only the most
   * recent period triggers a report — backfill snapshots are data-only,
   * keeping LLM spend bounded.
   *
   * Rate limits:
   *   - 1-month sync: 3/hr per project (syncLimiter)
   *   - backfill (>1 month): additionally 2/day per project (backfillLimiter)
   */
  sync: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        months: z.number().int().min(1).max(12).default(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      await checkLimit(syncLimiter, input.projectId);
      if (input.months > 1) {
        await checkLimit(backfillLimiter, input.projectId);
      }

      // Build periods oldest → newest. getLastMonthPeriod() returns the most
      // recent fully-closed month; walk back from there.
      const periods: Array<{ start: Date; end: Date }> = [];
      const now = new Date();
      for (let i = input.months - 1; i >= 0; i--) {
        // i months back from "last completed month" — for i=0 → last month
        const start = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i, 0, 23, 59, 59);
        periods.push({ start, end });
      }

      const snapshotIds: string[] = [];
      const errors: Array<{ period: string; error: string }> = [];
      for (const period of periods) {
        try {
          const snap = await createMonthlySnapshot(input.projectId, period);
          snapshotIds.push(snap.id);
        } catch (err) {
          errors.push({
            period: period.end.toISOString().slice(0, 10),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const latestSnapshotId = snapshotIds[snapshotIds.length - 1];
      if (!latestSnapshotId) {
        return {
          snapshotIds,
          reportId: null,
          reportGenerated: false,
          errors,
        };
      }

      // Only generate a report for the most recent period. Older periods
      // remain data-only — comparisons surface them anyway.
      const latestPeriod = periods[periods.length - 1];
      const periodEndStr = latestPeriod.end.toISOString().split("T")[0];
      const periodStartStr = latestPeriod.start.toISOString().split("T")[0];
      const existing = await ctx.db.query.reports.findFirst({
        where: and(
          eq(reports.projectId, input.projectId),
          gte(reports.periodEnd, periodStartStr),
          lte(reports.periodEnd, periodEndStr)
        ),
      });

      if (existing) {
        return {
          snapshotIds,
          reportId: existing.id,
          reportGenerated: false,
          errors,
        };
      }

      try {
        const report = await generateAndSaveReport(input.projectId, latestSnapshotId);
        return {
          snapshotIds,
          reportId: report.id,
          reportGenerated: true,
          errors,
        };
      } catch (err) {
        console.error("sync: report generation failed:", err);
        return {
          snapshotIds,
          reportId: null,
          reportGenerated: false,
          reportError:
            err instanceof Error ? err.message : "Report generation failed",
          errors,
        };
      }
    }),
});
