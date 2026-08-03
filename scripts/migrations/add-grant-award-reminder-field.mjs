// One-shot migration for Stage 8 (report-due reminders):
//
//   grant_awards.last_reminded_at   TIMESTAMPTZ
//
// ── WHY THIS COLUMN, OVER THE MIGRATION-FREE ALTERNATIVE ──────────────────
// `src/server/jobs/anomaly-alerts.ts` shows a precedent for dodging a
// migration entirely by encoding a dedup key into `notifications.href` and
// checking for an existing row before sending. That option was raised and
// rejected for this stage: a column is a queryable, inspectable fact about
// the award itself rather than a string encoded into an unrelated table, and
// it composes better with the existing manual-entry form (a future "last
// reminded: Aug 1" display costs nothing extra once the column exists).
// Confirmed with the user before writing the plan this migration implements.
//
// ── SEMANTICS: NULL MEANS "ELIGIBLE TO BE REMINDED AGAIN" ─────────────────
// Not "never reminded" specifically — NULL also covers "the due date changed
// since the last reminder". `updateAward` (trpc/routers/grant-awards.ts)
// resets this column to NULL whenever `nextReportDue` is changed to a
// genuinely different value in the same call. A same-value resubmission
// (the form re-saving unrelated fields) must NOT clear it — only an actual
// date change does. That is what keeps the semantics exactly "have we
// already reminded for the due date that's set right now," not "have we
// ever reminded, regardless of date changes" — reproducing the href-trick's
// best property (moving the due date gets you a fresh reminder cycle)
// explicitly, via one column, rather than implicitly via string-encoding.
//
// ── NO INDEX ───────────────────────────────────────────────────────────────
// The reminder job's query already filters on `status` and `next_report_due`
// first; adding one more row-scan predicate on a small, per-project table
// doesn't warrant an index, matching this project's repeated "nothing
// queries by this yet at volume" reasoning elsewhere (e.g.
// `milestones.grant_award_id`, `reports.grant_id`/`preset_id`).
//
// ── NO BACKFILL, NO DEFAULT ────────────────────────────────────────────────
// Every existing award genuinely has never been reminded by this job (it did
// not exist before this stage), so NULL states a real fact for every
// pre-existing row rather than a fabricated one.
//
// ── ORDERING ────────────────────────────────────────────────────────────────
// No ordering constraint relative to other pending migrations — this is the
// only in-flight schema change referencing `grant_awards` at the time this
// stage is planned. Must still apply before this branch deploys: `schema.ts`
// names `last_reminded_at` the moment it ships, so every drizzle-generated
// query against `grant_awards` fails with `column "last_reminded_at" does
// not exist` until this has run.
//
// Idempotent (`ADD COLUMN IF NOT EXISTS`), so a re-run is a no-op; the
// census at the end is read-only.
//
//   node --use-system-ca --env-file=.env.local scripts/migrations/add-grant-award-reminder-field.mjs
//   DATABASE_URL='<prod>' node --use-system-ca scripts/migrations/add-grant-award-reminder-field.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ─── 1. grant_awards column ─────────────────────────────────────────────────

await sql`
  ALTER TABLE grant_awards
    ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ
`;

// ─── 2. read-only census ────────────────────────────────────────────────────
//
// On a first run: every award reads last_reminded_at = NULL (nothing
// backfilled, by design). On a re-run the numbers are unchanged, which is
// the cheapest proof of idempotence.

const [counts] = await sql`
  SELECT count(*)::int                                        AS total,
         count(last_reminded_at)::int                         AS with_reminder,
         count(*) FILTER (WHERE status = 'active'
                             AND next_report_due IS NOT NULL
                             AND last_reminded_at IS NULL)::int AS reminder_eligible
    FROM grant_awards
`;

console.log(
  `✓ grant award reminder field ready.\n` +
    `  grant_awards: ${counts.total} row(s) — ${counts.with_reminder} with a ` +
    `last_reminded_at set, ${counts.reminder_eligible} currently eligible for ` +
    `a reminder (active, next_report_due set, never reminded for it).\n` +
    `  Nothing was backfilled; last_reminded_at has no DEFAULT, by design — ` +
    `see this file's header.`
);
