import { z } from "zod";
import { and, eq, gte, lte, lt, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import {
  projects,
  reports,
  wallets,
  treasurySnapshots,
  investors,
  milestones,
  grants,
  governanceProposals,
  partners,
  asks,
  qaHighlights,
} from "@/server/db/schema";
import { slugify } from "@/lib/utils";
import { TRPCError } from "@trpc/server";
import { requireProject } from "../guards";
import {
  checkLimit,
  projectCreateLimiter,
  syncLimiter,
  backfillLimiter,
  autofillLimiter,
} from "@/server/lib/ratelimit";
import { fetchTokenMetadata } from "@/server/services/project-autofill";
import { assertTrialActive } from "@/server/lib/plan-limits";
import { createMonthlySnapshot, getLastMonthPeriod } from "@/server/services/data-sync";
import { generateAndSaveReport } from "@/server/services/report-generator";
import { evaluateReadiness } from "@/server/services/report-sections";

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
      await assertTrialActive(userId);
      await checkLimit(projectCreateLimiter, userId);
      // Public-goods pivot: no per-plan project cap.

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
        snapshotSpace: z.string().trim().min(1).max(120).optional().nullable(),
        // Per-project report-template config — ordered list of section
        // ids with on/off flags. Null clears it back to product defaults.
        reportSections: z
          .array(
            z.object({
              id: z.string().min(1).max(64),
              enabled: z.boolean(),
            })
          )
          .max(64)
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
   * Look up a token contract on CoinGecko and return project metadata
   * (name, symbol, description, website, github org, founded date,
   * category) for the create/edit form to prefill empty fields. The
   * client decides which fields to merge — we never write to the DB.
   *
   * Returns `null` when the token isn't on CG, the chain isn't supported,
   * or CG is unreachable. The form falls back to manual entry in all of
   * those cases.
   */
  autofillFromContract: protectedProcedure
    .input(
      z.object({
        chain: z.string().min(1),
        contract: z.string().trim().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkLimit(autofillLimiter, ctx.session.user.id!);
      return await fetchTokenMetadata(input);
    }),

  /**
   * Clone the project's metadata + wallets into a new project. Snapshots,
   * reports, investors, milestones are NOT copied — those are derived
   * data; let the duplicate sync them fresh. Useful for "set up a sister
   * project with the same wallets but different reporting cadence", or
   * sandboxing a copy before changing branding/template.
   *
   * Honors plan project limit + project-create rate limit + trial gate.
   */
  duplicate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id!;
      await assertTrialActive(userId);
      await requireProject(ctx, input.id);
      await checkLimit(projectCreateLimiter, userId);
      // Public-goods pivot: no per-plan project cap.

      const original = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.id),
        with: { wallets: true },
      });
      if (!original) throw new TRPCError({ code: "NOT_FOUND" });

      // Find an available slug. " (copy)" suffix is the most legible way
      // to mark it; collisions get -2, -3, ... appended.
      const baseSlug = `${original.slug}-copy`;
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

      // Strip immutable / derived fields. id/createdAt/updatedAt regenerate;
      // slug + name we set explicitly.
      const {
        id: _id,
        createdAt: _ca,
        updatedAt: _ua,
        slug: _slug,
        name: _name,
        wallets: _wallets,
        ...rest
      } = original as typeof original & { id: string };
      void _id;
      void _ca;
      void _ua;
      void _slug;
      void _wallets;

      const [copy] = await ctx.db
        .insert(projects)
        .values({
          ...rest,
          userId,
          name: `${_name} (copy)`,
          slug,
        })
        .returning();

      if (original.wallets.length > 0) {
        await ctx.db.insert(wallets).values(
          original.wallets.map((w) => ({
            projectId: copy.id,
            address: w.address,
            chain: w.chain,
            label: w.label,
          }))
        );
      }

      return copy;
    }),

  /**
   * Per-section readiness verdict for the constructor UI. Loads the
   * latest snapshot + previous + milestones, builds the same context
   * used at report-generation time, runs each section's `requires()`
   * predicate, and returns a flat array of {id, ready, reason}.
   *
   * Lets the editor surface chips like "Needs ≥2 chains" or
   * "Coming soon — no grants pipeline" so founders understand why
   * enabling a section doesn't immediately produce visible output.
   */
  getSectionReadiness: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const snapshot = await ctx.db.query.treasurySnapshots.findFirst({
        where: eq(treasurySnapshots.projectId, input.projectId),
        orderBy: [desc(treasurySnapshots.snapshotDate)],
      });
      const prevSnapshot = snapshot
        ? await ctx.db.query.treasurySnapshots.findFirst({
            where: and(
              eq(treasurySnapshots.projectId, input.projectId),
              lt(treasurySnapshots.snapshotDate, snapshot.snapshotDate)
            ),
            orderBy: [desc(treasurySnapshots.snapshotDate)],
          })
        : undefined;
      const [
        projectMilestones,
        grantsRows,
        govProposalsRows,
        partnersRows,
        asksRows,
        qaRows,
      ] = await Promise.all([
        ctx.db.query.milestones.findMany({
          where: eq(milestones.projectId, input.projectId),
        }),
        ctx.db.query.grants.findMany({
          where: eq(grants.projectId, input.projectId),
        }),
        ctx.db.query.governanceProposals.findMany({
          where: eq(governanceProposals.projectId, input.projectId),
        }),
        ctx.db.query.partners.findMany({
          where: eq(partners.projectId, input.projectId),
        }),
        ctx.db.query.asks.findMany({
          where: eq(asks.projectId, input.projectId),
        }),
        ctx.db.query.qaHighlights.findMany({
          where: eq(qaHighlights.projectId, input.projectId),
        }),
      ]);

      // No snapshot at all → every section is "Run a sync first".
      if (!snapshot) {
        return {
          hasSnapshot: false as const,
          readiness: [] as Array<{
            id: string;
            ready: false;
            reason: string;
          }>,
        };
      }

      const total = Number(snapshot.totalBalanceUsd ?? 0);
      const period = String(snapshot.snapshotDate).slice(0, 7);
      const readiness = evaluateReadiness({
        snapshot,
        prevSnapshot,
        project,
        milestones: projectMilestones,
        grants: grantsRows,
        governanceProposals: govProposalsRows,
        partners: partnersRows,
        asks: asksRows,
        qaHighlights: qaRows,
        period,
        total,
        minSignificant: total > 0 ? total * 0.001 : 0,
      });

      return { hasSnapshot: true as const, readiness };
    }),

  /**
   * Full project data export. Returns a self-contained JSON object the
   * client serializes and downloads. Read-only — no trial gate, so users
   * can export their data even after trial expiry (data portability is
   * not gated behind payment).
   */
  export: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.id);

      const [project, walletRows, snapshotRows, reportRows, investorRows, milestoneRows] =
        await Promise.all([
          ctx.db.query.projects.findFirst({ where: eq(projects.id, input.id) }),
          ctx.db.query.wallets.findMany({
            where: eq(wallets.projectId, input.id),
          }),
          ctx.db.query.treasurySnapshots.findMany({
            where: eq(treasurySnapshots.projectId, input.id),
          }),
          ctx.db.query.reports.findMany({
            where: eq(reports.projectId, input.id),
          }),
          ctx.db.query.investors.findMany({
            where: eq(investors.projectId, input.id),
          }),
          ctx.db.query.milestones.findMany({
            where: eq(milestones.projectId, input.id),
          }),
        ]);

      return {
        exportedAt: new Date().toISOString(),
        schemaVersion: 1,
        project,
        wallets: walletRows,
        snapshots: snapshotRows,
        reports: reportRows,
        investors: investorRows,
        milestones: milestoneRows,
      };
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
      await assertTrialActive(ctx.session.user.id!);
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
