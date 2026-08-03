# Database migrations

_How schema changes reach the database. Read this before touching
`src/server/db/schema.ts` or running any migration command._

> **Running migrations is a Forbidden Area** (see `AGENTS.md` /
> `SECURITY_NOTES.md`). Editing `schema.ts` is fine to propose, but
> generating, pushing, or applying a schema change to any database
> requires explicit human approval and is run by a human — never
> automatically by an agent.

## Source of truth

`src/server/db/schema.ts` is the single source of truth for the schema
(Drizzle table definitions). `drizzle.config.ts` points at it:

```ts
schema: "./src/server/db/schema.ts",
out:    "./src/server/db/migrations",   // drizzle-kit output dir
dialect:"postgresql",
dbCredentials: { url: process.env.DATABASE_URL! },
```

Neon (serverless Postgres) is the database; the app talks to it through
the Drizzle Neon HTTP driver.

## The two mechanisms in this repo

There are historically **two** ways schema changes have been applied.
This is the drift risk called out in `ARCHITECTURE.md`. Going forward,
prefer mechanism (1); use (2) only for a narrow, idempotent prod column
add when you don't want a full push.

### 1. `drizzle-kit push` — canonical

Applies the diff between `schema.ts` and the live database directly.
This is what `DEPLOY.md` uses for initial setup and is the default path
for schema changes.

```bash
npx drizzle-kit push        # apply schema.ts to the DB in DATABASE_URL
```

Note: the `out` dir `src/server/db/migrations/` is currently **empty** —
this project does not use the generate → migrate file-based flow. `push`
diffs and applies in one step. (If the team later wants versioned SQL
files + a migrate step, that's a deliberate change to adopt
`drizzle-kit generate` + `drizzle-kit migrate`; document it here when it
happens.)

### 2. Ad-hoc one-shot scripts — `scripts/migrations/*.mjs`

Small, **idempotent** scripts that ALTER a single thing with
`IF NOT EXISTS`, run manually against a specific `DATABASE_URL`. Used
for targeted prod column adds without a full push. Example
(`scripts/migrations/add-snapshot-space.mjs`):

```js
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS snapshot_space TEXT`;
```

Run with:

```bash
node --env-file=.env.local scripts/migrations/add-snapshot-space.mjs   # local
DATABASE_URL='<prod>'      node scripts/migrations/add-snapshot-space.mjs  # prod
```

Existing scripts: `add-snapshot-space.mjs`, `add-report-sections.mjs`,
`add-manual-section-tables.mjs`, `add-chat-notify-channels.mjs`,
`add-project-members.mjs`, `add-project-budgets.mjs`,
`add-snapshot-period.mjs`, `add-grant-awards.mjs`,
`add-snapshot-balance-basis.mjs`, `add-grant-award-fields.mjs`,
`add-grant-report-fields.mjs`, `add-report-presets.mjs`. These are
one-shots kept as a record; each is safe to re-run (all use
`IF NOT EXISTS` / `ON CONFLICT ... DO NOTHING`).

`add-report-presets.mjs` is **not yet applied** and, like
`add-snapshot-balance-basis.mjs` below, **must run before the code that
depends on it deploys**. It creates the new `presets` table (plus its
two indexes and a seed insert for the three system presets:
`generic_grant`, `minimal`, `forum_post`) and adds four additive columns
to `reports` — `report_type` (`NOT NULL DEFAULT 'investor'`), `grant_id`,
`preset_id`, `blocks` — all of which `schema.ts` now names, so every
drizzle-generated query against `reports` fails with
`column "..." does not exist` until it has run. It must be applied AFTER
`add-grant-report-fields.mjs` (`reports.grant_id` references
`grant_awards`, which that migration's predecessor,
`add-grant-awards.mjs`, creates — already satisfied, but
`add-grant-report-fields.mjs` is the most recent change to that table
and the natural "run after" marker). `report_type`'s `DEFAULT 'investor'`
is a deliberate, narrow exception to the no-default convention below —
see the migration's own header comment for why.

`add-grant-report-fields.mjs` is **not yet applied** and, like
`add-snapshot-balance-basis.mjs` below, **must run before the code that
depends on it deploys**. It adds seven additive nullable columns —
`grant_awards.leftover_funds_plan` / `.plan_deviation`,
`grant_tranches.utilized_usd` / `.source_of_truth`,
`milestones.source_of_truth`, `grants.source_of_truth`,
`projects.external_dashboard_url` — all of which `schema.ts` now names, so
every drizzle-generated query against those four tables fails with
`column "..." does not exist` until it has run. It must be applied AFTER
`add-grant-award-fields.mjs`, which is the previous change to
`grant_awards`. Nothing is backfilled and no column carries a DEFAULT.

`add-snapshot-balance-basis.mjs` **must be applied before the code that
depends on it deploys**, and this is the direction that matters: it adds
`treasury_snapshots.balance_basis` and `.reconstruction_meta`, which
`schema.ts` now names — so every drizzle-generated snapshot query on the
new code fails with `column "balance_basis" does not exist` until it has
run. The reverse order is harmless: two additive nullable columns change
no read the currently-deployed code performs.

`scripts/setup-db.mjs` bootstraps a fresh database.

## Recommended workflow for a schema change

1. Edit `src/server/db/schema.ts` (propose in a PR).
2. **Get explicit approval** — this is a Forbidden Area.
3. A human applies it: `npx drizzle-kit push` (preferred), or a new
   idempotent `scripts/migrations/*.mjs` for a narrow column add.
4. Keep any relations (`src/server/db/relations.ts`) in sync.
5. Note the change in the PR description so prod + any other environment
   get the same treatment (drift between environments is the main hazard).

## Hazards

- **Environment drift** — because `push` diffs against whatever DB it
  points at, forgetting to run it against prod (or a preview DB) leaves
  environments out of sync. Always apply the same change everywhere.
- **Two mechanisms** — mixing `push` and ad-hoc `.mjs` can make it
  unclear what state a DB is in. Prefer one path per change and record it.
- **No down-migrations** — neither mechanism has an automatic rollback.
  Reversals are manual, so review additive-vs-destructive carefully
  (dropping a column is not reversible from these tools).

## Never

- Run any migration command automatically or without approval.
- Apply a destructive change (drop column/table, type narrowing) without
  an explicit, reviewed plan and a backup.
