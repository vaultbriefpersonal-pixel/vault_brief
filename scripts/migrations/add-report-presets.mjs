// One-shot migration for Stage 6 (presets + per-report block config):
//
//   presets                 NEW TABLE   named, reusable report block-configs
//   reports.report_type     TEXT NOT NULL DEFAULT 'investor'
//   reports.grant_id        UUID REFERENCES grant_awards(id) ON DELETE SET NULL
//   reports.preset_id       UUID REFERENCES presets(id) ON DELETE SET NULL
//   reports.blocks          JSONB
//
// ── WHY A NEW TABLE ───────────────────────────────────────────────────────
// `presets` is the same shape as `projects.reportSections` — an ordered
// array of {id, enabled} — but named, shareable across projects (system
// presets, project_id IS NULL) and selectable PER GENERATION via
// `reports.preset_id`, rather than baked into a project's one live template.
// There is deliberately no `is_system` boolean: this codebase already
// rejected the identical shape once, on `milestones.grant_award_id` ("There
// is deliberately no `is_grant_deliverable` boolean — the FK carries that
// fact and cannot disagree with itself"). `project_id IS NULL` is the same
// fact for a preset, and a separate boolean here could disagree with it.
//
// ── report_type DEFAULT 'investor' IS A DELIBERATE, NARROW EXCEPTION ──────
// Every other additive column in this project's migrations ships with no
// default (see add-grant-report-fields.mjs's header). This one does, because
// unlike `blocks` below (genuinely unknowable for old rows), every report
// generated before this stage truly IS investor-shaped — grant reporting is
// new as of Stage 6, so the default states a real historical fact rather
// than fabricating one.
//
// ── grant_id / preset_id ARE ON DELETE SET NULL, NOT CASCADE ──────────────
// Same reasoning as `milestones.grant_award_id`: a report may already be
// sent to a funder and outlives the award or preset record that produced it.
// CASCADE here would silently destroy report history when an award or
// preset is deleted; SET NULL degrades the row to "no longer attributed",
// which is exactly what is true once the referenced record is gone. Neither
// column is indexed — nothing queries by them yet, same reasoning as
// `milestones.grant_award_id`.
//
// ── blocks HAS NO DEFAULT AND IS NOT BACKFILLED ───────────────────────────
// It is the resolved section list that actually produced a report's
// `content_md`, frozen at generation time. `resolveSections()` has always
// run fresh against LIVE `project.report_sections` + LIVE `SECTION_LIBRARY`
// on every generation and regenerate, with nothing recorded about which ids
// actually rendered — so there is no way to reconstruct what an old report
// used. NULL on every existing row means exactly that: unknown, not "used
// the defaults".
//
// ── THE THREE SYSTEM PRESETS ARE SEEDED HERE, LOOKED UP BY NAME ───────────
// `generic_grant` / `minimal` / `forum_post`, built from the FULL resolved
// section list (every id in SECTION_LIBRARY_META as of this stage, explicit
// enabled/disabled) rather than a sparse diff — `resolveSections` only
// auto-splices a section at ITS OWN global default when a stored config
// omits it entirely, so a preset that wants a globally-on section turned off
// must say so explicitly. The seed is idempotent
// (`ON CONFLICT (name) WHERE project_id IS NULL DO NOTHING`) and every
// runtime lookup in app code reads these BY NAME — never a hardcoded UUID.
//
// ── ORDERING: AFTER add-grant-report-fields.mjs, BEFORE THIS BRANCH DEPLOYS
// `presets.block_config`'s three seeded rows are inert until app code reads
// them, so running this before add-grant-report-fields.mjs would be safe on
// its own — but `reports.grant_id` REFERENCES `grant_awards(id)`, so
// `grant_awards` must already exist (it does, since Stage 4). The REAL
// ordering constraint is with the code deploy: `schema.ts` on this branch
// names `presets` and all four new `reports` columns, so every
// drizzle-generated query against `reports` fails with
// `column "..." does not exist` until this has run. Apply this first, then
// deploy.
//
// Every statement is idempotent (`IF NOT EXISTS` / `ON CONFLICT ... DO
// NOTHING`), so a re-run is a no-op; the census at the end is read-only.
//
//   node --use-system-ca --env-file=.env.local scripts/migrations/add-report-presets.mjs
//   DATABASE_URL='<prod>' node --use-system-ca scripts/migrations/add-report-presets.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ─── 1. presets table ───────────────────────────────────────────────────────

await sql`
  CREATE TABLE IF NOT EXISTS presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    block_config JSONB NOT NULL,
    default_export_format TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )
`;

// ─── 2. indexes ─────────────────────────────────────────────────────────────

await sql`
  CREATE INDEX IF NOT EXISTS idx_presets_project
    ON presets (project_id)
`;

// Partial unique index: uniqueness only among system presets (project_id IS
// NULL). User-owned presets carry no name-uniqueness constraint — a rough
// edge, not a correctness issue, not worth a constraint for this stage. This
// is also the arbiter index the seed insert below's `ON CONFLICT` targets.
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_presets_system_name
    ON presets (name)
    WHERE project_id IS NULL
`;

// ─── 3. seed the three system presets ──────────────────────────────────────
//
// Every id below was checked against SECTION_LIBRARY_META in
// report-sections.ts as of this stage (31 sections). Full resolved lists,
// not sparse diffs — see the header comment above.

const GENERIC_GRANT_CONFIG = [
  { id: "executive_summary", enabled: true },
  { id: "key_takeaways", enabled: true },
  { id: "wins", enabled: true },
  { id: "lows_concerns", enabled: true },
  { id: "treasury_overview", enabled: true },
  { id: "treasury_by_chain", enabled: true },
  { id: "treasury_concentration", enabled: true },
  { id: "previous_month_comparison", enabled: true },
  { id: "financial_health", enabled: true },
  { id: "expense_breakdown", enabled: true },
  { id: "actual_vs_budget", enabled: false },
  { id: "protocol_revenue", enabled: true },
  { id: "treasury_operations", enabled: true },
  { id: "major_transactions", enabled: true },
  { id: "grants_distributed", enabled: false },
  { id: "grant_fund_usage", enabled: true },
  { id: "grant_milestone_progress", enabled: true },
  { id: "leftover_funds", enabled: true },
  { id: "plan_deviation", enabled: true },
  { id: "external_dashboard", enabled: true },
  { id: "token_metrics", enabled: true },
  { id: "governance_updates", enabled: false },
  { id: "development_progress", enabled: true },
  { id: "milestones_completed", enabled: true },
  { id: "partners_integrations", enabled: false },
  { id: "anomalies", enabled: true },
  { id: "next_period_forecast", enabled: true },
  { id: "recommendations", enabled: true },
  { id: "looking_ahead", enabled: true },
  { id: "asks", enabled: false },
  { id: "qa_highlights", enabled: false },
];

const MINIMAL_CONFIG = [
  { id: "executive_summary", enabled: true },
  { id: "key_takeaways", enabled: true },
  { id: "wins", enabled: true },
  { id: "lows_concerns", enabled: true },
  { id: "treasury_overview", enabled: false },
  { id: "treasury_by_chain", enabled: false },
  { id: "treasury_concentration", enabled: false },
  { id: "previous_month_comparison", enabled: false },
  { id: "financial_health", enabled: false },
  { id: "expense_breakdown", enabled: false },
  { id: "actual_vs_budget", enabled: false },
  { id: "protocol_revenue", enabled: false },
  { id: "treasury_operations", enabled: false },
  { id: "major_transactions", enabled: false },
  { id: "grants_distributed", enabled: false },
  { id: "grant_fund_usage", enabled: false },
  { id: "grant_milestone_progress", enabled: true },
  { id: "leftover_funds", enabled: false },
  { id: "plan_deviation", enabled: true },
  { id: "external_dashboard", enabled: false },
  { id: "token_metrics", enabled: false },
  { id: "governance_updates", enabled: false },
  { id: "development_progress", enabled: true },
  { id: "milestones_completed", enabled: true },
  { id: "partners_integrations", enabled: false },
  { id: "anomalies", enabled: false },
  { id: "next_period_forecast", enabled: false },
  { id: "recommendations", enabled: true },
  { id: "looking_ahead", enabled: true },
  { id: "asks", enabled: false },
  { id: "qa_highlights", enabled: false },
];

const FORUM_POST_CONFIG = MINIMAL_CONFIG.map((entry) =>
  entry.id === "recommendations" || entry.id === "development_progress"
    ? { ...entry, enabled: false }
    : entry
);

const SEEDS = [
  { name: "generic_grant", config: GENERIC_GRANT_CONFIG, format: "pdf" },
  { name: "minimal", config: MINIMAL_CONFIG, format: "pdf" },
  { name: "forum_post", config: FORUM_POST_CONFIG, format: "markdown" },
];

for (const { name, config, format } of SEEDS) {
  await sql`
    INSERT INTO presets (project_id, name, block_config, default_export_format)
    VALUES (NULL, ${name}, ${JSON.stringify(config)}::jsonb, ${format})
    ON CONFLICT (name) WHERE project_id IS NULL DO NOTHING
  `;
}

// ─── 4. reports columns ─────────────────────────────────────────────────────

await sql`
  ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'investor'
`;

await sql`
  ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS grant_id UUID
      REFERENCES grant_awards(id) ON DELETE SET NULL
`;

await sql`
  ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS preset_id UUID
      REFERENCES presets(id) ON DELETE SET NULL
`;

await sql`
  ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS blocks JSONB
`;

// ─── 5. read-only census ────────────────────────────────────────────────────
//
// On a first run: 3 system presets, every report reads report_type =
// 'investor' (the DEFAULT backfilling every pre-existing row), and
// grant_id/preset_id/blocks are NULL everywhere. On a re-run the numbers are
// unchanged, which is the cheapest proof of idempotence.

const [presetCounts] = await sql`
  SELECT count(*)::int                                   AS total,
         count(*) FILTER (WHERE project_id IS NULL)::int AS system,
         count(*) FILTER (WHERE project_id IS NOT NULL)::int AS project_owned
    FROM presets
`;

const [reportCounts] = await sql`
  SELECT count(*)::int                                      AS total,
         count(*) FILTER (WHERE report_type = 'investor')::int AS investor,
         count(*) FILTER (WHERE report_type = 'grant')::int    AS grant,
         count(grant_id)::int                                 AS with_grant,
         count(preset_id)::int                                AS with_preset,
         count(blocks)::int                                   AS with_blocks
    FROM reports
`;

console.log(
  `✓ report presets ready.\n` +
    `  presets: ${presetCounts.total} row(s) — ${presetCounts.system} system, ` +
    `${presetCounts.project_owned} project-owned.\n` +
    `  reports: ${reportCounts.total} row(s) — ${reportCounts.investor} investor, ` +
    `${reportCounts.grant} grant (${reportCounts.with_grant} with a grant_id, ` +
    `${reportCounts.with_preset} with a preset_id, ${reportCounts.with_blocks} with frozen blocks).\n` +
    `  Nothing was backfilled on reports beyond report_type's DEFAULT; grant_id, preset_id and blocks have no DEFAULT, by design — see this file's header.`
);
