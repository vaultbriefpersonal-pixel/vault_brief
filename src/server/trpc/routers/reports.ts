import { z } from "zod";
import { eq, asc, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { reports, reportEngagements } from "@/server/db/schema";
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
      // requireReport already enforces project ownership.
      //
      // We also pull in the linked treasury snapshot so the editor view
      // can render the KPI / breakdown / token / GitHub widget strip
      // above the markdown — same widgets the public investor view
      // shows. Drizzle resolves this as one JOIN, not a second query.
      await requireReport(ctx, input.reportId);
      return ctx.db.query.reports.findFirst({
        where: eq(reports.id, input.reportId),
        with: { project: true, snapshot: true },
      });
    }),

  // Per-recipient engagement for a single report. The aggregate
  // openedCount / clickedCount on the report row answers "how many
  // opens" but not "which investor". The webhook already logs every
  // Resend event into report_engagements keyed by recipientEmail; this
  // rolls those rows up into one summary per investor so the report
  // page can show "Investor X opened 3×, never clicked".
  //
  // Volume per report is small (one row per recipient per event), so we
  // fetch ordered and reduce in JS rather than pushing a GROUP BY into
  // SQL — keeps the shape obvious and avoids a raw `sql` aggregate.
  getEngagements: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireReport(ctx, input.reportId);

      const events = await ctx.db.query.reportEngagements.findMany({
        where: eq(reportEngagements.reportId, input.reportId),
        orderBy: [asc(reportEngagements.occurredAt)],
      });

      type RecipientSummary = {
        email: string;
        opened: number;
        clicked: number;
        bounced: number;
        firstSentAt: Date | null;
        lastOpenedAt: Date | null;
        lastClickedAt: Date | null;
      };

      const byRecipient = new Map<string, RecipientSummary>();
      const totals = { sent: 0, opened: 0, clicked: 0, bounced: 0 };

      for (const e of events) {
        let r = byRecipient.get(e.recipientEmail);
        if (!r) {
          r = {
            email: e.recipientEmail,
            opened: 0,
            clicked: 0,
            bounced: 0,
            firstSentAt: null,
            lastOpenedAt: null,
            lastClickedAt: null,
          };
          byRecipient.set(e.recipientEmail, r);
        }
        // occurredAt defaults to now() in the DB, but the column is
        // nullable in the schema — guard before assigning.
        const at = e.occurredAt ?? null;
        switch (e.eventType) {
          case "sent":
            totals.sent++;
            if (!r.firstSentAt) r.firstSentAt = at;
            break;
          case "opened":
            totals.opened++;
            r.opened++;
            r.lastOpenedAt = at; // events are asc-ordered → last wins
            break;
          case "clicked":
            totals.clicked++;
            r.clicked++;
            r.lastClickedAt = at;
            break;
          case "bounced":
          case "complained":
            totals.bounced++;
            r.bounced++;
            break;
        }
      }

      // Most-engaged first: clicked desc, then opened desc, then email.
      const recipients = [...byRecipient.values()].sort(
        (a, b) =>
          b.clicked - a.clicked ||
          b.opened - a.opened ||
          a.email.localeCompare(b.email)
      );

      return { totals, recipients };
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
