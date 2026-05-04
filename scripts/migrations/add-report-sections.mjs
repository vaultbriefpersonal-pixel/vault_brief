// One-shot migration: add `report_sections` JSONB column to projects.
// Stores the per-project report-template config (ordered array of
// { id, enabled }). Null is a valid state — means "use product defaults".
//
// Run once per environment:
//   node scripts/migrations/add-report-sections.mjs
//
// Idempotent — uses ADD COLUMN IF NOT EXISTS.

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS report_sections JSONB`;
console.log("✓ projects.report_sections column ready");
