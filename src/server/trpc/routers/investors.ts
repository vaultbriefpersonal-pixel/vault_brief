import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { investors, reports } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import { requireProject, requireInvestor } from "../guards";
import { sendReportEmail } from "@/server/services/email-sender";
import { notify } from "@/server/services/notifications";
import {
  checkLimit,
  bulkImportLimiter,
  sendReportLimiter,
} from "@/server/lib/ratelimit";

export const investorsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.investors.findMany({
        where: eq(investors.projectId, input.projectId),
        orderBy: (inv, { asc }) => [asc(inv.createdAt)],
      });
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(200),
        email: z.string().email(),
        firm: z.string().max(200).optional(),
        role: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      const [investor] = await ctx.db
        .insert(investors)
        .values(input)
        .returning();
      return investor;
    }),

  update: protectedProcedure
    .input(
      z.object({
        investorId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        email: z.string().email().optional(),
        firm: z.string().max(200).optional().nullable(),
        role: z.string().max(100).optional().nullable(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { investorId, ...data } = input;
      await requireInvestor(ctx, investorId);
      const [updated] = await ctx.db
        .update(investors)
        .set(data)
        .where(eq(investors.id, investorId))
        .returning();
      return updated;
    }),

  remove: protectedProcedure
    .input(z.object({ investorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireInvestor(ctx, input.investorId);
      await ctx.db
        .delete(investors)
        .where(eq(investors.id, input.investorId));
      return { success: true };
    }),

  bulkImport: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        // CSV rows as parsed array
        rows: z.array(
          z.object({
            name: z.string().min(1),
            email: z.string().email(),
            firm: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      await checkLimit(bulkImportLimiter, ctx.session.user.id!);
      const inserted = await ctx.db
        .insert(investors)
        .values(
          input.rows.map((row) => ({ ...row, projectId: input.projectId }))
        )
        .onConflictDoNothing()
        .returning();
      return { count: inserted.length };
    }),

  sendReport: protectedProcedure
    .input(
      z.object({
        reportId: z.string().uuid(),
        projectId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await requireProject(ctx, input.projectId);
      await checkLimit(sendReportLimiter, ctx.session.user.id!);

      const report = await ctx.db.query.reports.findFirst({
        where: and(
          eq(reports.id, input.reportId),
          eq(reports.projectId, input.projectId)
        ),
      });
      if (!report) throw new TRPCError({ code: "NOT_FOUND" });
      if (!report.contentMd) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Report has no content to send",
        });
      }

      const activeInvestors = await ctx.db.query.investors.findMany({
        where: and(
          eq(investors.projectId, input.projectId),
          eq(investors.isActive, true)
        ),
      });

      if (activeInvestors.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active investors to send to",
        });
      }

      const results = await Promise.allSettled(
        activeInvestors.map((inv) =>
          sendReportEmail({
            to: { name: inv.name, email: inv.email },
            projectName: project.name,
            report,
            reportUrl: `${process.env.NEXT_PUBLIC_APP_URL}/projects/${input.projectId}/reports/${input.reportId}`,
          })
        )
      );

      const sent = results.filter((r) => r.status === "fulfilled").length;

      await ctx.db
        .update(reports)
        .set({
          status: "sent",
          sentAt: new Date(),
          sentToCount: sent,
          updatedAt: new Date(),
        })
        .where(eq(reports.id, input.reportId));

      // In-app inbox notification — mirrors what the founder just did.
      await notify(ctx.session.user.id!, {
        type: "report_sent",
        title: `${project.name} report sent`,
        body: `Delivered to ${sent} of ${activeInvestors.length} investors.`,
        href: `/projects/${input.projectId}/reports/${input.reportId}`,
      });

      return { sent, total: activeInvestors.length };
    }),
});
