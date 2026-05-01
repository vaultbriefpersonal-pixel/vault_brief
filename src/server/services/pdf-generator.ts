// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToBuffer } = require("@react-pdf/renderer");
import React from "react";
import { VaultBriefPDF, parseMarkdown } from "./pdf-template";
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
    period,
    content,
    primaryColor: branding?.primaryColor,
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const buffer = await renderToBuffer(element as React.ReactElement);
  const filename = `${project.name.replace(/\s+/g, "-").toLowerCase()}-report-${report.periodEnd}.pdf`;

  return { buffer: Buffer.from(buffer), filename };
}
