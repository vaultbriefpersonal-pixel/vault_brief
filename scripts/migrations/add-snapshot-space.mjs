// One-shot migration: add `snapshot_space` text column to projects.
// Holds the project's Snapshot.org space slug (e.g. "ens.eth", "uniswap")
// so the governance section can auto-import proposals from Snapshot's
// public GraphQL API without forcing manual entry.
//
// Idempotent — safe to re-run.
//
//   node --env-file=.env.local scripts/migrations/add-snapshot-space.mjs
//   DATABASE_URL='<prod>' node scripts/migrations/add-snapshot-space.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS snapshot_space TEXT`;
console.log("✓ projects.snapshot_space column ready");
