import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { reports, reportEngagements } from "@/server/db/schema";

/**
 * Resend webhooks are signed via Svix. Verify the signature and increment
 * per-report open counts using the `reportId` tag attached when the email
 * was sent (see email-sender.ts). Click events get the same treatment so
 * future link-tracking can ride the same path.
 */

interface ResendEvent {
  type: string;
  data?: {
    to?: string | string[];
    email_id?: string;
    tags?: Record<string, string> | Array<{ name: string; value: string }>;
  };
}

const TRACKED_EVENTS = new Set([
  "email.sent",
  "email.delivered",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
]);

function getRecipientEmail(data: ResendEvent["data"]): string | null {
  if (!data?.to) return null;
  return Array.isArray(data.to) ? data.to[0] ?? null : data.to;
}

function eventTypeShort(type: string): string {
  // "email.opened" → "opened"
  return type.replace(/^email\./, "");
}

function getReportIdFromTags(tags: ResendEvent["data"]): string | null {
  const t = tags?.tags;
  if (!t) return null;
  if (Array.isArray(t)) {
    return t.find((x) => x.name === "reportId")?.value ?? null;
  }
  return typeof t === "object" ? (t.reportId ?? null) : null;
}

function verifySvixSignature(
  secret: string,
  headers: Headers,
  body: string
): boolean {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sig = headers.get("svix-signature");
  if (!id || !ts || !sig) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${ts}.${body}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  // Header format: "v1,<sig> v1,<sig2>" — Svix may send multiple sigs during rotation.
  const candidates = sig
    .split(" ")
    .map((s) => s.split(",")[1])
    .filter((s): s is string => Boolean(s));

  const expectedBuf = Buffer.from(expected);
  return candidates.some((c) => {
    const cBuf = Buffer.from(c);
    return (
      cBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(cBuf, expectedBuf)
    );
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const body = await req.text();
  if (!verifySvixSignature(secret, req.headers, body)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Skip events we don't track (e.g. email.delivery_delayed) without
  // ack-failing — Resend stops retrying on 200.
  if (!TRACKED_EVENTS.has(event.type)) {
    return new Response("OK", { status: 200 });
  }

  const reportId = getReportIdFromTags(event.data);
  if (!reportId) return new Response("OK", { status: 200 });

  const recipientEmail = getRecipientEmail(event.data);

  try {
    // Per-recipient log — feeds the engagement table on the report page.
    if (recipientEmail) {
      await db.insert(reportEngagements).values({
        reportId,
        recipientEmail,
        eventType: eventTypeShort(event.type),
      });
    }

    // Aggregate counter (legacy, used by analytics/list views). Only opened
    // events bump it for now — keeps backward compatibility with existing UI.
    if (event.type === "email.opened") {
      await db
        .update(reports)
        .set({ openedCount: sql`COALESCE(${reports.openedCount}, 0) + 1` })
        .where(eq(reports.id, reportId));
    }
  } catch (err) {
    console.error("resend webhook: update failed", err);
    // 500 lets Resend retry on transient DB errors.
    return new Response("Update failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
