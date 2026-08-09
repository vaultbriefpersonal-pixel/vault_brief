/**
 * Stamps the PDF template version into the stored blob's PATH, so the product
 * can tell a pre-redesign PDF from a current one.
 *
 * WHY A PATH SEGMENT AND NOT A COLUMN. `GET /api/reports/[id]/pdf` short-
 * circuits on `report.pdfUrl` whenever it is set. Before this, it had no way
 * to ask which template produced that blob — so after Stage 18 shipped, 6 of 7
 * reports went on serving base-14 Helvetica PDFs, on exactly the surface the
 * redesign existed to fix. It took a hand-run script to clear them.
 *
 * A `pdf_template_version` column would work until the moment the blob write
 * succeeds and the column write does not, at which point the column claims a
 * version the bytes do not have and nothing can detect it. Putting the version
 * in the path removes that failure mode by construction: the URL is the blob's
 * address, so it cannot describe a different object than the one it resolves
 * to. Same reasoning that kept `is_system` off `presets` and
 * `is_grant_deliverable` off `milestones` — the thing that carries the fact
 * cannot disagree with itself.
 *
 * WHEN TO BUMP. Any change that alters how a rendered report LOOKS: the
 * template, the fonts, the palette, the chart rendering. Not for a change to
 * report CONTENT — `contentMd` edits already null `pdf_url` at the two write
 * paths in `reports.ts`. Bumping is the entire remediation: every stored PDF
 * becomes stale and re-renders lazily on next request, with no script and no
 * production write.
 *
 * Pure and dependency-free on purpose — the route needs it, `pdf-storage.ts`
 * needs it, and its tests should need neither the blob SDK nor react-pdf.
 */

/**
 * v1 is the UNVERSIONED legacy scheme (`reports/<id>/<file>.pdf`) — every blob
 * written before this module existed, which is why v1 never appears in a path.
 * v2 is the first stamped one: the Stage 18 document template, embedded
 * Spectral + IBM Plex Mono.
 */
export const REPORT_PDF_TEMPLATE_VERSION = "v2";

/** Where a freshly rendered PDF for this report goes. */
export function reportPdfBlobPath(reportId: string, filename: string): string {
  return `reports/${reportId}/${REPORT_PDF_TEMPLATE_VERSION}/${filename}`;
}

/**
 * True only when `url` points at a blob written by the CURRENT template.
 *
 * Anything unparseable, unexpected, or from an older scheme is reported stale.
 * That direction is deliberate: a false stale costs one re-render, a false
 * current serves a wrong-looking document to an investor.
 */
export function isCurrentTemplateBlob(url: string | null | undefined): boolean {
  if (!url) return false;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }

  // Require the full expected shape rather than merely finding the version
  // somewhere in the string: `reports / <reportId> / <version> / <filename>`.
  // A looser "does the path contain /v2/" check would also accept a malformed
  // `reports/v2/file.pdf`, and a looser `url.includes()` would match a project
  // whose slug happened to contain the token.
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 4) return false;
  const [root, , version] = segments;

  return root === "reports" && version === REPORT_PDF_TEMPLATE_VERSION;
}
