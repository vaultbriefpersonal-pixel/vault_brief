// One-shot migration for Stage 16 (the honesty spine):
//
//   reports.validation_issues   JSONB
//
// ── THE INCIDENT THIS EXISTS FOR ───────────────────────────────────────────
// `validateReportContent` (services/prompts.ts) runs seven checks over every
// generated report — the balance figure appears, no forbidden phrase, a length
// floor, no trailing bare heading, no mid-sentence cut, no "no material
// concerns" beside real concerns, no figure-less Key Takeaways. Two correction
// attempts follow a failure (report-generator.ts:420-441).
//
// And then, if the second correction also fails, `generateReport` returns the
// markdown anyway (report-generator.ts:452) — no throw, no flag, nothing
// persisted. The caller cannot tell. The founder sees an ordinary report in
// "Pending review" and a green "Mark Ready" button, and `reports.updateStatus`
// has no content check of any kind. Everything the validator learned is
// discarded at the moment it matters.
//
// This column is where that verdict goes.
//
// ── WHY A COLUMN, AND NOT DERIVED ──────────────────────────────────────────
// This project's standing preference is to derive from what is already stored
// rather than add a column (treasury-composition.ts:48-54), and the other half
// of this stage follows it: "the flows on this snapshot are incomplete" is now
// derivable from `sync_warnings` and needs no migration at all.
//
// A validation verdict cannot be. It is a fact about what happened during one
// generation. Re-running the checks later answers a different question: the
// checks themselves change between releases, and two of them are gated on
// `sectionsWithContent`, which is computed from a live `ReportSectionContext`
// and is not stored anywhere. A later re-run would silently grade an old
// report against today's rules.
//
// ── THREE STATES IN ONE COLUMN ─────────────────────────────────────────────
//   NULL  — never recorded. Every report generated before this shipped, and
//           the correct reading is "unknown", NOT "clean". Surfaces must stay
//           silent on NULL rather than implying either verdict.
//   []    — checked, and every check passed.
//   [...] — checked, and these are the issues, verbatim from the validator.
//
// A second boolean column would be redundant with, and able to contradict,
// the array — the same reasoning that kept `is_system` off `presets` and
// `is_grant_deliverable` off `milestones`.
//
// ── NO BACKFILL, NO DEFAULT ────────────────────────────────────────────────
// Backfilling `[]` would assert that every historical report passed checks
// that never ran on it. Some of them provably did not: the live QA walkthrough
// that opened Stage 12 found a 473-character report cut off mid-word sitting
// in production. NULL is the only honest value for existing rows.
//
// ── NO INDEX ───────────────────────────────────────────────────────────────
// Read only alongside a report already fetched by id. Same "nothing queries by
// this yet at volume" reasoning as `reports.grant_id` / `preset_id`.
//
// ── ORDERING ───────────────────────────────────────────────────────────────
// No constraint relative to other migrations — the only in-flight change
// touching `reports`. Must still apply before this branch deploys: `schema.ts`
// names `validation_issues` the moment it ships, so every drizzle query
// against `reports` fails with `column "validation_issues" does not exist`
// until this has run.
//
// Idempotent (`ADD COLUMN IF NOT EXISTS`); the census at the end is read-only.
//
//   node --use-system-ca --env-file=.env.local scripts/migrations/add-report-validation-issues.mjs
//   DATABASE_URL='<prod>' node --use-system-ca scripts/migrations/add-report-validation-issues.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ─── 1. reports column ──────────────────────────────────────────────────────

await sql`
  ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS validation_issues JSONB
`;

// ─── 2. read-only census ────────────────────────────────────────────────────
//
// On a first run every report reads NULL (nothing backfilled, by design).
// `short_reports` is a courtesy signal, not part of the migration: it counts
// rows whose stored markdown is under the 800-character mark used to triage
// the Stage 12 truncation incident, so the operator can see at a glance
// whether any suspiciously short reports are already sitting in the table.

const [counts] = await sql`
  SELECT count(*)::int                                   AS total,
         count(validation_issues)::int                   AS with_verdict,
         count(*) FILTER (WHERE length(content_md) < 800)::int AS short_reports
    FROM reports
`;

console.log(
  `✓ report validation verdict column ready.\n` +
    `  reports: ${counts.total} row(s) — ${counts.with_verdict} carry a verdict, ` +
    `${counts.total - counts.with_verdict} read NULL ("never checked", not "clean").\n` +
    `  ${counts.short_reports} report(s) have content_md under 800 chars — worth a ` +
    `human eyeball for truncation, separately from this migration.\n` +
    `  Nothing was backfilled; validation_issues has no DEFAULT, by design — ` +
    `see this file's header.`
);
