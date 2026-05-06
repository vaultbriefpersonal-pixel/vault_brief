// Live test against the Snapshot.org public GraphQL API.
// Pulls April 2026 proposals for ens.eth (the canonical demo space)
// and prints what would be imported. No DB writes.
//
// Run: npx tsx scripts/smoke-snapshot-import.mjs

const { fetchSnapshotProposals, mapProposalToRow } = await import(
  "../src/server/services/snapshot-import.ts"
);

const space = process.argv[2] ?? "ens.eth";
const period = process.argv[3] ?? "2025-04";

console.log(`Fetching Snapshot proposals: space=${space} period=${period}`);
const t0 = Date.now();
const proposals = await fetchSnapshotProposals(space, period);
console.log(`Fetched ${proposals.length} proposals in ${Date.now() - t0}ms\n`);

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    console.log(`✓ ${name}`);
    passed++;
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

check("returns an array", Array.isArray(proposals));
if (proposals.length > 0) {
  const sample = proposals[0];
  check("each proposal has title", Boolean(sample.title));
  check("each proposal has state", ["pending", "active", "closed"].includes(sample.state));
  check("each proposal has scores array", Array.isArray(sample.scores));

  console.log("\nFirst 3 mapped rows:");
  proposals.slice(0, 3).forEach((p, i) => {
    const row = mapProposalToRow(p);
    console.log(`  ${i + 1}. [${row.status}] ${row.title}`);
    if (row.voteResult) console.log(`     ${row.voteResult}`);
    if (row.url) console.log(`     ${row.url}`);
  });

  const mapped = proposals.map(mapProposalToRow);
  check(
    "all closed proposals map to passed/rejected/active/submitted",
    mapped.every((m) =>
      ["passed", "rejected", "active", "submitted"].includes(m.status)
    )
  );
} else {
  console.log("(no proposals in that period — try a different space/period)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
