import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { reports } from "@/server/db/schema";
import { reportPdfBlobPath } from "@/lib/report-pdf-version";
import { generatePDF } from "./pdf-generator";

/**
 * Render the report's PDF and persist it to Vercel Blob, then write the URL
 * back onto reports.pdfUrl. Idempotent: re-running for the same reportId
 * overwrites the same blob path.
 *
 * Best-effort by design — callers (cron jobs) should swallow failures and let
 * the on-demand /api/reports/[id]/pdf route handle late renders.
 */
export async function renderAndStorePDF(reportId: string): Promise<string> {
  const { buffer, filename } = await generatePDF(reportId);

  // Public access: blob URLs are unguessable, but pair this with TRPC ownership
  // checks before exposing the URL anywhere user-facing.
  // The path carries the template version, which is what lets the PDF route
  // recognise a blob rendered by an older template and re-render instead of
  // serving it. See report-pdf-version.ts.
  const blob = await put(reportPdfBlobPath(reportId, filename), buffer, {
    access: "public",
    contentType: "application/pdf",
    addRandomSuffix: false,
    allowOverwrite: true,
    // filename is fully deterministic (project name + periodEnd, no content
    // hash), so the blob path — and its public URL — never changes across
    // regenerations. @vercel/blob's put() defaults cacheControlMaxAge to one
    // month, so without an explicit override, browsers and the Blob CDN keep
    // serving pre-regeneration bytes at this same URL for up to a month after
    // the content actually changed. 60 is the lowest value Vercel allows
    // ("Cannot be set to a value lower than 1 minute") — this isn't an
    // arbitrary magic number, it's the enforced floor.
    cacheControlMaxAge: 60,
  });

  await db
    .update(reports)
    .set({ pdfUrl: blob.url, updatedAt: new Date() })
    .where(eq(reports.id, reportId));

  return blob.url;
}
