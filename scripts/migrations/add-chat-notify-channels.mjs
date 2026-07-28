// One-shot migration: add Discord/Telegram delivery-channel columns to
// projects. Additive, per-project "new report available" ping alongside
// investor email — never a replacement for it. Null on either pair means
// that channel is unconfigured (no-op).
//
// Idempotent — safe to re-run.
//
//   node --env-file=.env.local scripts/migrations/add-chat-notify-channels.mjs
//   DATABASE_URL='<prod>' node scripts/migrations/add-chat-notify-channels.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT`;
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT`;
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT`;
console.log("✓ projects chat-notify columns ready");
