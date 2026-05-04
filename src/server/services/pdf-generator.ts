import React from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { VaultBriefPDF, parseMarkdown } from "./pdf-template";

// @react-pdf/renderer is ESM-only and listed in Next.js 16's default
// serverExternalPackages, so a top-level `require()` returns an empty module
// at runtime and renderToBuffer crashes inside its internals. Dynamic import
// resolves the real module both in Turbopack dev and in the prod build.
async function getRenderToBuffer() {
  const mod = await import("@react-pdf/renderer");
  return mod.renderToBuffer;
}
import { db } from "@/server/db";
import { reports, projects } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { formatDate } from "@/lib/utils";

export async function generatePDF(
  reportId: string
): Promise<{ buffer: Buffer; filename: string }> {
  const report = await db.query.reports.findFirst({
    where: eq(reports.id, reportId),
    with: { project: true },
  });

  if (!report || !report.contentMd) {
    throw new Error("Report not found or has no content");
  }

  const project = report.project as typeof projects.$inferSelect;
  const branding = project.customBranding as {
    primaryColor?: string;
    logoUrl?: string;
  } | null;

  const content = parseMarkdown(report.contentMd);
  const period = formatDate(report.periodEnd);

  const element = React.createElement(VaultBriefPDF, {
    projectName: project.name,
    logoUrl: branding?.logoUrl ?? project.logoUrl,
    website: project.website ?? null,
    period,
    content,
    primaryColor: branding?.primaryColor,
  });

  const renderToBuffer = await getRenderToBuffer();
  const buffer = await renderToBuffer(
    element as React.ReactElement<DocumentProps>
  );
  const filename = `${project.name.replace(/\s+/g, "-").toLowerCase()}-report-${report.periodEnd}.pdf`;

  return { buffer: Buffer.from(buffer), filename };
}
