import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { reports, projects, treasurySnapshots } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";

async function assertProjectOwner(
  ctx: {
    db: typeof import("@/server/db").db;
    session: { user: { id?: string | null } };
  },
  projectId: string
) {
  const project = await ctx.db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectId),
      eq(projects.userId, ctx.session.user.id!)
    ),
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
}

export const reportsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectOwner(ctx, input.projectId);
      return ctx.db.query.reports.findMany({
        where: eq(reports.projectId, input.projectId),
        orderBy: [desc(reports.periodEnd)],
      });
    }),

  getById: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const report = await ctx.db.query.reports.findFirst({
        where: eq(reports.id, input.reportId),
        with: { project: true },
      });
      if (!report) throw new TRPCError({ code: "NOT_FOUND" });
      await assertProjectOwner(ctx, report.projectId);
      return report;
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
      const report = await ctx.db.query.reports.findFirst({
        where: eq(reports.id, reportId),
      });
      if (!report) throw new TRPCError({ code: "NOT_FOUND" });
      await assertProjectOwner(ctx, report.projectId);

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
      const report = await ctx.db.query.reports.findFirst({
        where: eq(reports.id, input.reportId),
      });
      if (!report) throw new TRPCError({ code: "NOT_FOUND" });
      await assertProjectOwner(ctx, report.projectId);

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
      const report = await ctx.db.query.reports.findFirst({
        where: eq(reports.id, input.reportId),
      });
      if (!report) throw new TRPCError({ code: "NOT_FOUND" });
      if (!report.snapshotId) throw new TRPCError({ code: "BAD_REQUEST", message: "No snapshot linked to this report" });
      await assertProjectOwner(ctx, report.projectId);

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
      const report = await ctx.db.query.reports.findFirst({
        where: eq(reports.id, input.reportId),
      });
      if (!report) throw new TRPCError({ code: "NOT_FOUND" });
      await assertProjectOwner(ctx, report.projectId);

      // Return a URL to the PDF download endpoint
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
      await assertProjectOwner(ctx, input.projectId);
      const { generateAndSaveReport } = await import("@/server/services/report-generator");
      return generateAndSaveReport(input.projectId, input.snapshotId);
    }),
});
