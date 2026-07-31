import { z } from "zod";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { after } from "next/server";
import { router, protectedProcedure } from "../trpc";
import {
  reports,
  reportEngagements,
  treasurySnapshots,
} from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import { requireProject, requireReport } from "../guards";
import {
  generateReport,
  generateAndSaveReport,
} from "@/server/services/report-generator";
import { renderAndStorePDF } from "@/server/services/pdf-storage";
import {
  assertTrialActive,
  assertCanGenerateReport,
  FREE_REPORT_LIMIT,
} from "@/server/lib/plan-limits";
import {
  assertPeriodSupported,
  periodFromRange,
  periodFromSnapshot,
} from "@/server/services/report-period";

/** A `date` column as it travels over the wire. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a 'YYYY-MM-DD' date");

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
        // Every individual open / click timestamp, ascending. The counts
        // above are `.length` of these, kept as separate fields so the UI
        // can show "opened 3×" without walking the array. `lastOpenedAt` /
        // `lastClickedAt` are the tail of each list — convenient for the
        // table's summary column.
        openedAt: Date[];
        clickedAt: Date[];
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
            openedAt: [],
            clickedAt: [],
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
            if (at) r.openedAt.push(at);
            r.lastOpenedAt = at; // events are asc-ordered → last wins
            break;
          case "clicked":
            totals.clicked++;
            r.clicked++;
            if (at) r.clickedAt.push(at);
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

      // Re-render in background, best-effort — UI fallback handles a miss.
      //
      // This used to be `await`ed inline, which meant the PDF render +
      // Vercel Blob upload had to finish inside the same request/response
      // cycle as the (already slow, several-to-15+s) LLM call above. On
      // Vercel, the tRPC catch-all route has no explicit `maxDuration`, so
      // it ran under the platform default rather than the 60s used
      // elsewhere in this app — combined with the LLM call, that was
      // enough to get the invocation killed mid-render, silently, before
      // the blob (and pdfUrl) were ever rewritten; the outer try/catch
      // never got a chance to run because the process was torn down, not
      // thrown into. `after()` schedules this to run once the response
      // has already been sent to the client, which both matches
      // renderAndStorePDF's documented "best-effort" contract and gets it
      // out of the request's own timeout budget. The on-demand
      // /api/reports/[reportId]/pdf route (own maxDuration: 60) remains
      // the fallback if this background render doesn't finish either.
      after(async () => {
        try {
          await renderAndStorePDF(input.reportId);
        } catch (err) {
          console.error("regenerate: PDF render failed:", err);
        }
      });

      return updated;
    }),

  downloadPdf: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireReport(ctx, input.reportId);
      return { url: `/api/reports/${input.reportId}/pdf` };
    }),

  /**
   * Read-only mirror of the free-plan report cap, so the picker can say
   * "you have used your one free report" BEFORE the founder configures a
   * whole period and then eats a FORBIDDEN at the end of it.
   *
   * THE POLICY DOES NOT LIVE HERE. `assertCanGenerateReport` in
   * plan-limits.ts is the enforcement point and stays the only one — this
   * query literally CALLS it and reports whether it threw, rather than
   * re-deriving the rule. That is deliberate: a second copy of "is the owner
   * on a paid plan, and how many reports has this project used" is one edit
   * away from a free-tier hole, and a hole in a read-only mirror is invisible
   * because the mirror is the thing everyone looks at. Nobody should later
   * "fix" the duplication by moving the policy up here — there is no
   * duplication to fix.
   *
   * The counts below are for DISPLAY ONLY and are never consulted for the
   * verdict; `allowed` comes from the enforcement point or from nowhere.
   */
  canGenerate: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const project = await requireProject(ctx, input.projectId);

      const [row] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(reports)
        .where(eq(reports.projectId, input.projectId));
      const used = Number(row?.count ?? 0);

      try {
        await assertCanGenerateReport(project.userId, input.projectId);
        return { allowed: true, reason: null, used, limit: FREE_REPORT_LIMIT };
      } catch (err) {
        // Only the plan refusal is an answer; anything else is a real fault
        // and must not be reported to the UI as "you are out of reports".
        if (err instanceof TRPCError && err.code === "FORBIDDEN") {
          return {
            allowed: false,
            reason: err.message,
            used,
            limit: FREE_REPORT_LIMIT,
          };
        }
        throw err;
      }
    }),

  /**
   * Generate a report from a snapshot, over the period THAT SNAPSHOT COVERS.
   *
   * `period` is optional and defaults to `periodFromSnapshot(snapshot)`, so
   * every existing caller is unchanged. When supplied it is an ASSERTION, not
   * an override: the server checks it against the snapshot's own window and
   * refuses a mismatch. A report's period is a property of the data it was
   * built from — the flows are measured over the snapshot's window and the
   * balances are as of its end — so a report that claims a different window is
   * simply a false document, and accepting one from an API caller would be the
   * exact error this whole plan exists to avoid.
   *
   * `assertPeriodSupported` runs HERE, server-side, and not only in the
   * picker: the UI's disabled options are a courtesy, the gate is this.
   * Its refusal `reason` is passed through verbatim — that text was written
   * to be read by the founder, and paraphrasing it loses the explanation of
   * why the product cannot reach that far back.
   */
  generate: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        snapshotId: z.string().uuid(),
        period: z.object({ start: isoDate, end: isoDate }).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await requireProject(ctx, input.projectId);
      await assertCanGenerateReport(project.userId, input.projectId);

      // Scoped to the project, not fetched by id alone. `generateReport` and
      // `createReportRecord` both look the snapshot up by primary key with no
      // ownership filter, so without this a caller could name their own
      // project and someone else's snapshot and have the other treasury's
      // figures written into a report they own.
      const snapshot = await ctx.db.query.treasurySnapshots.findFirst({
        where: and(
          eq(treasurySnapshots.id, input.snapshotId),
          eq(treasurySnapshots.projectId, input.projectId)
        ),
      });
      if (!snapshot) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No snapshot for this project with that id",
        });
      }

      const snapshotPeriod = periodFromSnapshot(snapshot);
      let period = snapshotPeriod;
      if (input.period) {
        try {
          period = periodFromRange(input.period.start, input.period.end);
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err instanceof Error ? err.message : "Invalid period",
          });
        }
        if (
          period.start !== snapshotPeriod.start ||
          period.end !== snapshotPeriod.end
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              `That snapshot covers ${snapshotPeriod.label} ` +
              `(${snapshotPeriod.start} to ${snapshotPeriod.end}), not ${period.label} ` +
              `(${period.start} to ${period.end}). A report's period is the period of the ` +
              "snapshot it is generated from — its balances are as of that snapshot's end and " +
              "its flows are measured over that window — so it cannot be relabelled. " +
              "Sync the period you want, then generate from the snapshot it produces.",
          });
        }
      }

      const support = assertPeriodSupported(period, new Date());
      if (!support.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: support.reason });
      }

      const report = await generateAndSaveReport(
        input.projectId,
        input.snapshotId,
        period
      );

      // Same fix as regenerate above, same reason: this used to await
      // renderAndStorePDF inline, right after the LLM call generateAndSaveReport
      // makes internally — long enough combined to risk the tRPC route's
      // timeout budget and get silently killed mid-render. See regenerate's
      // comment above for the full explanation.
      after(async () => {
        try {
          await renderAndStorePDF(report.id);
        } catch (err) {
          console.error("generate: PDF render failed:", err);
        }
      });

      return report;
    }),
});
