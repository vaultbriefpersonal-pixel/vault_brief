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
import { sendReportReadyForReviewEmail } from "@/server/services/email-sender";
import { notify } from "@/server/services/notifications";

/**
 * Auto-generate the monthly draft report ~2 days after the snapshot cron runs.
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
    const activeProjects = await db.query.projects.findMany({
      where: eq(projects.isActive, true),
    });

    const now = Date.now();
    const FRESH_SNAPSHOT_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.vaultbrief.io";

    let generated = 0;
    let skippedNoSnapshot = 0;
    let skippedAlreadyHasReport = 0;
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

        // Generate. Returns the saved record with id + status="draft".
        const report = await generateAndSaveReport(project.id, snapshot.id);

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

        // In-app notification mirrors the email so founders see the draft
        // even if they ignore email.
        await notify(project.userId, {
          type: "report_generated",
          title: `${project.name} draft report is ready`,
          body: "Auto-generated from this month's snapshot. Review and edit before sending to investors.",
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
      failed,
    };
    console.log("auto-generate-reports complete:", summary);
    return summary;
  },
});
