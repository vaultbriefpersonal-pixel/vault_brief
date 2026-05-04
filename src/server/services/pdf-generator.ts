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
import { reports, projects, treasurySnapshots } from "@/server/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";
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

  // Pull the snapshot tied to this report (for charts) + 5 trailing
  // snapshots so the trend bar / sparkline have data to draw. Both fail
  // gracefully — the chart components return null on insufficient data,
  // so the PDF still renders if these queries come back empty.
  const snapshot = report.snapshotId
    ? await db.query.treasurySnapshots.findFirst({
        where: eq(treasurySnapshots.id, report.snapshotId),
      })
    : null;
  const trailing = snapshot
    ? await db.query.treasurySnapshots.findMany({
        where: and(
          eq(treasurySnapshots.projectId, report.projectId),
          lt(treasurySnapshots.snapshotDate, snapshot.snapshotDate)
        ),
        orderBy: [desc(treasurySnapshots.snapshotDate)],
        limit: 5,
      })
    : [];
  // Oldest → newest for chart x-axis.
  const trendSnapshots = [...trailing, snapshot].filter((s): s is NonNullable<typeof s> => Boolean(s)).reverse();

  const content = parseMarkdown(report.contentMd);
  const period = formatDate(report.periodEnd);

  const element = React.createElement(VaultBriefPDF, {
    projectName: project.name,
    logoUrl: branding?.logoUrl ?? project.logoUrl,
    website: project.website ?? null,
    period,
    content,
    primaryColor: branding?.primaryColor,
    snapshot,
    trendSnapshots,
  });

  const renderToBuffer = await getRenderToBuffer();
  const buffer = await renderToBuffer(
    element as React.ReactElement<DocumentProps>
  );
  const filename = `${project.name.replace(/\s+/g, "-").toLowerCase()}-report-${report.periodEnd}.pdf`;

  return { buffer: Buffer.from(buffer), filename };
}
