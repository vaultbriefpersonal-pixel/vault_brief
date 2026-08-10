import { db } from "@/server/db";
import { notifications } from "@/server/db/schema";

export type NotificationType =
  | "snapshot_ready"
  | "report_generated"
  | "report_sent"
  | "sync_failed"
  | "anomaly_detected"
  | "grant_report_due"
  // A sync finished but could not read everything — see sync-alerts.ts. The
  // column is free `text` with no CHECK, so this is a TypeScript-only change.
  | "sync_degraded";

interface NotifyArgs {
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
}

/**
 * Fire-and-forget insert into the in-app notifications inbox.
 *
 * Always returns void — caller flows (cron jobs, mutations) must not break
 * if the insert fails. Errors are logged but swallowed.
 */
export async function notify(
  userId: string,
  args: NotifyArgs
): Promise<void> {
  try {
    await db.insert(notifications).values({
      userId,
      type: args.type,
      title: args.title,
      body: args.body ?? null,
      href: args.href ?? null,
    });
  } catch (err) {
    console.error("notify() failed:", err instanceof Error ? err.message : err);
  }
}
