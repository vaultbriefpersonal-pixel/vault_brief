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
`add-project-members.mjs`, `add-project-budgets.mjs`. These are one-shots
kept as a record; each is safe to re-run (all use `IF NOT EXISTS`).

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
