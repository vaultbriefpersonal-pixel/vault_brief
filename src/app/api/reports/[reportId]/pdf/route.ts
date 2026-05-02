import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { reports, projects } from "@/server/db/schema";
import { generatePDF } from "@/server/services/pdf-generator";
import { renderAndStorePDF } from "@/server/services/pdf-storage";

interface Context {
  params: Promise<{ reportId: string }>;
}

export async function GET(_req: NextRequest, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { reportId } = await params;

  // Ownership check via the joined project — same pattern as the TRPC guards.
  const report = await db.query.reports.findFirst({
    where: eq(reports.id, reportId),
    with: { project: true },
  });
  if (!report) return new Response("Not found", { status: 404 });
  const project = report.project as typeof projects.$inferSelect;
  if (project.userId !== session.user.id) {
    return new Response("Not found", { status: 404 });
  }

  // Fast path: pre-rendered blob URL exists. 302 the browser straight to it.
  if (report.pdfUrl) {
    return Response.redirect(report.pdfUrl, 302);
  }

  // Slow path: try to render + store, then redirect. Falls back to inline
  // streaming if blob storage is unavailable (no token, etc.).
  try {
    const url = await renderAndStorePDF(reportId);
    return Response.redirect(url, 302);
  } catch (storeErr) {
    console.warn("pdf route: blob render failed, streaming inline:", storeErr);
    try {
      const { buffer, filename } = await generatePDF(reportId);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": buffer.length.toString(),
        },
      });
    } catch {
      return new Response("Failed to generate PDF", { status: 500 });
    }
  }
}
