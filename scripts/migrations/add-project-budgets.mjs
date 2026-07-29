// One-shot migration: create the project_budgets table — the planned side
// of the ledger (what a founder intended to spend or take in for a
// 'YYYY-MM' period), so a report can put plan next to actual. Purely
// additive: nothing existing reads or writes this table yet, and the
// query/UI layer lands in a follow-up branch AFTER this has been applied.
//
// Column types mirror src/server/db/schema.ts exactly (projectBudgets) —
// a drift between the two is the hazard docs/MIGRATIONS.md warns about.
//
// The unique index is load-bearing, not just a guard: it is what lets the
// write path use onConflictDoUpdate, so re-submitting a budget edits the
// row rather than duplicating it.
//
// Idempotent — safe to re-run.
//
//   node --env-file=.env.local scripts/migrations/add-project-budgets.mjs
//   DATABASE_URL='<prod>' node scripts/migrations/add-project-budgets.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS project_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'expense',
    category TEXT NOT NULL,
    planned_usd NUMERIC(18, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_project_budgets_project_period_kind_category
    ON project_budgets (project_id, period, kind, category)
`;

console.log("✓ project_budgets table ready");
