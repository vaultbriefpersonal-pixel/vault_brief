// Live end-to-end smoke: regenerate a report through generateReport()
// against the mock-seeded ENS-shaped project. Phase 6 extension:
// seeds grants + governance + an open ask for the snapshot's period,
// enables those sections in the project's reportSections config, then
// regenerates and asserts the new manual-data sections render.
//
// Idempotent — re-uses existing seed mock data and cleans up its own
// fixtures before and after the run.
//
// Run:    npx tsx --env-file=.env.local scripts/smoke-real-llm.mjs
// Costs:  one OpenRouter call (~$0.001 with gemini-2.5-flash).

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const [project] = await sql`
  SELECT id, report_sections FROM projects WHERE slug LIKE 'mock-ens%' LIMIT 1
`;
if (!project) {
  console.error("No mock-ens* project found; run seed-mock.mjs first.");
  process.exit(1);
}

const [snapshot] = await sql`
  SELECT id, snapshot_date FROM treasury_snapshots
  WHERE project_id = ${project.id}
  ORDER BY snapshot_date DESC LIMIT 1
`;
if (!snapshot) {
  console.error("No snapshot found for ENS project");
  process.exit(1);
}

// IMPORTANT: derive period the SAME way the prompt builder does, otherwise
// seeded data won't match the snapshot's reported period.
//
// Drizzle returns the `date` column as a 'YYYY-MM-DD' string. The neon raw
// driver (used in this script) returns a Date object that may be shifted
// by local-timezone offset, so toISOString().slice(0,7) drifts a day on
// timezones west of UTC. We re-fetch through Drizzle below to get the
// canonical string representation, then slice the same way as the
// generator does (String(snapshot.snapshotDate).slice(0, 7)).
const { db: _periodDb } = await import("../src/server/db/index.ts");
const _periodSnap = await _periodDb.query.treasurySnapshots.findFirst({
  where: (s, { eq }) => eq(s.id, snapshot.id),
});
const period = String(_periodSnap.snapshotDate).slice(0, 7);

// ─── seed Phase 6 manual data with a 'smoke-' marker so we can clean up ────

await sql`DELETE FROM grants WHERE project_id = ${project.id} AND notes = 'smoke-fixture'`;
await sql`DELETE FROM governance_proposals WHERE project_id = ${project.id} AND notes = 'smoke-fixture'`;
await sql`DELETE FROM asks WHERE project_id = ${project.id} AND request LIKE 'SMOKE:%'`;

await sql`
  INSERT INTO grants (project_id, recipient, amount_usd, status, period, notes)
  VALUES (${project.id}, 'Acme Research', 50000, 'committed', ${period}, 'smoke-fixture')
`;
await sql`
  INSERT INTO grants (project_id, recipient, amount_usd, status, period, notes)
  VALUES (${project.id}, 'Beta Tooling', 25000, 'disbursed', ${period}, 'smoke-fixture')
`;
await sql`
  INSERT INTO governance_proposals (project_id, title, status, vote_result, period, notes)
  VALUES (
    ${project.id},
    'EP-12: Treasury rebalance to 60/40 stables',
    'passed',
    '78% / 22% with 14M tokens',
    ${period},
    'smoke-fixture'
  )
`;
await sql`
  INSERT INTO asks (project_id, request, category, status)
  VALUES (${project.id}, 'SMOKE: Intro to L2 BD lead at any major DEX', 'intros', 'open')
`;

// Enable the new sections in the project's stored reportSections config.
// We grab the default-on set + add the 5 manual sections so the order
// stays predictable. Stored as JSONB.
const enabledSections = [
  "executive_summary",
  "wins",
  "lows_concerns",
  "treasury_overview",
  "treasury_by_chain",
  "previous_month_comparison",
  "financial_health",
  "expense_breakdown",
  "treasury_operations",
  "grants_distributed",
  "token_metrics",
  "governance_updates",
  "development_progress",
  "milestones_completed",
  "anomalies",
  "looking_ahead",
  "asks",
];
const config = enabledSections.map((id) => ({ id, enabled: true }));
await sql`
  UPDATE projects SET report_sections = ${JSON.stringify(config)}::jsonb
  WHERE id = ${project.id}
`;

// ─── generate ──────────────────────────────────────────────────────────────

const { generateReport } = await import(
  "../src/server/services/report-generator.ts"
);

console.log(
  `Generating report for project=${project.id} snapshot=${snapshot.id} period=${period}...`
);
const t0 = Date.now();
const md = await generateReport(project.id, snapshot.id);
const ms = Date.now() - t0;
console.log(`Generated in ${ms}ms, ${md.length} chars\n`);
console.log(md);
console.log("\n---\n");

let passed = 0,
  failed = 0;
function check(name, cond) {
  if (cond) {
    console.log(`✓ ${name}`);
    passed++;
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

check("markdown non-empty", md.length > 200);
check("contains Executive Summary heading", /executive summary/i.test(md));
check("contains a treasury figure", /\$[\d.]+[KMB]/.test(md));
check("contains Wins section", /###\s*wins/i.test(md));
check("contains Treasury Overview", /treasury overview/i.test(md));

// Phase 6 — manual sections
check("contains Grants section heading", /grants distributed/i.test(md));
check("references Acme Research grant", /acme research/i.test(md));
check("references Beta Tooling grant", /beta tooling/i.test(md));
check("contains Governance Updates section", /governance updates/i.test(md));
check("references EP-12 proposal", /ep-?12/i.test(md));
check("contains Asks section", /###\s*asks/i.test(md));
check("references the seeded ask", /intro to l2 bd lead/i.test(md));

// Restore the project's reportSections to whatever it was (or null) and
// clean up smoke fixtures so the test is idempotent.
const original = project.report_sections;
await sql`
  UPDATE projects SET report_sections = ${original ? JSON.stringify(original) : null}::jsonb
  WHERE id = ${project.id}
`;
await sql`DELETE FROM grants WHERE project_id = ${project.id} AND notes = 'smoke-fixture'`;
await sql`DELETE FROM governance_proposals WHERE project_id = ${project.id} AND notes = 'smoke-fixture'`;
await sql`DELETE FROM asks WHERE project_id = ${project.id} AND request LIKE 'SMOKE:%'`;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
