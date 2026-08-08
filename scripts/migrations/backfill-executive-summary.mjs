// Re-derives `reports.executive_summary` from each report's current
// `content_md`.
//
// WHY THIS IS NEEDED. `executive_summary` is a DERIVED column — the report's
// own Executive Summary section, lifted out of the markdown. Until Stage 19.1
// it was computed in exactly one place, the INSERT in `createReportRecord`,
// and never again. `reports.regenerate` and the editor's save both overwrote
// `content_md` and left it behind, so the stored copy described a document
// that no longer existed.
//
// That column is not decorative:
//   - the reports LIST renders it (a preview quoting $162.8K beside a report
//     reading $792.3K is how this was found), and
//   - `sendReportEmail` / `sendReportReadyForReviewEmail` use it as the EMAIL
//     BODY, so a regenerated-then-sent report mailed investors the
//     pre-regeneration figures.
//
// The code fix stops it recurring. This repairs rows already affected.
//
// RUN BY A HUMAN, per docs/MIGRATIONS.md. Two phases, and the first is
// read-only:
//
//   node --env-file=.env.local scripts/migrations/backfill-executive-summary.mjs
//   node --env-file=.env.local scripts/migrations/backfill-executive-summary.mjs --apply
//
// Without `--apply` it only prints a census. Read it before applying — this
// rewrites text that has been emailed to investors, and you should see for
// yourself which rows change and how.

import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

/**
 * Must stay behaviourally identical to `deriveExecutiveSummary` in
 * src/lib/report-markdown.ts. Duplicated rather than imported because this is
 * a plain .mjs script run outside the Next/tsx toolchain — the same reason
 * every other script in this directory is self-contained. If the TS version
 * changes, change this with it.
 */
function deriveExecutiveSummary(markdown) {
  if (!markdown) return null;
  const re = new RegExp(
    `#{2,4}\\s*Executive Summary[^\\n]*\\n+([\\s\\S]+?)(?=\\n#{2,4}\\s|$)`,
    "i"
  );
  const m = markdown.match(re);
  return m ? m[1].trim() : null;
}

const rows = await sql`
  SELECT r.id,
         p.name          AS project,
         r.status,
         r.period_end,
         r.sent_at,
         r.executive_summary,
         r.content_md
  FROM reports r
  JOIN projects p ON p.id = r.project_id
  ORDER BY r.period_end DESC
`;

const preview = (s) =>
  s === null || s === undefined
    ? "(null)"
    : `${s.replace(/\s+/g, " ").slice(0, 100)}${s.length > 100 ? "…" : ""}`;

const changed = [];
const unchanged = [];
const wouldNull = [];

for (const r of rows) {
  const derived = deriveExecutiveSummary(r.content_md);
  if (derived === r.executive_summary) {
    unchanged.push(r);
  } else if (derived === null) {
    // Do NOT overwrite a stored summary with null. A report whose markdown has
    // no recognisable Executive Summary heading would otherwise LOSE the text
    // it currently shows and emails — strictly worse than a stale one.
    wouldNull.push(r);
  } else {
    changed.push({ ...r, derived });
  }
}

console.log(`\n${rows.length} report(s) examined.\n`);

console.log(`── ${changed.length} row(s) would change ──`);
for (const r of changed) {
  console.log(`\n  ${r.id}  ${r.project}  ${r.period_end}  status=${r.status}${r.sent_at ? "  ALREADY SENT" : ""}`);
  console.log(`    stored : ${preview(r.executive_summary)}`);
  console.log(`    derived: ${preview(r.derived)}`);
}

console.log(`\n── ${unchanged.length} row(s) already correct ──`);
for (const r of unchanged) {
  console.log(`  ${r.id}  ${r.project}  ${r.period_end}`);
}

if (wouldNull.length > 0) {
  console.log(
    `\n── ${wouldNull.length} row(s) SKIPPED: no Executive Summary heading in content_md ──`
  );
  console.log("  (left as-is on purpose — nulling them would lose text the product currently shows)");
  for (const r of wouldNull) {
    console.log(`  ${r.id}  ${r.project}  ${r.period_end}  stored: ${preview(r.executive_summary)}`);
  }
}

const sentAndChanging = changed.filter((r) => r.sent_at);
if (sentAndChanging.length > 0) {
  console.log(
    `\n!! ${sentAndChanging.length} of the changing row(s) have ALREADY BEEN SENT.`
  );
  console.log(
    "   Their emails went out with the stored text above. Updating the column"
  );
  console.log(
    "   corrects the app and any future resend; it cannot recall what was sent."
  );
}

if (!APPLY) {
  console.log(
    `\nRead-only census. Re-run with --apply to update the ${changed.length} row(s) above.`
  );
  process.exit(0);
}

if (changed.length === 0) {
  console.log("\nNothing to apply.");
  process.exit(0);
}

let applied = 0;
for (const r of changed) {
  // Idempotent and self-guarding: the WHERE clause re-checks that the row
  // still holds the value the census read, so a concurrent regenerate between
  // census and apply is left alone rather than clobbered.
  const res = await sql`
    UPDATE reports
    SET executive_summary = ${r.derived},
        updated_at        = now()
    WHERE id = ${r.id}
      AND executive_summary IS NOT DISTINCT FROM ${r.executive_summary}
    RETURNING id
  `;
  if (res.length > 0) applied++;
  else console.log(`  skipped ${r.id} — changed underneath us since the census`);
}

console.log(`\nApplied to ${applied} of ${changed.length} row(s).`);

const remaining = await sql`
  SELECT count(*)::int AS n
  FROM reports
  WHERE content_md IS NOT NULL
    AND executive_summary IS NULL
`;
console.log(`Post-check: ${remaining[0].n} report(s) still have a NULL summary.`);
