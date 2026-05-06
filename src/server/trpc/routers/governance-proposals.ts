import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { governanceProposals } from "@/server/db/schema";
import { requireProject, requireGovernanceProposal } from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";
import {
  fetchSnapshotProposals,
  mapProposalToRow,
} from "@/server/services/snapshot-import";
import { TRPCError } from "@trpc/server";

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

  /**
   * Pull proposals from Snapshot.org for a given space + period and
   * insert any that aren't already in the table. Dedup is by `url`,
   * which Snapshot makes unique per proposal. Returns counts so the
   * UI can say "imported 3, skipped 2 (already imported)".
   *
   * No rate limit — Snapshot's public endpoint handles abuse upstream
   * and import is bounded by the per-call 100-proposal cap. We do
   * gate via assertTrialActive so expired-trial users can't burn
   * server-side fetches.
   */
  importFromSnapshot: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        space: z.string().min(1).max(120),
        period: z.string().regex(PERIOD_RE),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);

      let proposals;
      try {
        proposals = await fetchSnapshotProposals(input.space, input.period);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            err instanceof Error ? err.message : "Snapshot fetch failed",
        });
      }

      if (proposals.length === 0) {
        return { imported: 0, skipped: 0, fetched: 0 };
      }

      // Dedup against existing rows for THIS project by URL. Same
      // proposal pulled twice (e.g. user re-imports same period to
      // pick up newly-closed votes) shouldn't produce duplicate rows.
      const existing = await ctx.db.query.governanceProposals.findMany({
        where: eq(governanceProposals.projectId, input.projectId),
      });
      const existingUrls = new Set(
        existing.map((e) => e.url).filter((u): u is string => Boolean(u))
      );

      const fresh = proposals.filter(
        (p) => p.link && !existingUrls.has(p.link)
      );

      if (fresh.length === 0) {
        return {
          imported: 0,
          skipped: proposals.length,
          fetched: proposals.length,
        };
      }

      const rows = fresh.map((p) => {
        const mapped = mapProposalToRow(p);
        return {
          projectId: input.projectId,
          title: mapped.title,
          status: mapped.status,
          url: mapped.url,
          voteResult: mapped.voteResult,
          period: input.period,
          notes: null,
        };
      });

      await ctx.db.insert(governanceProposals).values(rows);
      return {
        imported: rows.length,
        skipped: proposals.length - rows.length,
        fetched: proposals.length,
      };
    }),
});
