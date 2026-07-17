import { schedules } from "@trigger.dev/sdk/v3";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications, projects, treasurySnapshots, users } from "@/server/db/schema";
import { detectAnomalies } from "@/server/services/anomalies";
import { sendAnomalyAlertEmail } from "@/server/services/email-sender";
import { notify } from "@/server/services/notifications";
import { filterEligibleProjects } from "@/server/lib/plan-limits";

/**
 * Weekly, independent of the monthly report cycle. `detectAnomalies()`
 * (anomalies.ts) previously only ran at report-generation time — a burn-rate
 * spike sat invisible to the founder until the next monthly report, up to
 * four weeks later. This job checks the LATEST snapshot every week and
 * alerts immediately on anything `critical`.
 *
 * Founder-only. Nothing here reaches investors — this is an internal
 * early-warning signal, not part of the reviewed/approved narrative.
 *
 * Idempotency without a schema change: the same latest snapshot is
 * re-checked every week until the next monthly sync replaces it, so the
 * same critical anomaly would otherwise re-alert weekly. Dedup by encoding
 * the snapshot id into the notification's `href`
 * (`/projects/:id?anomaly=:snapshotId`) and checking whether one already
 * exists before sending — reuses the existing `notifications` table rather
 * than adding a new one (a new table would be a Forbidden-Area migration).
 */
export const anomalyAlertsJob = schedules.task({
  id: "anomaly-alerts",
  cron: "0 7 * * 1", // every Monday at 07:00 UTC
  run: async () => {
    const allActive = await db.query.projects.findMany({
      where: eq(projects.isActive, true),
    });
    const activeProjects = await filterEligibleProjects(allActive);

    let checked = 0;
    let alerted = 0;
    let alreadyAlerted = 0;
    let noAnomalies = 0;
    let failed = 0;

    for (const project of activeProjects) {
      checked++;
      try {
        const snapshot = await db.query.treasurySnapshots.findFirst({
          where: eq(treasurySnapshots.projectId, project.id),
          orderBy: [desc(treasurySnapshots.snapshotDate)],
        });
        if (!snapshot) continue;

        // Same trailing-3 convention as report-generator.ts's anomaly base.
        const trailing = await db.query.treasurySnapshots.findMany({
          where: and(
            eq(treasurySnapshots.projectId, project.id),
            lt(treasurySnapshots.snapshotDate, snapshot.snapshotDate)
          ),
          orderBy: [desc(treasurySnapshots.snapshotDate)],
          limit: 3,
        });

        const anomalies = detectAnomalies(snapshot, trailing).filter(
          (a) => a.severity === "critical"
        );
        if (anomalies.length === 0) {
          noAnomalies++;
          continue;
        }

        const dedupHref = `/projects/${project.id}?anomaly=${snapshot.id}`;
        const existing = await db.query.notifications.findFirst({
          where: and(
            eq(notifications.userId, project.userId),
            eq(notifications.type, "anomaly_detected"),
            eq(notifications.href, dedupHref)
          ),
        });
        if (existing) {
          alreadyAlerted++;
          continue;
        }

        const founder = await db.query.users.findFirst({
          where: eq(users.id, project.userId),
        });
        if (!founder?.email) continue;

        const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.vaultbrief.io";
        const projectUrl = `${APP_URL}/projects/${project.id}`;
        const branding = (project.customBranding as {
          primaryColor?: string;
          logoUrl?: string;
        } | null) ?? null;

        await sendAnomalyAlertEmail({
          to: { name: founder.name ?? "there", email: founder.email },
          projectName: project.name,
          projectUrl,
          anomalies,
          logoUrl: branding?.logoUrl ?? project.logoUrl ?? null,
          brandColor: branding?.primaryColor,
        });

        const top = anomalies[0];
        await notify(project.userId, {
          type: "anomaly_detected",
          title:
            anomalies.length === 1
              ? `Critical anomaly in ${project.name}`
              : `${anomalies.length} critical anomalies in ${project.name}`,
          body: `${top.metric}: ${top.changePct > 0 ? "+" : ""}${top.changePct.toFixed(0)}% vs trailing average.`,
          href: dedupHref,
        });

        alerted++;
      } catch (err) {
        failed++;
        console.error(
          `anomaly-alerts: project ${project.id} (${project.name}) failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    const summary = { checked, alerted, alreadyAlerted, noAnomalies, failed };
    console.log("anomaly-alerts complete:", summary);
    return summary;
  },
});
