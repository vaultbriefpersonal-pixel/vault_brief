import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { reports } from "@/server/db/schema";
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
  const blob = await put(`reports/${reportId}/${filename}`, buffer, {
    access: "public",
    contentType: "application/pdf",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  await db
    .update(reports)
    .set({ pdfUrl: blob.url, updatedAt: new Date() })
    .where(eq(reports.id, reportId));

  return blob.url;
}
