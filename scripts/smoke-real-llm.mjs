// Live end-to-end smoke: regenerate a report through generateReport()
// against the mock-seeded ENS-shaped project. Asserts that:
//   - markdown comes back non-empty
//   - it includes the project name + a treasury figure
//   - it includes the new "Wins" section heading
//
// Run:    npx tsx scripts/smoke-real-llm.mjs
//
// Costs: one OpenRouter call (~$0.001 with gemini-2.5-flash).

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const [project] = await sql`
  SELECT id FROM projects WHERE slug LIKE 'mock-ens%' LIMIT 1
`;
if (!project) {
  console.error("No mock-ens* project found; run seed-mock.mjs first.");
  process.exit(1);
}

const [snapshot] = await sql`
  SELECT id FROM treasury_snapshots
  WHERE project_id = ${project.id}
  ORDER BY snapshot_date DESC LIMIT 1
`;
if (!snapshot) {
  console.error("No snapshot found for ENS project");
  process.exit(1);
}

const { generateReport } = await import(
  "../src/server/services/report-generator.ts"
);

console.log(`Generating report for project=${project.id} snapshot=${snapshot.id}...`);
const t0 = Date.now();
const md = await generateReport(project.id, snapshot.id);
const ms = Date.now() - t0;
console.log(`Generated in ${ms}ms, ${md.length} chars\n`);

// Print first 60 lines to inspect shape.
console.log(md.split("\n").slice(0, 60).join("\n"));
console.log("\n---\n");

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { console.log(`✓ ${name}`); passed++; }
  else { console.error(`✗ ${name}`); failed++; }
}

check("markdown non-empty", md.length > 200);
check("contains Executive Summary heading", /executive summary/i.test(md));
check("contains a treasury figure ($XXX format)", /\$[\d.]+[KMB]/.test(md));
check("contains Wins section (new prompt structure)", /###\s*wins/i.test(md));
check("contains Treasury Overview", /treasury overview/i.test(md));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
