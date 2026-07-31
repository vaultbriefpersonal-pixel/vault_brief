// One-shot migration: let a treasury_snapshot say WHERE ITS BALANCES CAME FROM.
//
// Every balance figure on this table is written by `fetchAllBalances`
// (wallet-sync.ts), which takes no period argument: it reads the wallets live,
// as of the moment the sync runs. That is exactly right for a snapshot dated
// today and silently wrong for any other date. `projects.sync({months: 12})`
// walks twelve periods and calls the same live read for each, so it writes
// twelve rows that all carry TODAY's balances under twelve different dates —
// and month-over-month, anomalies and the forecast then read those rows as
// observed history and narrate a treasury that was perfectly flat for a year.
// Nothing in the output discloses that the numbers are copies. That is why
// SyncNowButton.tsx has had every `months > 1` option hard-disabled.
//
// P3.1 makes past balances reconstructable — walked back through Alchemy
// transfer history, `qty(t−1) = qty(t) − inbound(t) + outbound(t)`, and priced
// at the period's own close. A reconstruction is an estimate, and an estimate
// printed next to a measurement without a label is the same lie in a nicer
// suit. These two columns are the label.
//
//   balance_basis        TEXT   'observed' | 'reconstructed'
//   reconstruction_meta  JSONB  what the walk-back could and could not do
//
// PROVENANCE OF A HEADLINE NUMBER BELONGS IN A QUERYABLE COLUMN, not in the
// `transactions_raw` envelope and not in `sync_warnings`. `sync_warnings`
// renders as "this wallet failed to sync" chips in the dashboard, and a
// deliberate, disclosed reconstruction is not a failure. A column is also what
// lets a human answer "which of my rows are estimates?" with one SELECT.
//
// Column types mirror src/server/db/schema.ts exactly (treasurySnapshots
// .balanceBasis / .reconstructionMeta) — a drift between the two is the hazard
// docs/MIGRATIONS.md warns about, and someone running `npx drizzle-kit push`
// later must see a no-op rather than a diff.
//
// ─── NULLABLE ON PURPOSE, AND DELIBERATELY NOT BACKFILLED ──────────────────
//
// NULL reads as `observed`. That is defensible without qualification: every
// row that exists today was written by a code path that read the wallets live,
// so every one of them genuinely WAS observed. The reader is
// `balanceBasisOf()` in report-derived.ts, and it resolves NULL to "observed"
// rather than to "unknown".
//
// There is no `UPDATE ... SET balance_basis = 'observed'` here, and that
// omission is the considered half of this migration rather than an oversight.
// Contrast `add-snapshot-period.mjs`, which DOES backfill: there, the column
// was about to become the only place the true period lived, and leaving it
// NULL would have made a later reader guess. Here the opposite holds:
//
//   1. The code fallback has to handle NULL anyway, permanently. This
//      migration is applied BEFORE the dependent code deploys (the sequencing
//      rule in docs/MIGRATIONS.md), so for the whole window in between, the
//      CURRENTLY-DEPLOYED sync keeps inserting rows with no basis at all. A
//      backfill would be stale before the deploy finished.
//   2. A fully-populated column invites the belief that it is always
//      populated. The first reader that skips the NULL branch — `basis ===
//      'reconstructed' ? ... : ...` reads fine and is fine; `basis ===
//      'observed'` as a positive test silently excludes every legacy row —
//      would ship a bug that a backfill had hidden and that no test would
//      catch, because every row in the developer's database had a value.
//   3. NULL is honest about a third thing the literal is not: these rows were
//      written before the product had the concept. "Observed, and nobody was
//      asked" and "observed, and the sync said so" are the same balance and
//      not the same provenance.
//
// So the meaning of NULL is fixed in code (report-derived.ts) and asserted by
// unit tests, not established by a one-time UPDATE.
//
// SAFE TO APPLY BEFORE THE DEPENDENT CODE DEPLOYS, and it must be. Two
// additive nullable columns change no existing read: the currently-deployed
// sync does not name them in its INSERT, and every currently-deployed SELECT
// is drizzle-generated from a schema that does not know they exist. The
// reverse order is NOT safe — schema.ts on the P3.1 branch DOES name both
// columns, so every snapshot query it generates would fail with
// `column "balance_basis" does not exist` until this ran.
//
// IT DOES NOT TOUCH THE UNIQUE INDEX idx_snapshot_project_date, does not touch
// period_start, and does not touch any existing column's type, nullability or
// default. Same reasoning as add-snapshot-period.mjs: data-sync.ts uses
// (project_id, snapshot_date) as its `ON CONFLICT` target, and disturbing that
// index breaks the deployed upsert the instant the DDL lands.
//
// Both statements are idempotent — `IF NOT EXISTS`, no UPDATE, safe to re-run.
// The counts logged at the end are a read-only census, not a write.
//
//   node --env-file=.env.local scripts/migrations/add-snapshot-balance-basis.mjs
//   DATABASE_URL='<prod>' node scripts/migrations/add-snapshot-balance-basis.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

await sql`
  ALTER TABLE treasury_snapshots
    ADD COLUMN IF NOT EXISTS balance_basis TEXT
`;

await sql`
  ALTER TABLE treasury_snapshots
    ADD COLUMN IF NOT EXISTS reconstruction_meta JSONB
`;

// Read-only census. add-snapshot-period.mjs logs a `RETURNING` row count from
// its backfill; there is no backfill here, so the equivalent confirmation is
// the shape of the table afterwards. On a first run every row is NULL — which
// is the intended end state, not an incomplete migration — and on a re-run the
// numbers are unchanged, which is the cheapest proof the script is idempotent.
const [census] = await sql`
  SELECT count(*)::int                                              AS total,
         count(*) FILTER (WHERE balance_basis IS NULL)::int         AS null_basis,
         count(*) FILTER (WHERE balance_basis = 'observed')::int    AS observed,
         count(*) FILTER (WHERE balance_basis = 'reconstructed')::int AS reconstructed
    FROM treasury_snapshots
`;

console.log(
  `✓ treasury_snapshots.balance_basis + reconstruction_meta ready — ` +
    `${census.total} row(s): ${census.null_basis} NULL (reads as observed), ` +
    `${census.observed} observed, ${census.reconstructed} reconstructed. ` +
    `Nothing was backfilled, by design — see this file's header.`
);
