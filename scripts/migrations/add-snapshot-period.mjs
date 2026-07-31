// One-shot migration: give treasury_snapshots a period_start, so a snapshot
// can say WHICH WINDOW its flow figures cover.
//
// The table has exactly one date column, snapshot_date. Every flow column on
// it — total_inflows_usd, burn_rate_usd, expenses_by_category,
// income_by_category, the GitHub counters — is an aggregate over a window the
// row does not record: data-sync.ts derives snapshot_date from `period.end`
// and discards `period.start` outright. That is invisible while every window
// is "the calendar month ending on snapshot_date", and becomes a wrong number
// in a funder's inbox the moment a grant report covers 181 days instead of 30.
//
// Column types mirror src/server/db/schema.ts exactly (treasurySnapshots
// .periodStart) — a drift between the two is the hazard docs/MIGRATIONS.md
// warns about, and someone running `npx drizzle-kit push` later must see a
// no-op rather than a diff.
//
// NULLABLE ON PURPOSE. A NULL period_start reads as "the calendar month ending
// on snapshot_date", and that is not a guess: every write path that has ever
// existed produced exactly a calendar month. getLastMonthPeriod
// (data-sync.ts:11-16) returns the 1st to the last day of the previous month,
// and the backfill loop in trpc/routers/projects.ts walks that same shape
// backwards. The UPDATE below therefore RECONSTRUCTS the true period of every
// existing row rather than inventing a plausible one.
//
// SAFE TO APPLY BEFORE THE DEPENDENT CODE DEPLOYS, and that is the point. The
// code fallback — `periodFromSnapshot` in src/server/services/report-period.ts
// — computes the identical value when the column is absent or NULL, so a
// snapshot read before the backfill and the same snapshot read after it yield
// an identical ReportPeriod. Behaviour does not change when this runs; it
// changes when a snapshot is first written for a window that is NOT a calendar
// month, which nothing in the product can do yet.
//
// IT DOES NOT TOUCH THE UNIQUE INDEX idx_snapshot_project_date. Deliberately:
// data-sync.ts uses (project_id, snapshot_date) as its `ON CONFLICT` target,
// so dropping or widening that index would break the currently-deployed code
// the instant this DDL landed — the upsert would fail with "no unique or
// exclusion constraint matching the ON CONFLICT specification" on every sync.
// Widening the key to include period_start is a separate, later migration
// (Migration C in the deferred backlog), and it has to be a three-step deploy:
// create the 3-column index, deploy code targeting it, only then drop the old
// one. Until that happens, two different reporting periods ending on the same
// day still collide on (project, date) — which is why data-sync.ts refuses
// that write in code rather than relying on the database to catch it.
//
// Both statements are idempotent — safe to re-run. The UPDATE is scoped to
// `period_start IS NULL`, so a second run touches nothing and a row whose
// period was later corrected by hand is not stomped.
//
//   node --env-file=.env.local scripts/migrations/add-snapshot-period.mjs
//   DATABASE_URL='<prod>' node scripts/migrations/add-snapshot-period.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

await sql`
  ALTER TABLE treasury_snapshots
    ADD COLUMN IF NOT EXISTS period_start DATE
`;

// date_trunc returns a timestamp; the ::date cast is what makes this assignable
// to a DATE column without an implicit-cast surprise. RETURNING lets the log
// below state how many rows this run actually touched — on a re-run it is 0,
// which is the cheapest possible confirmation that the script is idempotent.
const backfilled = await sql`
  UPDATE treasury_snapshots
     SET period_start = date_trunc('month', snapshot_date)::date
   WHERE period_start IS NULL
  RETURNING id
`;

console.log(
  `✓ treasury_snapshots.period_start ready — backfilled ${backfilled.length} row(s)`
);
