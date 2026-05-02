import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { reports } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import { requireProject, requireReport } from "../guards";

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
      const [updated] = await ctx.db
        .update(reports)
        .set({ ...data, updatedAt: new Date() })
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
      const report = await requireReport(ctx, input.reportId);
      if (!report.snapshotId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No snapshot linked to this report",
        });
      }
      const { generateReport } = await import("@/server/services/report-generator");
      const contentMd = await generateReport(report.projectId, report.snapshotId);

      const [updated] = await ctx.db
        .update(reports)
        .set({ contentMd, status: "draft", updatedAt: new Date() })
        .where(eq(reports.id, input.reportId))
        .returning();
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
      await requireProject(ctx, input.projectId);
      const { generateAndSaveReport } = await import("@/server/services/report-generator");
      return generateAndSaveReport(input.projectId, input.snapshotId);
    }),
});
