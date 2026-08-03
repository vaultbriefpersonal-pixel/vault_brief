import { schedules } from "@trigger.dev/sdk/v3";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/server/db";
import { grantAwards, projects, users } from "@/server/db/schema";
import { sendGrantReportDueEmail } from "@/server/services/email-sender";
import { notify } from "@/server/services/notifications";

/**
 * How many days before `next_report_due` the reminder should fire. A plain
 * code constant, not a DB-backed config — nothing today models a
 * configurable per-award/per-project reminder lead time, and inventing one
 * is real new scope this stage doesn't need. See the header on
 * `grant_awards.next_report_due` in schema.ts: the date itself is purely
 * founder-entered, never system-computed.
 */
export const REMINDER_LEAD_DAYS = 7;

/**
 * `today + leadDays`, formatted as the same 'YYYY-MM-DD' shape
 * `next_report_due` is stored in. Pulled out as a pure function so the
 * "which awards are due" date boundary is checkable without a database —
 * same reasoning as `narrowGrantDataForReport`/`resolveStoredSectionsForReport`
 * in report-generator.ts. Computed in UTC calendar terms (not
 * milliseconds-since-epoch + leadDays*86400000) so a leap day or a
 * daylight-saving transition never shifts the cutoff by a day.
 */
export function reminderCutoffDate(
  today: Date,
  leadDays: number = REMINDER_LEAD_DAYS
): string {
  const cutoff = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + leadDays
    )
  );
  return cutoff.toISOString().slice(0, 10);
}

/**
 * Whether AWARD should be reminded today, given CUTOFF (the output of
 * `reminderCutoffDate`). Mirrors the DB query's own predicate exactly —
 * `status`, `nextReportDue` and `lastRemindedAt` — so the date-comparison
 * logic has one home and one set of unit tests, whether or not the database
 * round-trip is exercised. Deliberately does NOT gate on the award's
 * `project` — the caller checks `project.isActive` separately, since that is
 * a join result, not a fact of the award row itself.
 *
 * This also naturally catches an award whose due date has already passed
 * (an overdue reminder is more useful than none), not only the exact
 * `REMINDER_LEAD_DAYS`-out mark — and it stops re-matching once reminded,
 * since `lastRemindedAt` is no longer null.
 */
export function isAwardDueForReminder(
  award: {
    status: string;
    nextReportDue: string | null;
    lastRemindedAt: Date | null;
  },
  cutoff: string
): boolean {
  return (
    award.status === "active" &&
    award.nextReportDue !== null &&
    award.nextReportDue <= cutoff &&
    award.lastRemindedAt === null
  );
}

/**
 * Daily, unlike the weekly `anomaly-alerts.ts` — a due-date threshold needs
 * daily granularity, since a weekly check could miss or badly-delay the
 * "N days before" window. Modeled on `anomaly-alerts.ts` (closer fit than
 * `auto-generate-reports.ts`: founder-only email, no `Report` row involved,
 * same dedup shape) rather than built from scratch. No registration needed
 * elsewhere — `trigger.config.ts`'s `dirs: ["./src/server/jobs"]`
 * auto-discovers this file.
 */
export const grantReportRemindersJob = schedules.task({
  id: "grant-report-reminders",
  cron: "0 9 * * *", // daily at 09:00 UTC
  run: async () => {
    const cutoff = reminderCutoffDate(new Date());

    // The DB WHERE clause mirrors `isAwardDueForReminder` exactly — kept in
    // sync deliberately, not derived from one another, since Drizzle's query
    // builder and a plain JS predicate can't share an implementation. The
    // pure function above is what's unit-tested; this is what actually runs.
    const dueAwards = await db.query.grantAwards.findMany({
      where: and(
        eq(grantAwards.status, "active"),
        isNotNull(grantAwards.nextReportDue),
        lte(grantAwards.nextReportDue, cutoff),
        isNull(grantAwards.lastRemindedAt)
      ),
      with: { project: true },
    });

    let reminded = 0;
    let skippedNoEmail = 0;
    let skippedInactiveProject = 0;
    let failed = 0;

    const APP_URL =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://www.vaultbrief.io";

    for (const award of dueAwards) {
      try {
        const project = award.project as typeof projects.$inferSelect | null;
        if (!project || !project.isActive) {
          skippedInactiveProject++;
          continue;
        }

        // Look up founder email. Skip silently if the user record vanished
        // (cascade would normally delete the project, so this is a paranoid
        // guard) — copied verbatim from auto-generate-reports.ts /
        // anomaly-alerts.ts.
        const founder = await db.query.users.findFirst({
          where: eq(users.id, project.userId),
        });
        if (!founder?.email) {
          skippedNoEmail++;
          continue;
        }

        // There's no specific report yet to link to (unlike
        // `report_generated`'s link to a report id) — route to the project's
        // reports list.
        const reportsPath = `/projects/${project.id}/reports`;
        const projectUrl = `${APP_URL}${reportsPath}`;

        await sendGrantReportDueEmail({
          to: { name: founder.name ?? "there", email: founder.email },
          projectName: project.name,
          projectUrl,
          grantorName: award.grantor,
          program: award.program,
          dueDate: award.nextReportDue as string,
        });

        await db
          .update(grantAwards)
          .set({ lastRemindedAt: new Date() })
          .where(eq(grantAwards.id, award.id));

        await notify(project.userId, {
          type: "grant_report_due",
          title: `Grant report due soon for ${project.name}`,
          body: `${award.grantor}${award.program ? ` — ${award.program}` : ""}: report due ${award.nextReportDue}.`,
          href: reportsPath,
        });

        reminded++;
      } catch (err) {
        failed++;
        console.error(
          `grant-report-reminders: award ${award.id} (project ${award.projectId}) failed:`,
          err instanceof Error ? err.message : err
        );
        // No notify() on the failure itself — matches anomaly-alerts.ts's
        // choice, not auto-generate-reports.ts's: a failed reminder isn't
        // worth interrupting the founder over.
      }
    }

    const summary = {
      total: dueAwards.length,
      reminded,
      skippedNoEmail,
      skippedInactiveProject,
      failed,
    };
    console.log("grant-report-reminders complete:", summary);
    return summary;
  },
});
