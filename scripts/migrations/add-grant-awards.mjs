// One-shot migration: create grant_awards + grant_tranches, and hang an
// optional grant_award_id off milestones.
//
// These model money this project RECEIVED — an ecosystem grant (Optimism,
// Arbitrum, ENS, Gitcoin) the team must periodically report on. The reader is
// the grantor, and the question is "where did our award go and what did you
// ship with it".
//
// ── THE NAMING TRAP, READ THIS BEFORE TOUCHING EITHER TABLE ───────────────
// There is already a `grants` table and it is NOT this. `grants` models money
// this project GIVES OUT: its columns are `recipient`, `amount_usd`,
// `status: committed|disbursed`, `period`; "grants" is a real ExpenseCategory
// in expense-classifier.ts; and the `grants_distributed` report section
// narrates deployment efficiency to INVESTORS. Opposite direction of capital,
// opposite reader, disjoint columns — the only thing the two share is a word.
//
// Overloading `grants` with a nullable `direction` flag was considered and
// rejected: every existing consumer (the section, the classifier, the router,
// the modal renderer) would then have to filter by it, and the failure mode of
// forgetting is an outbound disbursement reported to a funder as an inbound
// award — a wrong number in a document that funds the company. Separate tables
// make that mistake unrepresentable. See the matching header in schema.ts.
//
// Column types mirror src/server/db/schema.ts exactly (grantAwards,
// grantTranches, milestones.grantAwardId) — a drift between the two is the
// hazard docs/MIGRATIONS.md warns about, and someone running
// `npx drizzle-kit push` later must see a no-op rather than a diff. That is
// why the three indexes below are also declared in schema.ts: an index that
// exists in the database but not in the Drizzle schema is exactly the kind of
// difference push would propose to reconcile.
//
// ── DELETE SEMANTICS, EACH CHOSEN SEPARATELY ──────────────────────────────
// grant_tranches.grant_award_id → ON DELETE CASCADE. Correct: a tranche is a
//   line in an award's disbursement schedule and has no meaning without it.
//   Delete the award and an orphan "$50,000, expected 2026-09-01" row would
//   describe nothing.
//
// milestones.grant_award_id → ON DELETE SET NULL. Deliberate, and the opposite
//   choice for a deliberate reason: a milestone is the team's own record of
//   shipped work, which exists independently of who funded it. CASCADE there
//   would mean deleting one mistyped grant row silently destroys the shipped
//   history that `milestones_completed` and `looking_ahead` report from — data
//   the founder entered by hand, unrecoverable, with no error and no warning.
//   SET NULL degrades the milestone to "not attributed to a grant", which is
//   the truth after the award record is gone.
//
// ── WHY grant_tranches CARRIES project_id ─────────────────────────────────
// It is reachable via grant_award_id, so the column is redundant as data. It
// is not redundant as an ownership handle. Every guard in
// src/server/trpc/guards.ts has the same two-step shape — resolve the row by
// id, then hand `row.projectId` to `requireProject` — and denormalising
// project_id onto the tranche is what lets `requireGrantTranche` keep exactly
// that shape instead of adding a hop through grant_awards first. (Note the
// guards are two queries, not one: the row lookup and then requireProject's
// own project/membership lookup. The saving here is the extra join, not the
// second query.) The FK to projects also carries its own ON DELETE CASCADE, so
// deleting a project still cleans up tranches by both paths.
//
// ── PURELY ADDITIVE, SAFE TO APPLY BEFORE THE DEPENDENT CODE DEPLOYS ──────
// Nothing in the running product reads or writes any of this. The tRPC router
// and the report sections that consume it land afterwards — the same precedent
// as add-project-budgets.mjs, whose table sat empty and unread until the
// query/UI layer followed it. Applying this changes no existing behaviour: the
// new milestones column is nullable with no default, so every current
// milestones INSERT (which never names it) keeps working unchanged.
//
// Every statement is idempotent — CREATE TABLE IF NOT EXISTS, ADD COLUMN
// IF NOT EXISTS, CREATE INDEX IF NOT EXISTS — so a re-run is a no-op. The
// RETURNING-style row counts below report what each object's state is after
// the run rather than asserting a count this script cannot know.
//
//   node --env-file=.env.local scripts/migrations/add-grant-awards.mjs
//   DATABASE_URL='<prod>' node scripts/migrations/add-grant-awards.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// award_amount_usd is NULLABLE on purpose: an award may be denominated only in
// tokens (30M OP, no USD figure in the agreement), and writing a converted
// number into a USD column would invent a precision the grant agreement never
// stated. grant_tranches.amount_usd is NOT NULL by contrast — a tranche is a
// disbursement line, and a schedule entry with no amount is not a fact about
// anything. See the same asymmetry commented in schema.ts.
await sql`
  CREATE TABLE IF NOT EXISTS grant_awards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    grantor TEXT NOT NULL,
    program TEXT,
    award_amount_usd NUMERIC(18, 2),
    award_amount_token NUMERIC(30, 8),
    award_token_symbol TEXT,
    award_date DATE NOT NULL,
    reporting_start_date DATE,
    status TEXT NOT NULL DEFAULT 'active',
    agreement_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS grant_tranches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grant_award_id UUID NOT NULL REFERENCES grant_awards(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    amount_usd NUMERIC(18, 2) NOT NULL,
    expected_date DATE,
    received_date DATE,
    tx_hash TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )
`;

await sql`
  ALTER TABLE milestones
    ADD COLUMN IF NOT EXISTS grant_award_id UUID
      REFERENCES grant_awards(id) ON DELETE SET NULL
`;

// Three indexes, one per foreign key the product will actually filter on.
// Postgres creates an index for a PRIMARY KEY and for a UNIQUE constraint but
// NOT for a plain foreign key, so without these every list query is a
// sequential scan and — more expensively — every `DELETE FROM projects` and
// `DELETE FROM grant_awards` has to seq-scan the child table to enforce the
// referential action.
//
//   grant_awards.project_id      — "list this project's awards", the only
//                                  read path the router exposes.
//   grant_tranches.grant_award_id — "the tranches of this award", the nested
//                                  read, and the CASCADE target.
//   grant_tranches.project_id     — what requireGrantTranche and the
//                                  project-scoped list filter on.
//
// DELIBERATELY NOT INDEXED: milestones.grant_award_id. It would only pay off
// for "milestones of award X", and the milestones table is per-project and
// small (a founder hand-types these; the existing list query has no LIMIT and
// no pagination because the row count does not warrant it). The grant
// milestone section in the follow-up phase filters an already-loaded
// per-project milestone list in memory rather than issuing a per-award query,
// so the index would have no reader at all — and it would still have to be
// maintained on every milestone write. If a per-award query ever lands, add it
// then, in its own migration, with the query that justifies it.
await sql`
  CREATE INDEX IF NOT EXISTS idx_grant_awards_project
    ON grant_awards (project_id)
`;
await sql`
  CREATE INDEX IF NOT EXISTS idx_grant_tranches_award
    ON grant_tranches (grant_award_id)
`;
await sql`
  CREATE INDEX IF NOT EXISTS idx_grant_tranches_project
    ON grant_tranches (project_id)
`;

// Report what is actually in the database now rather than what this run did.
// On a first run both counts are 0; on a re-run they are whatever the tables
// hold, which is the cheapest confirmation that a second run destroyed
// nothing. `count(*)` comes back as a string from the driver (bigint), hence
// the explicit Number().
const [awards] = await sql`SELECT count(*)::int AS n FROM grant_awards`;
const [tranches] = await sql`SELECT count(*)::int AS n FROM grant_tranches`;
const [linked] = await sql`
  SELECT count(*)::int AS n FROM milestones WHERE grant_award_id IS NOT NULL
`;

console.log(
  `✓ grant_awards ready — ${Number(awards.n)} row(s)\n` +
    `✓ grant_tranches ready — ${Number(tranches.n)} row(s)\n` +
    `✓ milestones.grant_award_id ready — ${Number(linked.n)} milestone(s) attributed to an award`
);
