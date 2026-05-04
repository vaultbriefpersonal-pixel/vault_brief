import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";

/**
 * Public API waitlist signup. Writes to a small `api_waitlist` table via
 * raw SQL — keeps the schema migration scope-zero (no Drizzle model, no
 * generated migration to apply through the existing pipeline). The
 * table is created on first hit; subsequent hits just INSERT ... ON
 * CONFLICT DO NOTHING so the same email signing up twice is a no-op.
 *
 * Cost-of-misuse: a stranger spamming the endpoint would fill a tiny
 * append-only log. The bounded payload (email column TEXT) and the
 * built-in IP rate-limit on Vercel's edge make this acceptable for now.
 * If volume gets weird, drop in `chatLimiter`-style throttling later.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = (body as { email?: string })?.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return Response.json({ error: "Valid email required" }, { status: 400 });
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS api_waitlist (
        email TEXT PRIMARY KEY,
        signed_up_at TIMESTAMPTZ DEFAULT NOW(),
        source TEXT DEFAULT 'docs_page'
      )
    `);
    await db.execute(sql`
      INSERT INTO api_waitlist (email)
      VALUES (${email})
      ON CONFLICT (email) DO NOTHING
    `);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("api-access waitlist insert failed", err);
    return Response.json({ error: "Could not save signup" }, { status: 500 });
  }
}
