import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { investors, reports } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import { requireProject, requireInvestor } from "../guards";
import { sendReportEmail } from "@/server/services/email-sender";
import { notify } from "@/server/services/notifications";
import { assertTrialActive } from "@/server/lib/plan-limits";
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
      await assertTrialActive(ctx.session.user.id!);
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
      await assertTrialActive(ctx.session.user.id!);
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
      // Approval gate: must be marked Ready (status='review') before sending.
      // Prevents accidental sends of unreviewed drafts. Already-sent reports
      // can be re-sent (e.g. to add an investor) without re-marking.
      if (report.status !== "review" && report.status !== "sent") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Report must be marked Ready before sending. Click 'Mark Ready' in the editor first.",
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
            // Public investor view at /r/<reportId>. The dashboard route
            // /projects/:id/reports/:reportId requires auth and would
            // bounce the (account-less) investor to /login, leaving them
            // stuck. /r/ is the read-only mirror gated on status='sent'.
            reportUrl: `${process.env.NEXT_PUBLIC_APP_URL}/r/${input.reportId}`,
          })
        )
      );

      const sent = results.filter((r) => r.status === "fulfilled").length;
      const total = activeInvestors.length;

      // Collect failure reasons so we can both log them server-side and
      // surface a useful message to the founder. Never store full Resend
      // error objects in the DB — message + investor email is enough audit.
      const failures = results
        .map((r, i) => {
          if (r.status !== "rejected") return null;
          const reason =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
          return {
            email: activeInvestors[i].email,
            name: activeInvestors[i].name,
            reason,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (failures.length > 0) {
        console.error(
          `[investors.sendReport] ${failures.length}/${total} deliveries failed:`,
          failures
        );
      }

      // ALL deliveries failed → don't lie to the founder by flipping the
      // status to "sent". Leave it in 'review', surface the underlying
      // failure messages, and let them retry. Without this guard a bad
      // FROM-domain config or expired Resend key silently looks "sent" in
      // the UI — and investors don't get the email.
      if (sent === 0) {
        const sample = failures
          .slice(0, 2)
          .map((f) => `${f.email}: ${f.reason}`)
          .join("; ");
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `All ${total} email deliveries failed. Report kept in review. ${sample}`,
        });
      }

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
        body:
          sent === total
            ? `Delivered to all ${total} investors.`
            : `Delivered to ${sent} of ${total} investors. ${failures.length} failed — see logs.`,
        href: `/projects/${input.projectId}/reports/${input.reportId}`,
      });

      // Caller (UI) should treat partial<total as a degraded success and
      // show a yellow "N of M sent — see details" toast rather than a green
      // "all sent". Returning the failures array lets the editor render that.
      return {
        sent,
        total,
        failures: failures.length > 0 ? failures : undefined,
      };
    }),
});
