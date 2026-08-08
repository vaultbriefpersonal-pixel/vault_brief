import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { reports, projects } from "@/server/db/schema";
import {
  buildReportHtml,
  htmlExportFilename,
} from "@/server/services/report-html-export";
import { brandingFor } from "@/lib/report-branding";
import { describeReport } from "@/lib/report-label";
import { slugify } from "@/lib/utils";

interface Context {
  params: Promise<{ reportId: string }>;
}

/**
 * Download a report as one self-contained HTML file.
 *
 * Auth mirrors the sibling PDF route exactly: session required, ownership
 * checked through the joined project, 404 (not 403) on someone else's report
 * so the endpoint doesn't confirm that an id exists.
 *
 * Unlike the PDF route there is no blob-storage path. The file is built from
 * data already in hand plus bundled fonts — no LLM call, no render engine, no
 * network — so streaming it is cheaper than storing and redirecting.
 */
export async function GET(_req: NextRequest, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { reportId } = await params;

  const report = await db.query.reports.findFirst({
    where: eq(reports.id, reportId),
    with: { project: true },
  });
  if (!report) return new Response("Not found", { status: 404 });

  const project = report.project as typeof projects.$inferSelect;
  if (project.userId !== session.user.id) {
    return new Response("Not found", { status: 404 });
  }
  if (!report.contentMd) {
    return new Response("Report has no content", { status: 409 });
  }

  const { kind, period } = describeReport(report);
  const html = await buildReportHtml({
    projectName: project.name,
    kind,
    period,
    contentMd: report.contentMd,
    website: project.website ?? null,
    accent: brandingFor(project).primaryColor,
  });

  const filename = htmlExportFilename(slugify(project.name), report.periodEnd);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // The document embeds ~1.2MB of font data and states real treasury
      // figures. Neither belongs in a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
