import { z } from "zod";
import { and, eq, lt, desc, or, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import {
  projects,
  projectMembers,
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
  projectBudgets,
  grantAwards,
  grantTranches,
} from "@/server/db/schema";
import { slugify, formatDate } from "@/lib/utils";
import { TRPCError } from "@trpc/server";
import { requireProject, requireProjectAdmin } from "../guards";
import {
  checkLimit,
  projectCreateLimiter,
  syncLimiter,
  backfillLimiter,
  autofillLimiter,
} from "@/server/lib/ratelimit";
import { fetchTokenMetadata } from "@/server/services/project-autofill";
import { assertTrialActive, reportAllowance } from "@/server/lib/plan-limits";
import {
  prepareMonthlySnapshot,
  writeSnapshot,
  type PrecomputedBalances,
  type PreparedSnapshot,
} from "@/server/services/data-sync";
import {
  priceReconstruction,
  reconstructBalances,
  reconstructionSymbols,
  type CarriedForwardWallet,
} from "@/server/services/balance-reconstruction";
import { getHistoricalPrice } from "@/server/services/price-resolver";
import { generateAndSaveReport } from "@/server/services/report-generator";
import { evaluateReadiness } from "@/server/services/report-sections";
import { changeSignificanceFloor } from "@/server/services/report-derived";
import {
  assertCustomSyncWindow,
  periodFromRange,
  periodFromSnapshot,
} from "@/server/services/report-period";

// Mirror of validation in walletsRouter — keep in sync. Inlined here so the
// create-project mutation can validate wallets before any DB writes (one
// failed wallet shouldn't leave a half-onboarded project sitting around).
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** A `date` column as it travels over the wire — mirrors `isoDate` in reports.ts. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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
  // Owned projects + any project this user was invited onto (TODO-026).
  list: protectedProcedure.query(async ({ ctx }) => {
    const uid = ctx.session.user.id!;
    const memberships = await ctx.db.query.projectMembers.findMany({
      where: eq(projectMembers.userId, uid),
    });
    const memberProjectIds = memberships.map((m) => m.projectId);

    return ctx.db.query.projects.findMany({
      where:
        memberProjectIds.length > 0
          ? or(eq(projects.userId, uid), inArray(projects.id, memberProjectIds))
          : eq(projects.userId, uid),
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

  // Trailing treasury/burn history for the trend chart on the report
  // editor + public investor view. Same trailing-12 query and date-
  // formatting the /projects/[id] dashboard already uses for
  // TreasuryChart/BurnRateChart — kept identical here so both surfaces
  // render the exact same numbers, just reachable via tRPC instead of
  // a direct server-component query.
  getSnapshotTrend: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      const snapshots = await ctx.db.query.treasurySnapshots.findMany({
        where: eq(treasurySnapshots.projectId, input.projectId),
        orderBy: [desc(treasurySnapshots.snapshotDate)],
        limit: 12,
      });
      const chronological = [...snapshots].reverse();
      return {
        treasury: chronological.map((s) => ({
          date: formatDate(s.snapshotDate),
          totalBalanceUsd: Number(s.totalBalanceUsd ?? 0),
        })),
        burn: chronological.map((s) => ({
          date: formatDate(s.snapshotDate),
          burnRateUsd: Number(s.burnRateUsd ?? 0),
        })),
      };
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
        /**
         * Where the live figures actually live — read by the
         * `external_dashboard` section, whose claim is that this report is a
         * snapshot and the dashboard is the source of truth.
         *
         * `url()` HERE and not on the per-item `sourceOfTruth` fields, and the
         * difference is deliberate: this value is rendered to a reader as
         * somewhere to GO, so it has to be navigable, whereas a Source of
         * Truth may legitimately be a bare tx hash or address. Null clears it,
         * which silences the section.
         */
        externalDashboardUrl: z
          .string()
          .trim()
          .url()
          .max(500)
          .optional()
          .nullable(),
        discordWebhookUrl: z
          .string()
          .trim()
          .url()
          .optional()
          .nullable(),
        telegramBotToken: z.string().trim().min(1).optional().nullable(),
        telegramChatId: z.string().trim().min(1).optional().nullable(),
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

  // Admin-only (owner or role='admin') — deleting the project removes
  // access for every member, not just an editor's own work.
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAdmin(ctx, input.id);
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
      // Prior snapshots, most-recent-first, EXCLUDING the current one — the
      // ordering `ReportSectionContext.trailing` documents. Fetched as a
      // series rather than a single row because `requires()` gates now read
      // it: the Next Period Projection needs two prior periods before a
      // "trailing average" means anything, and readiness answers that gate
      // with the same data report generation will.
      const trailing = snapshot
        ? await ctx.db.query.treasurySnapshots.findMany({
            where: and(
              eq(treasurySnapshots.projectId, input.projectId),
              lt(treasurySnapshots.snapshotDate, snapshot.snapshotDate)
            ),
            orderBy: [desc(treasurySnapshots.snapshotDate)],
            limit: 3,
          })
        : [];
      const prevSnapshot = trailing[0];
      const [
        projectMilestones,
        grantsRows,
        govProposalsRows,
        partnersRows,
        asksRows,
        qaRows,
        budgetRows,
        grantAwardRows,
        grantTrancheRows,
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
        // Without this the Plan vs Actual chip would read "not ready" for a
        // founder who HAS entered a budget — a readiness verdict that is
        // simply wrong, and permanently so.
        ctx.db.query.projectBudgets.findMany({
          where: eq(projectBudgets.projectId, input.projectId),
        }),
        // Same reasoning as the budget rows above, and the same failure if
        // omitted: both grant sections gate on these, so without them the
        // constructor's chips would read "not ready" for a founder who HAS
        // entered a grant award — permanently, with no way to tell from the
        // UI that the data is fine and the endpoint simply never looked.
        ctx.db.query.grantAwards.findMany({
          where: eq(grantAwards.projectId, input.projectId),
        }),
        ctx.db.query.grantTranches.findMany({
          where: eq(grantTranches.projectId, input.projectId),
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
      // Derived exactly as `buildReportPrompts` derives it, and for the same
      // reason `minSignificant` below is: two derivations of the same named
      // field can disagree, and then this endpoint's readiness chip says a
      // section will render while the report that actually runs decides it
      // will not. Several sections now gate on `period.kind`.
      const period = periodFromSnapshot(snapshot);
      const readiness = evaluateReadiness({
        snapshot,
        prevSnapshot,
        trailing,
        project,
        milestones: projectMilestones,
        grants: grantsRows,
        governanceProposals: govProposalsRows,
        partners: partnersRows,
        asks: asksRows,
        qaHighlights: qaRows,
        budgets: budgetRows,
        grantAwards: grantAwardRows,
        grantTranches: grantTrancheRows,
        // Readiness does not run the anomaly detector — that needs the
        // trailing series this endpoint deliberately skips, and detection is
        // a report-time computation. Empty means the Anomalies chip reads
        // "not ready", which its notReadyHint explains: the section works,
        // it just isn't evaluated here.
        anomalies: [],
        period,
        total,
        // Shared with `buildReportPrompts` so the readiness chip in the
        // constructor UI and the report that actually runs cannot use two
        // different floors for the same named field.
        minSignificant: changeSignificanceFloor(total),
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
   * Default: last completed month. With months > 1, backfills the N most recent
   * months. Only the most recent period triggers a report — backfill snapshots
   * are data-only, keeping LLM spend bounded.
   *
   * ─── TWO PASSES, IN OPPOSITE DIRECTIONS ───────────────────────────────────
   *
   * This used to be one loop, oldest → newest, calling `createMonthlySnapshot`
   * for each period. Every call did its own live balance read, so a 12-month
   * backfill wrote twelve rows carrying ONE set of balances — today's — under
   * twelve different dates, with nothing in the output to say so. That is why
   * every `months > 1` option was disabled in the UI.
   *
   * Now:
   *   Pass 1, NEWEST → OLDEST. One live balance read, for the newest period
   *   only; it is the sole `observed` row. Preparing a period also yields that
   *   period's transfer legs, and those legs walk the NEXT OLDER period's
   *   balances back through `qty(t−1) = qty(t) − inbound(t) + outbound(t)`.
   *   The chain therefore runs backwards by construction: period k's balances
   *   cannot be known until period k+1 has been fetched.
   *
   *   Pass 2, OLDEST → NEWEST. Write the buffered rows. Order matters on
   *   failure, not on success: a run that dies partway through leaves a
   *   contiguous run of older snapshots with the newest missing, which reads as
   *   "the backfill did not finish". Writing newest-first would leave holes in
   *   the middle of the history instead, and a hole is what
   *   `comparableTrailing` silently steps over.
   *
   * Only the newest period is `observed`; everything older is `reconstructed`
   * and says so in `balance_basis`.
   *
   * ─── ONE EXPLICIT WINDOW, INSTEAD OF N MONTHS ─────────────────────────────
   *
   * `period` is the alternative to `months`, and the two are MUTUALLY
   * EXCLUSIVE — supplying both is refused rather than silently resolved, since
   * either choice of winner would give a caller a window it did not ask for.
   * With a period, `periods` is that single window and everything below runs
   * unchanged: pass 1 executes once with `carried === null` (a live balance
   * read), hits `if (i === 0) break` so nothing is walked back, and the row is
   * `observed`. Pass 2, the dedup and the report path are already period-shaped.
   *
   * This is the only thing that could ever create a non-month snapshot, and
   * therefore the only thing that makes "since we received the grant, through
   * now" reportable.
   *
   * Rate limits:
   *   - 1-month sync: 3/hr per project (syncLimiter)
   *   - backfill (>1 month) AND any custom window: additionally 2/day per
   *     project (backfillLimiter). A custom window can span a year of transfer
   *     history in one call, which is the cost `backfillLimiter` exists to
   *     bound — the fact that it writes one row rather than twelve does not
   *     make it cheap.
   */
  sync: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        // No `.default(1)`: the default has to be applied AFTER the
        // mutual-exclusion check, or a caller who passed only `period` would
        // arrive here holding `months: 1` and be refused for contradicting
        // itself.
        months: z.number().int().min(1).max(12).optional(),
        period: z
          .object({
            start: z.string().regex(ISO_DATE_RE, "expected a 'YYYY-MM-DD' date"),
            end: z.string().regex(ISO_DATE_RE, "expected a 'YYYY-MM-DD' date"),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      if (input.months !== undefined && input.period) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Pass either `months` (whole calendar months, walked backwards from the last completed one) " +
            "or `period` (one explicit window), not both — they describe different windows and there is " +
            "no sensible way to honour both.",
        });
      }
      // Needed beyond the access check: `priceReconstruction` classifies the
      // walked-back holdings through the SAME own-token predicate every other
      // surface uses, and that predicate reads the project's token identity.
      const project = await requireProject(ctx, input.projectId);
      await checkLimit(syncLimiter, input.projectId);
      if (input.period || (input.months ?? 1) > 1) {
        await checkLimit(backfillLimiter, input.projectId);
      }

      const periods: Array<{ start: Date; end: Date }> = [];
      // The 'YYYY-MM-DD' each period is KNOWN by, parallel to `periods`. The
      // months path keeps deriving it exactly as before
      // (`end.toISOString().slice(0,10)`); the custom path uses the window it
      // validated, because that Date is a LOCAL end-of-day and its UTC
      // projection is a day later west of Greenwich.
      const periodLabels: string[] = [];
      // The exact stored window per period, or null to let data-sync derive it.
      const storedPeriods: Array<{ start: string; end: string } | null> = [];
      const now = new Date();
      if (input.period) {
        // `periodFromRange` is the validator for shape: it already refuses an
        // unparseable or inverted range with a message that names the offending
        // value, so re-deriving those checks here would be a second, weaker copy.
        let window;
        try {
          window = periodFromRange(input.period.start, input.period.end);
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err instanceof Error ? err.message : "Invalid period",
          });
        }
        // The rule that matters: an end date at/near today. Balances are read
        // live and a lone window has no chain to walk back through, so a window
        // ending in the past would write today's balances under a past date
        // AND stamp them `observed`. Lives in report-period.ts so the picker
        // enforces the identical rule without a second copy of it.
        const support = assertCustomSyncWindow(window, now);
        if (!support.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: support.reason });
        }
        // ── the two dates, and why they are built LOCALLY ──
        //
        // These Dates are consumed as INSTANTS, by `fetchAndClassify` (block
        // lookup either side of the window), `fetchGitHubActivity`, and
        // `monthsInDateRange`, which divides this period's outflows into a
        // per-month burn. `monthsInDateRange` reads LOCAL components — it has
        // to, because the months loop below builds its Dates with local
        // constructors and reading those as UTC would turn every ordinary
        // monthly sync into a 31-day custom period east of Greenwich. Handing
        // it UTC-anchored Dates instead breaks the same function from the other
        // side: at UTC-4 a window of 2 → 31 July has a LOCAL start of the 1st,
        // so it is misread as a calendar month and normalised by 1 instead of
        // by 30/30.4375.
        //
        // Matching the months path's convention is therefore the correct choice
        // for the instants. What it costs is the STORED pair — a local
        // end-of-day projects onto the next UTC day west of Greenwich — and
        // that is paid for separately, by handing `prepareMonthlySnapshot` the
        // validated window verbatim through `storedPeriod`. The stored
        // `(period_start, snapshot_date)` is then exactly what was asked for in
        // every timezone, which is what lets the resulting snapshot be found
        // again: a report's period must match its snapshot's period EXACTLY.
        const [sy, sm, sd] = window.start.split("-").map(Number);
        const [ey, em, ed] = window.end.split("-").map(Number);
        periods.push({
          start: new Date(sy, sm - 1, sd),
          end: new Date(ey, em - 1, ed, 23, 59, 59),
        });
        periodLabels.push(window.end);
        storedPeriods.push({ start: window.start, end: window.end });
      } else {
        // Build periods oldest → newest. getLastMonthPeriod() returns the most
        // recent fully-closed month; walk back from there. UNCHANGED — this is
        // the entire back-compat surface, and `sync` with no `period` argument
        // must build exactly the windows it built before.
        const months = input.months ?? 1;
        for (let i = months - 1; i >= 0; i--) {
          // i months back from "last completed month" — for i=0 → last month
          const start = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
          const end = new Date(now.getFullYear(), now.getMonth() - i, 0, 23, 59, 59);
          periods.push({ start, end });
          // Derived exactly as before, and `storedPeriod` stays null so
          // `prepareMonthlySnapshot` keeps deriving the pair through
          // `snapshotPeriodStart`. Both arrays are filled on THIS path too so
          // they stay index-parallel with `periods` — a months sync that left
          // them empty would make every `periodLabels[i]` below undefined.
          periodLabels.push(end.toISOString().slice(0, 10));
          storedPeriods.push(null);
        }
      }

      // Per-period failures, returned rather than thrown so a partial backfill
      // still reports what it did manage.
      //
      // THE COLLISION REFUSAL ARRIVES HERE, AND IT IS CORRECT.
      // `prepareMonthlySnapshot` calls `snapshotPeriodConflicts` and throws when
      // a snapshot already exists at this `snapshot_date` describing a DIFFERENT
      // window — which a grant window ending on a month-end will hit, because
      // `treasury_snapshots` is unique on `(project_id, snapshot_date)` ALONE
      // and that month's monthly snapshot already occupies the row. Overwriting
      // it would silently change the data under any report already pointing at
      // it. Widening the unique key to include `period_start` is a separate
      // migration (it invalidates this file's `ON CONFLICT` target the instant
      // the DDL lands), so until then the refusal is the guard, not a bug — and
      // its message has to reach the caller intact, which is what this array is
      // for. Callers must surface `errors[].error` verbatim.
      const errors: Array<{ period: string; error: string }> = [];

      // ── Pass 1: newest → oldest, chaining from one live balance read ──────
      //
      // `prepared[i]` lines up with `periods[i]`; holes stay undefined so a
      // failed period does not shift the ones around it.
      const prepared: Array<PreparedSnapshot | undefined> = new Array(
        periods.length
      );
      // The balances for the period about to be prepared. Null means "read them
      // live", which is true exactly once — for the newest period.
      let carried: PrecomputedBalances | null = null;
      // Read from the parallel array, never re-derived from `period.end`. On the
      // custom path that Date is a LOCAL end-of-day whose UTC projection is a
      // day later west of Greenwich, so re-deriving here would label the
      // reconstruction with a date the row does not carry.
      const observedAsOf = periodLabels[periods.length - 1];

      for (let i = periods.length - 1; i >= 0; i--) {
        const period = periods[i];
        try {
          const result = await prepareMonthlySnapshot(
            input.projectId,
            period,
            {
              precomputedBalances: carried,
              // The window this sync validated, verbatim. Null on the months
              // path, where `snapshotPeriodStart` derives the pair exactly as
              // it always has. Without this the custom path falls back to that
              // derivation and stores a window nobody asked for: a local
              // end-of-day projects onto the next UTC day west of Greenwich,
              // and `snapshotPeriodStart` reading local components can call a
              // 2→31 July window a calendar month — which also switches
              // per-month normalisation off for a 30-day period. Either way the
              // stored pair stops matching what the picker asks for, and
              // `snapshotCovering` matches start and end EXACTLY, so the
              // founder's window becomes unreachable forever.
              storedPeriod: storedPeriods[i],
            }
          );
          prepared[i] = result;

          if (i === 0) break; // nothing older to walk back to

          // Walk this period's balances back to its own start, which is the
          // next older period's end. `values.balancesDetail` is used rather
          // than the incoming `carried` because it is the SAME payload the row
          // will store, so the arithmetic and the record can never disagree.
          const source = result.values.balancesDetail;
          const carriedForward: CarriedForwardWallet[] = [
            ...result.unreconstructableWallets,
          ];
          // No legs at all means the transfer fetch failed outright — the
          // walk-back would then be the identity function, i.e. today's
          // balances under a past date, wearing a `reconstructed` label. That
          // is the original bug with a disclosure bolted on. Say what happened
          // instead.
          if (result.balanceLegs.length === 0 && carriedForward.length === 0) {
            carriedForward.push({
              chain: "*",
              address: "*",
              reason:
                "No transfer legs were returned for this period, so nothing could be walked back — these holdings are the later period's, carried forward unchanged.",
            });
          }

          const walked = reconstructBalances({
            balances: source,
            transfers: result.balanceLegs,
            asOf: periodLabels[i - 1],
            observedAsOf,
            stepsFromObserved: periods.length - i,
            carriedForwardWallets: carriedForward,
          });

          // Historical pricing, one lookup per distinct symbol per period.
          // `getHistoricalPrice` is memoised in-process and persists to
          // `token_prices`, so a 12-month backfill of a 10-token treasury is
          // ~120 lookups of which most are cache hits. A symbol with no price
          // at that date resolves to null and the position is carried at zero
          // USD and counted — never at today's price.
          const priceAt = new Date(`${walked.meta.asOf}T00:00:00.000Z`);
          const prices = new Map<string, number | null>();
          for (const symbol of reconstructionSymbols(walked)) {
            prices.set(
              symbol,
              await getHistoricalPrice(symbol, priceAt).catch(() => null)
            );
          }
          const priced = priceReconstruction(walked, prices, project);

          carried = {
            basis: "reconstructed",
            meta: priced.meta,
            balances: {
              totalBalanceUsd: priced.totalBalanceUsd,
              stablecoinsUsd: priced.stablecoinsUsd,
              ethUsd: priced.ethUsd,
              nativeTokenUsd: priced.nativeTokenUsd,
              otherAssetsUsd: priced.otherAssetsUsd,
              balancesDetail: priced.balancesDetail,
              // Balance-fetch warnings belong to a live read. This period had
              // none; what went wrong with the reconstruction lives in
              // `reconstruction_meta`, which is where a reader looks for it.
              warnings: [],
            },
          };
        } catch (err) {
          errors.push({
            period: periodLabels[i],
            error: err instanceof Error ? err.message : String(err),
          });
          // The chain is broken: without this period's legs there is no honest
          // way to reach the older ones. Stop rather than reconstructing the
          // remainder from balances that skipped a period.
          break;
        }
      }

      // ── Pass 2: oldest → newest, write the buffered rows ──────────────────
      const snapshotIds: string[] = [];
      // The newest row that actually made it to the database. Held as the ROW,
      // not just its id, because the dedup check below and the report's own
      // period both have to be derived from what was written rather than from
      // `periods[last]` — which is a different thing whenever the newest period
      // is the one that failed.
      let latestSnapshot: Awaited<ReturnType<typeof writeSnapshot>> | undefined;
      for (let i = 0; i < periods.length; i++) {
        const row = prepared[i];
        if (!row) continue;
        try {
          const snap = await writeSnapshot(row);
          snapshotIds.push(snap.id);
          latestSnapshot = snap; // loop runs oldest → newest, so this ends on the newest
        } catch (err) {
          errors.push({
            period: periodLabels[i],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (!latestSnapshot) {
        return {
          snapshotIds,
          reportId: null,
          reportGenerated: false,
          errors,
        };
      }

      // Only generate a report for the most recent period. Older periods
      // remain data-only — comparisons surface them anyway.
      //
      // DEDUP ON THE PERIOD ITSELF, NOT ON A RANGE OVER `periodEnd`.
      //
      // This used to ask "does a report exist whose periodEnd falls anywhere
      // inside this month?":
      //
      //     gte(reports.periodEnd, periodStartStr), lte(reports.periodEnd, periodEndStr)
      //
      // While every report was a calendar month that was an equality in
      // disguise — the only periodEnd that can land in a month is that month's
      // last day. It stops being one the moment arbitrary periods exist: a
      // grant report ending on the 14th sits inside the month's range, matches,
      // and SUPPRESSES that month's monthly report entirely. The founder gets
      // no monthly report and no error, and the missing row looks like a sync
      // that never ran.
      //
      // Matching on the whole period `(periodStart, periodEnd)` says what was
      // actually meant — "has this exact window already been reported?" — and
      // is strictly better than the alternative of restricting the check to
      // month-shaped reports: it needs no notion of month-shape, no schema
      // change, and it also lets two DIFFERENT windows that happen to end on
      // the same day coexist, which is the whole point of arbitrary periods.
      //
      // The period is read from the written row through `periodFromSnapshot`,
      // NOT from `latestPeriod.start.toISOString()`. That projection is the
      // local-vs-UTC bug `snapshotPeriodStart` exists to avoid: at UTC+2 a June
      // period projects to '2026-05-31', so the old range silently began a day
      // early and would have matched MAY's report as well. Deriving it from the
      // row is also what guarantees this predicate compares against exactly the
      // two strings `createReportRecord` is about to write.
      const reportPeriod = periodFromSnapshot(latestSnapshot);
      const existing = await ctx.db.query.reports.findFirst({
        where: and(
          eq(reports.projectId, input.projectId),
          eq(reports.periodStart, reportPeriod.start),
          eq(reports.periodEnd, reportPeriod.end)
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

      // THE REPORT CAP APPLIES HERE TOO.
      //
      // This path creates a `reports` row, so it is subject to the same free-plan
      // limit as `reports.generate` — and until now it was not, which made the
      // cap trivially bypassable through the product's most-used button: every
      // Sync now produced a new period, the exact-window dedup above missed, and
      // a new report was written. `reports.canGenerate` reported "out of reports"
      // to the UI while rows kept appearing behind it.
      //
      // NON-THROWING on purpose. The snapshots above were written successfully
      // and must be kept: the sync did its job, and being on the free plan is a
      // normal state, not a failure of it. So this returns the same shape as the
      // already-reported case — the caller sees `reportGenerated: false` and a
      // reason it can show — rather than throwing away a completed sync.
      const allowance = await reportAllowance(project.userId, input.projectId);
      if (!allowance.allowed) {
        return {
          snapshotIds,
          reportId: null,
          reportGenerated: false,
          reportSkippedReason: allowance.reason,
          errors,
        };
      }

      try {
        // Period passed EXPLICITLY. This path must not inherit whatever
        // `createReportRecord` defaults to; it reports on the row it just
        // wrote, over that row's own window, and says so.
        const report = await generateAndSaveReport(
          input.projectId,
          latestSnapshot.id,
          reportPeriod
        );
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
