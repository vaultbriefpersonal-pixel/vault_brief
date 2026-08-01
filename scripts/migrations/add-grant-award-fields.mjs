// One-shot migration: three additive nullable columns on grant_awards.
//
//   reporting_cadence      TEXT           'monthly' | 'quarterly'
//                                         | 'milestone_based' | 'ad_hoc'
//   next_report_due        DATE           when the next report is owed
//   amount_usd_at_receipt  NUMERIC(18,2)  what the money was worth on arrival
//
// grant_tranches is NOT TOUCHED. A tranche is a disbursement line inside one
// award's schedule; a reporting obligation belongs to the award as a whole,
// and pushing a cadence onto tranches would let one award carry four
// contradictory answers to "how often do we report".
//
// ── amount_usd_at_receipt IS NOT A COPY OF award_amount_usd ───────────────
// award_amount_usd is the figure STATED IN THE AGREEMENT, and it is nullable
// precisely because a token-denominated award ("30M OP") states none. This new
// column is what those tokens were ACTUALLY WORTH WHEN THEY LANDED — an
// observation about a disbursement, not a term of the agreement. Between
// signature and receipt the token moves, so for the same award "awarded 30M
// OP" and "received $48.2M of OP" are both true and are not the same number.
// Substituting either for the other prints, in a document a grantor makes a
// funding decision from, a figure the grant never contained. NULL here means
// no receipt value was recorded — it never means "same as awarded".
//
// ── WHY reporting_cadence IS PLAIN TEXT AND NOT A CHECK CONSTRAINT ────────
// The same call project_budgets.category documents: the allowed set is
// enforced in the SERVER's Zod input schema (grant-awards.ts), not in the
// database, so introducing a fifth cadence later is a code change rather than
// another migration against prod. A CHECK here would also reject rows that a
// future deploy considers valid during the window between DDL and code.
//
// Column types mirror src/server/db/schema.ts exactly (grantAwards
// .reportingCadence / .nextReportDue / .amountUsdAtReceipt) — a drift between
// the two is the hazard docs/MIGRATIONS.md warns about, and someone running
// `npx drizzle-kit push` later must see a no-op rather than a diff.
//
// ── NULLABLE, NOT BACKFILLED, AND SAFE TO APPLY BEFORE THE CODE DEPLOYS ───
// Three additive nullable columns change no existing read: the deployed
// createAward/updateAward never name them, and every deployed SELECT is
// drizzle-generated from a schema that does not know they exist. The reverse
// order is NOT safe — schema.ts on this branch DOES name all three, so every
// grant_awards query it generates fails with `column "reporting_cadence" does
// not exist` until this has run. Apply this first.
//
// There is deliberately no backfill. Any default for a cadence would be an
// invention about a real agreement, and any default for amount_usd_at_receipt
// would be the exact conflation the column exists to prevent.
//
// Every statement is idempotent (`ADD COLUMN IF NOT EXISTS`), so a re-run is a
// no-op; the census at the end is read-only.
//
//   node --env-file=.env.local scripts/migrations/add-grant-award-fields.mjs
//   DATABASE_URL='<prod>' node scripts/migrations/add-grant-award-fields.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

await sql`
  ALTER TABLE grant_awards
    ADD COLUMN IF NOT EXISTS reporting_cadence TEXT
`;

await sql`
  ALTER TABLE grant_awards
    ADD COLUMN IF NOT EXISTS next_report_due DATE
`;

await sql`
  ALTER TABLE grant_awards
    ADD COLUMN IF NOT EXISTS amount_usd_at_receipt NUMERIC(18, 2)
`;

// Read-only census. On a first run every new column is NULL everywhere, which
// is the intended end state rather than an incomplete migration; on a re-run
// the numbers are unchanged, which is the cheapest proof of idempotence.
//
// `next_report_due` is formatted SQL-SIDE with to_char. The Neon driver hands
// back a `date` column as a JS Date at LOCAL midnight, so the tempting
// `new Date(x).toISOString().slice(0, 10)` shifts the day backwards for anyone
// east of Greenwich and prints a date that is not in the table. This project
// has already been burned by exactly that; keep the formatting in Postgres.
const [census] = await sql`
  SELECT count(*)::int                                                AS total,
         count(reporting_cadence)::int                                AS with_cadence,
         count(next_report_due)::int                                  AS with_due_date,
         count(amount_usd_at_receipt)::int                            AS with_receipt_usd,
         to_char(min(next_report_due), 'YYYY-MM-DD')                  AS earliest_due
    FROM grant_awards
`;

console.log(
  `✓ grant_awards.reporting_cadence + next_report_due + amount_usd_at_receipt ready — ` +
    `${census.total} award(s): ${census.with_cadence} with a cadence, ` +
    `${census.with_due_date} with a next report due (earliest ${
      census.earliest_due ?? "none"
    }), ${census.with_receipt_usd} with a USD-at-receipt value. ` +
    `Nothing was backfilled, by design — see this file's header.`
);
