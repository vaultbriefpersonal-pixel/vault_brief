// One-shot migration: add 5 manual-entry tables backing the report
// sections (grants / governance_proposals / partners / asks /
// qa_highlights). Mirrors add-report-sections.mjs — idempotent via
// CREATE TABLE IF NOT EXISTS; safe to re-run on every environment.
//
// Run once per environment:
//   node --env-file=.env.local scripts/migrations/add-manual-section-tables.mjs
//   DATABASE_URL='<prod>' node scripts/migrations/add-manual-section-tables.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

await sql`CREATE TABLE IF NOT EXISTS grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  amount_usd NUMERIC(18, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'committed',
  category TEXT,
  period TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;
console.log("✓ grants ready");

await sql`CREATE TABLE IF NOT EXISTS governance_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  url TEXT,
  vote_result TEXT,
  period TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;
console.log("✓ governance_proposals ready");

await sql`CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  url TEXT,
  period TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;
console.log("✓ partners ready");

await sql`CREATE TABLE IF NOT EXISTS asks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;
console.log("✓ asks ready");

await sql`CREATE TABLE IF NOT EXISTS qa_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  asked_by TEXT,
  period TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;
console.log("✓ qa_highlights ready");

console.log("\nAll 5 manual-section tables created.");
