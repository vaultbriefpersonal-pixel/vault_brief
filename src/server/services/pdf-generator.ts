import React from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { VaultBriefPDF } from "./pdf-template";

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
import { formatDate, slugify } from "@/lib/utils";
import { registerReportFonts } from "./pdf-fonts";
import {
  composeTreasury,
  compositionSlices as buildCompositionSlices,
} from "./treasury-composition";

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

  const period = formatDate(report.periodEnd);

  // Donut slices are DERIVED HERE, at read time, from the snapshot's per-token
  // `balances_detail` — not read off the four frozen snapshot columns the
  // template used to reach into.
  //
  // Those columns are computed once at sync time against whatever the project
  // had entered then. On the fixture treasury `projects.token_symbol` was NULL
  // at sync, so `native_token_usd` froze at $0.00 and a $1.06B own-token
  // position landed in `other_assets_usd` — the donut read "Stables 0.0% /
  // ETH-WETH 0.0% / Other 100.0%" while the prose beside it, which always read
  // the derived classifier, had the split right. Deriving here means a plain
  // regenerate fixes every snapshot already in the database, with no re-sync.
  //
  // `project` and `snapshot` are both already in scope, so this costs one pure
  // function call and keeps the template a renderer with no data policy in it.
  const compositionSlices = snapshot
    ? buildCompositionSlices(
        composeTreasury(snapshot.balancesDetail, project),
        project
      )
    : [];

  const element = React.createElement(VaultBriefPDF, {
    projectName: project.name,
    logoUrl: branding?.logoUrl ?? project.logoUrl,
    website: project.website ?? null,
    period,
    contentMd: report.contentMd,
    kind: report.reportType === "grant" ? "grant" : "investor",
    primaryColor: branding?.primaryColor,
    snapshot,
    trendSnapshots,
    compositionSlices,
  });

  // Must precede the render, and must happen on EVERY path into this
  // function. Both callers matter and they run in different runtimes: the
  // Vercel Lambda (the PDF route and the two tRPC procedures) and the
  // Trigger.dev worker (auto-generate-reports.ts, in the `dirs` that
  // trigger.config.ts registers). Registering here rather than at module
  // scope keeps it inside the async boundary that pdf-fonts.ts needs for its
  // dynamic import of @react-pdf/renderer. Idempotent per process.
  await registerReportFonts();

  const renderToBuffer = await getRenderToBuffer();
  const buffer = await renderToBuffer(
    element as React.ReactElement<DocumentProps>
  );
  // `slugify`, not an ad-hoc whitespace replace — the old version left
  // punctuation from a project name in a public Blob URL.
  //
  // NOTE: this CHANGES the storage path for any project whose name contains
  // characters the two treat differently (pdf-storage.ts:20 builds
  // `reports/${reportId}/${filename}`). The previous blob is orphaned, not
  // lost, and `reports.pdf_url` keeps serving it until that report is
  // regenerated — so a handful of already-sent reports will still hand out
  // the old-looking PDF. Accepted deliberately: clearing `pdf_url` en masse
  // is a production write, which is a human's call, not this function's.
  const filename = `${slugify(project.name)}-report-${report.periodEnd}.pdf`;

  return { buffer: Buffer.from(buffer), filename };
}
