// One-shot migration: create the project_members table (TODO-026,
// phase 1). Purely additive — projects.userId (the existing owner
// column) is untouched, so existing solo-owner projects are unaffected.
//
// Idempotent — safe to re-run.
//
//   node --env-file=.env.local scripts/migrations/add-project-members.mjs
//   DATABASE_URL='<prod>' node scripts/migrations/add-project-members.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor',
    created_at TIMESTAMPTZ DEFAULT now()
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_project_members_project_user
    ON project_members (project_id, user_id)
`;

console.log("✓ project_members table ready");
