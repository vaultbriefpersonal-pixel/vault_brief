// One-shot migration: seven additive nullable columns across four tables,
// backing the four grant-report blocks from Stage 5.
//
//   grant_awards.leftover_funds_plan   TEXT           what happens to the money left over
//   grant_awards.plan_deviation        TEXT           how the work departed from the plan
//   grant_tranches.utilized_usd        NUMERIC(18,2)  how much of THIS tranche has been used
//   grant_tranches.source_of_truth     TEXT           evidence for this disbursement line
//   milestones.source_of_truth         TEXT           evidence this deliverable landed
//   grants.source_of_truth             TEXT           evidence for this outbound allocation
//   projects.external_dashboard_url    TEXT           where the live numbers actually live
//
// ── WHY A MIGRATION AT ALL — THE PLAN SAID STAGE 5 NEEDED NONE ────────────
// Three of the four blocks are MANUAL: a plan for leftover funds, a
// plan-deviation statement, and a dashboard URL. Every existing home for
// founder-typed content was checked and none of them fits:
//
//   • `projects.report_sections` is the section TEMPLATE — an ordered array of
//     {id, enabled}. It says which blocks a project renders, never what any of
//     them says. Putting narrative in there would make the template a data
//     store and break `resolveSections`, which reads the array as config.
//   • `grants`, `partners`, `qa_highlights`, `governance_proposals`, `asks`
//     are the five manual-section tables. Each is a LIST of same-shaped rows
//     scoped to a 'YYYY-MM' period. A leftover-funds plan is not a list, it is
//     one statement per AWARD; a deviation statement is one per award too.
//     Modelling either as a one-row list would need a new table with a unique
//     constraint standing in for a column.
//   • `project_budgets` is planned spend per (period, kind, category). No text
//     field on it means anything other than a note about that budget line.
//   • `reports` holds GENERATED output (`content_md`, `founder_notes`). A
//     report row exists only after generation, and these fields are inputs.
//
// So the columns did not exist and could not be faked. They are additive and
// nullable, which is the cheapest correct answer.
//
// ── utilized_usd IS ON grant_tranches, NOT grant_awards, AND IS NOT SPEND ──
// `leftover_funds` is `received − utilized` AT GRANT SCOPE. "Received" is
// already the sum of tranches whose `received_date` is set; utilisation has to
// be measured on the same axis or the subtraction is between two different
// things. A tranche is also the unit a grantor actually asks about ("you drew
// tranche 2, what did it go on?"), and Optimism-style reports report
// utilisation per tranche.
//
// THIS IS NOT TREASURY SPEND AND MUST NEVER BE DERIVED FROM IT. The treasury
// is fungible and its opening balance is not recorded, so `received − spent`
// against the treasury is unrepresentable — see the ban documented on
// `grant_fund_usage` in report-sections.ts, which stands unchanged. This
// column is a founder's assertion about ONE grant's money, entered by hand,
// and it is the only thing that makes a grant-scoped leftover figure legal.
//
// NULL therefore means "no utilisation recorded", never zero. Zero utilised
// and nothing recorded produce opposite sentences: the first says the grant is
// untouched, the second says nobody has answered the question. Coercing NULL
// to 0 would print "leftover = everything you received" for every award nobody
// has filled in — the exact fabrication class this project bans elsewhere.
//
// ── source_of_truth IS A COLUMN, NOT A SECTION ────────────────────────────
// Optimism's term, kept verbatim because it is the most transferable idea in
// the corpus: every claimed item carries a pointer a reader can check — a tx
// hash, an explorer URL, a GitHub link, a dashboard URL, or an address. Plain
// TEXT rather than a URL-typed column precisely because a bare tx hash and a
// bare address are both legitimate and neither is a URL.
//
// `grant_tranches.tx_hash` already exists and is NOT replaced or repurposed.
// It is narrower (a transaction hash and nothing else) and deployed code
// writes it. The new column sits beside it; the renderer prefers
// `source_of_truth` and falls back to `tx_hash`, so no existing row loses its
// evidence and no existing writer has to change.
//
// ── external_dashboard_url IS ON projects, NOT ON THE AWARD ───────────────
// The claim the block makes is about the whole report — "this document is not
// the source of truth for its own numbers, the dashboard is" — and it is true
// for a project with no grant at all. One project-level column also keeps the
// block renderable outside the grant sections, which an award-scoped column
// would not. A project needing several dashboards is a later problem and a
// later table; one column is the smallest thing that works.
//
// ── NULLABLE, NOT BACKFILLED, AND SAFE TO APPLY BEFORE THE CODE DEPLOYS ───
// Seven additive nullable columns change no existing read: every deployed
// SELECT is drizzle-generated from a schema that does not know they exist, and
// no deployed write names them. The REVERSE ORDER IS NOT SAFE — schema.ts on
// this branch DOES name all seven, so every query it generates against these
// four tables fails with `column "..." does not exist` until this has run.
// Apply this first, then deploy.
//
// There is deliberately no backfill and no DEFAULT. A default for
// `plan_deviation` would put the words "No changes to the original plan" into
// a database row nobody wrote, turning a rendering decision into a stored
// assertion; the block supplies that sentence at RENDER time instead, where it
// is visibly the product's standing text. A default for `utilized_usd` would
// be the zero-versus-null conflation two paragraphs up.
//
// Every statement is idempotent (`ADD COLUMN IF NOT EXISTS`), so a re-run is a
// no-op; the census at the end is read-only.
//
//   node --use-system-ca --env-file=.env.local scripts/migrations/add-grant-report-fields.mjs
//   DATABASE_URL='<prod>' node --use-system-ca scripts/migrations/add-grant-report-fields.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

await sql`
  ALTER TABLE grant_awards
    ADD COLUMN IF NOT EXISTS leftover_funds_plan TEXT
`;

await sql`
  ALTER TABLE grant_awards
    ADD COLUMN IF NOT EXISTS plan_deviation TEXT
`;

await sql`
  ALTER TABLE grant_tranches
    ADD COLUMN IF NOT EXISTS utilized_usd NUMERIC(18, 2)
`;

await sql`
  ALTER TABLE grant_tranches
    ADD COLUMN IF NOT EXISTS source_of_truth TEXT
`;

await sql`
  ALTER TABLE milestones
    ADD COLUMN IF NOT EXISTS source_of_truth TEXT
`;

await sql`
  ALTER TABLE grants
    ADD COLUMN IF NOT EXISTS source_of_truth TEXT
`;

await sql`
  ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS external_dashboard_url TEXT
`;

// Read-only census. On a first run every new column is NULL everywhere, which
// is the intended end state rather than an incomplete migration; on a re-run
// the numbers are unchanged, which is the cheapest proof of idempotence.
//
// `min(received_date)` is formatted SQL-SIDE with to_char. The Neon driver
// hands back a `date` column as a JS Date at LOCAL midnight, so the tempting
// `new Date(x).toISOString().slice(0, 10)` shifts the day backwards for anyone
// east of Greenwich and prints a date that is not in the table. This project
// has already been burned by exactly that; keep the formatting in Postgres.
const [awards] = await sql`
  SELECT count(*)::int                      AS total,
         count(leftover_funds_plan)::int    AS with_leftover_plan,
         count(plan_deviation)::int         AS with_deviation
    FROM grant_awards
`;

const [tranches] = await sql`
  SELECT count(*)::int                              AS total,
         count(received_date)::int                  AS received,
         count(utilized_usd)::int                   AS with_utilized,
         count(source_of_truth)::int                AS with_source,
         count(tx_hash)::int                        AS with_tx_hash,
         to_char(min(received_date), 'YYYY-MM-DD')  AS earliest_receipt
    FROM grant_tranches
`;

const [evidence] = await sql`
  SELECT (SELECT count(source_of_truth)::int FROM milestones)          AS milestones_with_source,
         (SELECT count(source_of_truth)::int FROM grants)              AS grants_with_source,
         (SELECT count(external_dashboard_url)::int FROM projects)     AS projects_with_dashboard
`;

console.log(
  `✓ grant report fields ready.\n` +
    `  grant_awards: ${awards.total} row(s) — ${awards.with_leftover_plan} with a leftover-funds plan, ` +
    `${awards.with_deviation} with a plan-deviation statement.\n` +
    `  grant_tranches: ${tranches.total} row(s), ${tranches.received} marked received ` +
    `(earliest ${tranches.earliest_receipt ?? "none"}) — ${tranches.with_utilized} with a utilisation figure, ` +
    `${tranches.with_source} with a Source of Truth (${tranches.with_tx_hash} still carry only tx_hash, ` +
    `which the renderer falls back to).\n` +
    `  evidence elsewhere: ${evidence.milestones_with_source} milestone(s), ` +
    `${evidence.grants_with_source} outbound grant(s), ` +
    `${evidence.projects_with_dashboard} project(s) with an external dashboard.\n` +
    `  Nothing was backfilled and no column has a DEFAULT, by design — see this file's header.`
);
