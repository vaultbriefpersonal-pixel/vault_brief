import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { reports } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import { requireProject, requireReport } from "../guards";
import {
  generateReport,
  generateAndSaveReport,
} from "@/server/services/report-generator";
import { renderAndStorePDF } from "@/server/services/pdf-storage";
import { assertTrialActive } from "@/server/lib/plan-limits";

export const reportsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.reports.findMany({
        where: eq(reports.projectId, input.projectId),
        orderBy: [desc(reports.periodEnd)],
      });
    }),

  getById: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // requireReport already enforces project ownership; we only need the
      // joined project for the UI.
      await requireReport(ctx, input.reportId);
      return ctx.db.query.reports.findFirst({
        where: eq(reports.id, input.reportId),
        with: { project: true },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        reportId: z.string().uuid(),
        contentMd: z.string().optional(),
        founderNotes: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { reportId, ...data } = input;
      await requireReport(ctx, reportId);
      // Markdown changed → pdf is stale. Null it out; next download will
      // trigger an on-demand re-render via the /pdf route.
      const [updated] = await ctx.db
        .update(reports)
        .set({ ...data, pdfUrl: null, updatedAt: new Date() })
        .where(eq(reports.id, reportId))
        .returning();
      return updated;
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        reportId: z.string().uuid(),
        status: z.enum(["draft", "review", "sent"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireReport(ctx, input.reportId);
      const [updated] = await ctx.db
        .update(reports)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(reports.id, input.reportId))
        .returning();
      return updated;
    }),

  regenerate: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      const report = await requireReport(ctx, input.reportId);
      if (!report.snapshotId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No snapshot linked to this report",
        });
      }
      const contentMd = await generateReport(report.projectId, report.snapshotId);

      const [updated] = await ctx.db
        .update(reports)
        .set({
          contentMd,
          status: "draft",
          pdfUrl: null, // invalidate stale blob; rerender triggered next.
          updatedAt: new Date(),
        })
        .where(eq(reports.id, input.reportId))
        .returning();

      // Re-render in background — best-effort; UI fallback handles miss.
      try {
        await renderAndStorePDF(input.reportId);
      } catch (err) {
        console.error("regenerate: PDF render failed:", err);
      }
      return updated;
    }),

  downloadPdf: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireReport(ctx, input.reportId);
      return { url: `/api/reports/${input.reportId}/pdf` };
    }),

  generate: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        snapshotId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const report = await generateAndSaveReport(
        input.projectId,
        input.snapshotId
      );
      try {
        await renderAndStorePDF(report.id);
      } catch (err) {
        console.error("generate: PDF render failed:", err);
      }
      return report;
    }),
});
