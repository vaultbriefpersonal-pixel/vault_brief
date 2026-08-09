// Clears `reports.pdf_url` for reports whose stored PDF predates the Stage 18
// document redesign, so the next request re-renders one in the new design.
//
// SUPERSEDED AS THE REMEDY, KEPT AS A DIAGNOSTIC. `src/lib/report-pdf-version.ts`
// now stamps the template version into the blob path and the PDF route
// re-renders anything that does not carry the current one, so a template
// change no longer needs this script — bump the version instead and every
// stored PDF goes stale on its own. What this still does that the route
// cannot: report what is actually EMBEDDED in each stored blob. The route
// trusts the path; this opens the bytes. Reach for it to audit, or to recover
// if a blob and its path ever disagree.
//
// WHY THIS IS NEEDED. `GET /api/reports/[reportId]/pdf` has a fast path:
//
//     if (report.pdfUrl) return Response.redirect(report.pdfUrl, 302);
//
// It never checks whether the stored blob was rendered by the CURRENT
// template. Stage 18 replaced base-14 Helvetica with embedded Spectral + IBM
// Plex Mono and rebuilt the layout, but every report that already had a blob
// keeps serving its pre-redesign PDF forever — which reads as "the redesign
// didn't ship" on exactly the surface the redesign was commissioned to fix.
//
// Verified on production before writing this: the Index Coop blob embeds
// `Helvetica` and `Helvetica-Bold` and no Spectral, while a report with no
// stored blob re-rendered on the same deploy and came back with
// `Spectral-Regular`, `Spectral-SemiBold` and `IBMPlexMono-Regular`. Same
// code, same runtime — the only difference is which path the route took.
//
// WHAT THIS DOES NOT DO. It does not delete blobs. A sent report's email links
// the blob URL directly, and those links must keep working; orphaning the
// object is the point, not removing it. It only drops the pointer so the
// product renders fresh on next request.
//
// The census PROBES each stored PDF rather than assuming. A row whose blob
// already carries the document fonts is left alone, which makes this safe to
// re-run and safe to run again after a future redesign.
//
// RUN BY A HUMAN, per docs/MIGRATIONS.md. Two phases, and the first is
// read-only:
//
//   node --env-file=.env.local scripts/migrations/clear-stale-report-pdfs.mjs
//   node --env-file=.env.local scripts/migrations/clear-stale-report-pdfs.mjs --apply
//
// Without `--apply` it only prints a census.

import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

/**
 * A PDF built by the current template embeds the report faces as subsets, so
 * the font name appears as `/BaseFont /ABCDEF+Spectral-Regular`. Matching the
 * family name anywhere in the file is enough to tell the two eras apart, and
 * is far cheaper than parsing the object graph.
 */
const DOCUMENT_FACES = ["Spectral", "IBMPlexMono"];

async function inspectPdf(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return { ok: false, why: "not a PDF" };
    }
    const text = bytes.toString("latin1");
    const fonts = [
      ...new Set(
        (text.match(/\/BaseFont\s*\/[A-Za-z0-9+,\-]+/g) ?? []).map((m) =>
          m.split("/").pop()
        )
      ),
    ];
    return {
      ok: true,
      bytes: bytes.length,
      fonts,
      current: DOCUMENT_FACES.some((f) => text.includes(f)),
    };
  } catch (err) {
    return { ok: false, why: err.message };
  }
}

// `to_char` rather than letting the driver hand back a Date: the Neon driver
// returns a `date` column as a JS Date at LOCAL midnight, which shifts a day
// east of Greenwich. Formatting SQL-side is this repo's standing rule.
const rows = await sql`
  SELECT r.id,
         p.name                              AS project,
         r.status,
         to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
         to_char(r.sent_at, 'YYYY-MM-DD')    AS sent_on,
         r.pdf_url
  FROM reports r
  JOIN projects p ON p.id = r.project_id
  WHERE r.pdf_url IS NOT NULL
  ORDER BY p.name, r.period_end DESC
`;

console.log(`\n${rows.length} report(s) have a stored PDF. Probing each…\n`);

const stale = [];
const current = [];
const unreadable = [];

for (const r of rows) {
  const info = await inspectPdf(r.pdf_url);
  const label = `  ${r.id}  ${r.project}  ${r.period_end}  status=${r.status}${
    r.sent_on ? "  SENT" : ""
  }`;

  if (!info.ok) {
    unreadable.push({ ...r, why: info.why });
    console.log(`${label}\n    UNREADABLE: ${info.why}`);
    continue;
  }
  console.log(`${label}\n    fonts: ${info.fonts.join(", ") || "(none)"}`);
  if (info.current) current.push(r);
  else stale.push(r);
}

console.log(`\n── ${stale.length} stale (pre-redesign) ──`);
for (const r of stale) console.log(`  ${r.id}  ${r.project}  ${r.period_end}`);

console.log(`\n── ${current.length} already on the current design ──`);
for (const r of current) console.log(`  ${r.id}  ${r.project}  ${r.period_end}`);

if (unreadable.length > 0) {
  // Left alone deliberately. Clearing a pointer we could not read would throw
  // away a working download on the strength of a failed network call.
  console.log(`\n── ${unreadable.length} SKIPPED: could not be read ──`);
  for (const r of unreadable) console.log(`  ${r.id}  ${r.project}  ${r.why}`);
}

const sentAndStale = stale.filter((r) => r.sent_on);
if (sentAndStale.length > 0) {
  console.log(
    `\n!! ${sentAndStale.length} stale row(s) have ALREADY BEEN SENT.`
  );
  console.log(
    "   The blob stays where it is, so the link in the email they received"
  );
  console.log(
    "   keeps resolving to the PDF they were sent. Clearing the pointer only"
  );
  console.log("   changes what the APP serves from now on.");
}

if (!APPLY) {
  console.log(
    `\nRead-only census. Re-run with --apply to clear the ${stale.length} pointer(s) above.`
  );
  process.exit(0);
}

if (stale.length === 0) {
  console.log("\nNothing to apply.");
  process.exit(0);
}

let applied = 0;
for (const r of stale) {
  // Self-guarding: re-check the row still holds the URL the census probed, so
  // a regenerate between census and apply is left alone rather than clobbered.
  const res = await sql`
    UPDATE reports
    SET pdf_url    = NULL,
        updated_at = now()
    WHERE id = ${r.id}
      AND pdf_url IS NOT DISTINCT FROM ${r.pdf_url}
    RETURNING id
  `;
  if (res.length > 0) applied++;
  else console.log(`  skipped ${r.id} — changed underneath us since the census`);
}

console.log(`\nCleared ${applied} of ${stale.length} pointer(s).`);
console.log(
  "Each will re-render on its next PDF request. Re-run the census afterwards"
);
console.log("to confirm the replacements carry the document fonts.");
