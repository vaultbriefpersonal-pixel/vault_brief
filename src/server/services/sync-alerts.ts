import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications, projects, users } from "@/server/db/schema";
import { brandingFor } from "@/lib/report-branding";
import { sendSyncIssueEmail } from "./email-sender";
import { notify } from "./notifications";
import {
  describeSyncIssue,
  periodTagOf,
  syncIssueGroups,
  syncIssueHref,
  syncIssueKey,
} from "./sync-issues";

/**
 * Pushes an alert when a sync completed WITHOUT reading everything.
 *
 * A sync that cannot reach a chain still writes a snapshot and still reports
 * success — the incompleteness lives only in `sync_warnings`, and until this
 * nothing pushed it anywhere. Base Mainnet sat disabled on the Alchemy app for
 * nine days: every Base figure was missing, every sync looked fine, and it
 * surfaced only because someone checked by hand. Dune Sim's sunset was the
 * same shape. The class of fault is one that arrives as plausible data rather
 * than as an error, so it has to be pushed or it is not noticed.
 *
 * NEVER THROWS. It is called from the sync path, and a mailer being down must
 * not fail a sync that otherwise succeeded — the snapshot is good and keeping
 * it matters more than the notice. Same reasoning as `reportAllowance`'s
 * non-throwing shape for background paths.
 *
 * CALLED FROM TWO PLACES, and both are required: `createMonthlySnapshot`
 * (the monthly cron) and `projects.sync` (the founder pressing Sync now).
 * `sync-alerts.test.ts` asserts both call sites still exist, because this
 * codebase has twice shipped a rule wired into only one of its two paths.
 */
export async function notifyNewSyncIssues(snapshot: {
  projectId: string;
  snapshotDate: Date | string;
  syncWarnings: unknown;
}): Promise<{ alerted: number; alreadyKnown: number }> {
  const result = { alerted: 0, alreadyKnown: 0 };

  try {
    const groups = syncIssueGroups(snapshot.syncWarnings);
    if (groups.length === 0) return result;

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, snapshot.projectId),
    });
    if (!project || !project.isActive) return result;

    const periodTag = periodTagOf(snapshot.snapshotDate);

    // Which of these has the founder not been told about for this month? The
    // `notifications` row IS the record — see `syncIssueHref`. Same trick
    // `anomaly-alerts.ts` uses, and for the same reason: a dedicated table
    // would be a Forbidden-Area migration for bookkeeping.
    const fresh: { href: string; text: string; messages: string[] }[] = [];
    for (const group of groups) {
      const href = syncIssueHref(
        project.id,
        syncIssueKey(group),
        periodTag
      );
      const existing = await db.query.notifications.findFirst({
        where: and(
          eq(notifications.userId, project.userId),
          eq(notifications.type, "sync_degraded"),
          eq(notifications.href, href)
        ),
      });
      if (existing) {
        result.alreadyKnown++;
        continue;
      }
      fresh.push({
        href,
        text: describeSyncIssue(group),
        messages: group.messages,
      });
    }

    if (fresh.length === 0) return result;

    // ONE email covering everything new, but one notification PER issue — the
    // notification is the dedup record, so collapsing them would silence every
    // issue but the first next time around.
    const founder = await db.query.users.findFirst({
      where: eq(users.id, project.userId),
    });

    if (founder?.email) {
      const APP_URL =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://www.vaultbrief.io";
      const branding = brandingFor(project);
      await sendSyncIssueEmail({
        to: { name: founder.name ?? "there", email: founder.email },
        projectName: project.name,
        walletsUrl: `${APP_URL}/projects/${project.id}/wallets`,
        issues: fresh.map((f) => f.text),
        details: [...new Set(fresh.flatMap((f) => f.messages))].slice(0, 5),
        logoUrl: branding.logoUrl,
        brandColor: branding.primaryColor,
      });
    }

    for (const f of fresh) {
      await notify(project.userId, {
        type: "sync_degraded",
        title: `${project.name}: some data could not be read`,
        body: f.text,
        href: f.href,
      });
      result.alerted++;
    }

    return result;
  } catch (err) {
    console.error(
      `notifyNewSyncIssues: project ${snapshot.projectId} failed:`,
      err instanceof Error ? err.message : err
    );
    return result;
  }
}
