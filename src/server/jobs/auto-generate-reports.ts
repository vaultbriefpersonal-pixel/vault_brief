import { schedules } from "@trigger.dev/sdk/v3";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import {
  projects,
  reports,
  treasurySnapshots,
  users,
} from "@/server/db/schema";
import { generateAndSaveReport } from "@/server/services/report-generator";
import { periodFromSnapshot } from "@/server/services/report-period";
import { sendReportReadyForReviewEmail } from "@/server/services/email-sender";
import { notify } from "@/server/services/notifications";
import {
  filterEligibleProjects,
  reportAllowance,
} from "@/server/lib/plan-limits";
import { renderAndStorePDF } from "@/server/services/pdf-storage";

/**
 * Auto-generate the monthly report ~2 days after the snapshot cron runs.
 * Status defaults to "draft" in the DB schema (it's a stage label, not a
 * customer-facing product type) — UI presents this as a report pending
 * review.
 *
 * Flow per project:
 *   1. Find the latest snapshot.
 *   2. Skip if it's older than 5 days (this month's sync didn't run for this project).
 *   3. Skip if a report already exists for that snapshot (idempotent re-runs).
 *   4. Generate the report (status defaults to "draft").
 *   5. Email the founder a "ready for review" link — nothing goes to investors automatically.
 */
export const autoGenerateReportsJob = schedules.task({
  id: "auto-generate-reports",
  cron: "0 8 3 * *", // 3rd of every month at 08:00 UTC
  run: async () => {
    const allActive = await db.query.projects.findMany({
      where: eq(projects.isActive, true),
    });
    // Skip projects that are over the user's plan limit (post-downgrade).
    const activeProjects = await filterEligibleProjects(allActive);

    const now = Date.now();
    const FRESH_SNAPSHOT_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.vaultbrief.io";

    let generated = 0;
    let skippedNoSnapshot = 0;
    let skippedAlreadyHasReport = 0;
    // Counted separately from the other skips, and reported: this one is a
    // BUSINESS outcome, not a data one. A rising number here is free projects
    // hitting the cap, which is the signal that the cap is working.
    let skippedOverReportLimit = 0;
    let failed = 0;

    for (const project of activeProjects) {
      try {
        // Latest snapshot for this project
        const snapshot = await db.query.treasurySnapshots.findFirst({
          where: eq(treasurySnapshots.projectId, project.id),
          orderBy: [desc(treasurySnapshots.snapshotDate)],
        });

        if (!snapshot) {
          skippedNoSnapshot++;
          continue;
        }

        // snapshotDate is the period end (last day of the reporting month) and
        // can sit days behind reality. createdAt is when the cron actually
        // wrote the row, which is what we want to gate on.
        const snapshotAge = snapshot.createdAt
          ? now - new Date(snapshot.createdAt).getTime()
          : Infinity;
        if (snapshotAge > FRESH_SNAPSHOT_MAX_AGE_MS) {
          // Stale — this month's sync didn't run for this project; don't auto-generate.
          skippedNoSnapshot++;
          continue;
        }

        // Idempotency: don't re-generate if a report for this snapshot already exists.
        const existingReport = await db.query.reports.findFirst({
          where: and(
            eq(reports.projectId, project.id),
            eq(reports.snapshotId, snapshot.id)
          ),
        });
        if (existingReport) {
          skippedAlreadyHasReport++;
          continue;
        }

        // THE FREE-PLAN REPORT CAP APPLIES TO THE CRON TOO.
        //
        // Without this the cap means nothing: a free project that has spent its
        // one report is handed a fresh one automatically every month, which is
        // the whole limit undone on a timer — and undone invisibly, since no
        // human action is involved and `reports.canGenerate` goes on telling the
        // UI the project is out of reports.
        //
        // Skipped, never thrown: the snapshot exists and is fine, this project
        // simply does not get an automatic report. `filterEligibleProjects`
        // above no longer filters anything (it returns every owned project since
        // the public-goods pivot), so this is the only thing standing between a
        // free project and unlimited automatic reports.
        const allowance = await reportAllowance(project.userId, project.id);
        if (!allowance.allowed) {
          skippedOverReportLimit++;
          continue;
        }

        // Generate. Returns the saved record with id + status="draft".
        //
        // The period is passed EXPLICITLY, and that is the point rather than a
        // formality: this cron is the path whose output must not change, and
        // inheriting a default it does not name is how that breaks silently one
        // refactor from now. `periodFromSnapshot` is the same derivation
        // `createReportRecord` would fall back to and the same one every other
        // consumer reads — for the monthly snapshots this job actually sees it
        // is the calendar month ending on `snapshot_date`, byte for byte.
        //
        // It is NOT `periodOfMonth(<current month>)`. This job reports on the
        // snapshot it found, so the honest window is that snapshot's own; a
        // clock-derived month would relabel the row the day this cron ever runs
        // against a snapshot of a different shape.
        const report = await generateAndSaveReport(
          project.id,
          snapshot.id,
          periodFromSnapshot(snapshot)
        );

        // Pre-render PDF so the founder gets an instant download from the
        // email. Failure shouldn't block notification — /api/reports/[id]/pdf
        // can fall back to on-demand generation.
        try {
          await renderAndStorePDF(report.id);
        } catch (pdfErr) {
          console.error(
            `auto-generate-reports: PDF render failed for report ${report.id}:`,
            pdfErr instanceof Error ? pdfErr.message : pdfErr
          );
        }

        // Look up founder email. Skip silently if user record vanished (cascade
        // would normally delete the project, so this is a paranoid guard).
        const founder = await db.query.users.findFirst({
          where: eq(users.id, project.userId),
        });
        if (!founder?.email) {
          generated++;
          continue;
        }

        const reviewUrl = `${APP_URL}/projects/${project.id}/reports/${report.id}`;
        const reviewPath = `/projects/${project.id}/reports/${report.id}`;

        await sendReportReadyForReviewEmail({
          to: { name: founder.name ?? "there", email: founder.email },
          projectName: project.name,
          report,
          reviewUrl,
        });

        // In-app notification mirrors the email so founders see the new
        // report even if they ignore email. Per copy rules: never call
        // the product output a "draft" — it's a generated report
        // pending review.
        await notify(project.userId, {
          type: "report_generated",
          title: `${project.name} report is ready to review`,
          body: "Generated from this month's snapshot. Review and edit before sending to investors.",
          href: reviewPath,
        });

        generated++;
      } catch (err) {
        failed++;
        console.error(
          `auto-generate-reports: project ${project.id} (${project.name}) failed:`,
          err instanceof Error ? err.message : err
        );
        await notify(project.userId, {
          type: "sync_failed",
          title: `Report generation failed for ${project.name}`,
          body: err instanceof Error ? err.message.slice(0, 200) : "Unknown error",
          href: `/projects/${project.id}`,
        });
      }
    }

    const summary = {
      total: activeProjects.length,
      generated,
      skippedNoSnapshot,
      skippedAlreadyHasReport,
      skippedOverReportLimit,
      failed,
    };
    console.log("auto-generate-reports complete:", summary);
    return summary;
  },
});
