import React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq, desc } from "drizzle-orm";
import { db } from "@/server/db";
import { reports, projects, treasurySnapshots, milestones } from "@/server/db/schema";
import { ReportPreview } from "@/components/report/ReportPreview";
import { ReportWidgets } from "@/components/report/ReportWidgets";
import { DOC_CHART_PALETTE } from "@/components/charts/chart-palette";
import { formatDate } from "@/lib/utils";
import { getSafeInfoForProject } from "@/server/services/safe-info";
import { REPORT_DISCLAIMER } from "@/lib/report-disclaimer";
import { DOC_LIGHT, readableAccentOn } from "@/lib/report-theme";
import { brandingFor } from "@/lib/report-branding";
import { parseReportDoc, docPlainText } from "@/lib/report-doc";
import { describeReport } from "@/lib/report-label";

/**
 * Public investor view of a sent report.
 *
 * Reached via the `View Full Report →` button in the Resend-delivered
 * investor email. Investors don't have accounts, so this page lives
 * outside the (dashboard) auth gate. We expose ONLY reports with
 * status='sent' — drafts and review-stage content stay private even
 * if a UUID leaks. The report's UUID is the access token; non-
 * enumerable enough for v1, but if a founder reports a leak we can
 * add a per-recipient signed token without changing the URL shape.
 */

interface Props {
  params: Promise<{ reportId: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared by generateMetadata and the page so they cannot describe different reports. */
async function loadReport(reportId: string) {
  if (!UUID_RE.test(reportId)) return null;

  const report = await db.query.reports.findFirst({
    where: eq(reports.id, reportId),
    // Join the linked treasury snapshot so we can render the KPI /
    // breakdown / token / GitHub widget strip above the markdown
    // narrative. Drizzle resolves this as a single SQL JOIN.
    with: { snapshot: true },
  });

  // Status gate: only delivered reports are visible publicly. A leaked
  // UUID for a draft would otherwise expose the founder's WIP narrative.
  if (!report || report.status !== "sent") return null;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, report.projectId),
  });
  if (!project) return null;

  return { report, project };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { reportId } = await params;
  const loaded = await loadReport(reportId);

  // `robots: noindex` is retained on every path, including the miss. Investor
  // reports are not marketing surfaces: anyone with the link can read, nobody
  // should find one via Google.
  const robots = { index: false, follow: false } as const;
  if (!loaded) return { robots };

  const { report, project } = loaded;
  const { kind, period } = describeReport(report);
  const title = `${project.name} — ${kind}, ${period}`;

  // A short prose lead-in, so a pasted link unfurls as something recognisable
  // instead of the generic marketing card from the root layout.
  //
  // DELIBERATELY NO OG IMAGE. Generating one means serving treasury figures
  // from a URL that link-unfurlers (Slack, Telegram, iMessage) fetch
  // server-side with no bearer check on the image itself, and third-party
  // caches keep it. The report's own privacy model is "the UUID is the token";
  // an image route would quietly route around that.
  const description = docPlainText(parseReportDoc(report.contentMd ?? ""))
    .slice(0, 180)
    .trim();

  return {
    title,
    description: description || undefined,
    robots,
    openGraph: { title, description: description || undefined, type: "article" },
  };
}

export default async function PublicReportPage({ params }: Props) {
  const { reportId } = await params;
  const loaded = await loadReport(reportId);
  if (!loaded) notFound();

  const { report, project } = loaded;
  const branding = brandingFor(project);
  const { kind, period } = describeReport(report);

  // Two accents. The raw brand colour paints FILLS — the masthead rule, widget
  // bars, bullet dots — so a project stays recognisable. The derived one
  // paints TEXT, because the product's own default (#00e87b) measures about
  // 1.5:1 on paper and is unreadable as a link.
  const accent = branding.primaryColor;
  const accentInk = readableAccentOn(accent, DOC_LIGHT.paper);

  const safes = await getSafeInfoForProject(report.projectId);

  // Trailing treasury/burn history for the trend chart — same trailing-12
  // query + shape as projects.getSnapshotTrend (tRPC), duplicated here as a
  // direct DB read because this page is public and unauthenticated, same
  // pattern as the safes lookup above.
  const trendSnapshots = await db.query.treasurySnapshots.findMany({
    where: eq(treasurySnapshots.projectId, report.projectId),
    orderBy: [desc(treasurySnapshots.snapshotDate)],
    limit: 12,
  });
  const trendChronological = [...trendSnapshots].reverse();
  const trend = {
    treasury: trendChronological.map((s) => ({
      date: formatDate(s.snapshotDate),
      totalBalanceUsd: Number(s.totalBalanceUsd ?? 0),
    })),
    burn: trendChronological.map((s) => ({
      date: formatDate(s.snapshotDate),
      burnRateUsd: Number(s.burnRateUsd ?? 0),
    })),
  };

  // Milestone target-vs-actual comparison — same table the founder editor's
  // milestone manager (SectionDataModal) writes to, re-queried here for the
  // same reason as safes/trend above: this page is public/unauthenticated,
  // so it can't go through a protectedProcedure.
  const milestoneList = await db.query.milestones.findMany({
    where: eq(milestones.projectId, report.projectId),
  });

  return (
    // `vb-doc` re-points the design tokens for this subtree: the document
    // palette, plus aliases for the --vb-* names the widgets are authored
    // against, so they re-theme without per-component edits. A report is read
    // by investors and funders, printed, and attached to emails — it is paper,
    // even though the rest of the product is dark-only by design.
    <div
      className="vb-doc"
      style={
        {
          minHeight: "100dvh",
          "--doc-accent": accent,
          "--doc-accent-ink": accentInk,
        } as React.CSSProperties
      }
    >
      <header
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "40px 28px 20px",
          borderBottom: `2px solid var(--doc-ink)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 20,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontFamily: "var(--font-plex-mono), ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "var(--doc-ink-faint)",
                margin: 0,
              }}
            >
              {kind}
            </p>
            <h1
              style={{
                fontFamily: "var(--font-spectral), Georgia, serif",
                fontSize: 32,
                fontWeight: 600,
                lineHeight: 1.15,
                letterSpacing: "-0.01em",
                color: "var(--doc-ink)",
                margin: "8px 0 0",
                textWrap: "balance",
              }}
            >
              {project.name}
            </h1>
          </div>
          {branding.logoUrl && (
            // Investor-facing surface — keep this as a plain <img> so a
            // broken upstream logo URL doesn't 500 the whole page (next/image
            // would try to optimize and could fail noisily on opaque CDN URLs).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={`${project.name} logo`}
              style={{ maxHeight: 40, maxWidth: 150, objectFit: "contain", flexShrink: 0 }}
            />
          )}
        </div>

        {/* Meta grid, mirroring the PDF masthead. Mono because these are
            reference values a reader looks up, not prose they read. */}
        <dl
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "14px 40px",
            margin: "22px 0 0",
          }}
        >
          {[
            { label: "Period", value: period },
            ...(project.website ? [{ label: "Project", value: project.website }] : []),
          ].map((item) => (
            <div key={item.label}>
              <dt
                style={{
                  fontFamily: "var(--font-plex-mono), ui-monospace, monospace",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--doc-ink-faint)",
                  margin: "0 0 3px",
                }}
              >
                {item.label}
              </dt>
              <dd
                style={{
                  fontFamily: "var(--font-plex-mono), ui-monospace, monospace",
                  fontSize: 13,
                  color: "var(--doc-ink-soft)",
                  margin: 0,
                }}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <article
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "24px 28px 64px",
        }}
      >
        {/* Widget strip — KPIs, treasury composition, expenses, token
            metrics, GitHub activity — rendered above the markdown
            narrative so investors land on the same visual structure the
            marketing demo promises. Null-renders for reports without a
            linked snapshot, in which case the page falls back to the
            existing markdown-only view. */}
        <ReportWidgets
          snapshot={report.snapshot}
          accent={accent}
          safes={safes}
          trend={trend}
          milestones={milestoneList}
          // Recharts writes SVG presentation attributes, where var() is
          // invalid, so these two are the one part of the widget strip the
          // .vb-doc token scope cannot reach.
          chartPalette={DOC_CHART_PALETTE}
          // The own-token identity the composition classifier needs. Without
          // it the project's own holdings fall into "Other assets".
          project={project}
        />
        <ReportPreview content={report.contentMd ?? ""} />
      </article>

      <footer
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "18px 28px 56px",
          borderTop: "1px solid var(--doc-line)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 12,
          color: "var(--doc-ink-faint)",
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span>
          Generated by{" "}
          <a
            href="https://vaultbrief.io"
            style={{ color: "var(--doc-ink-soft)", textUnderlineOffset: 2 }}
          >
            Vault Brief
          </a>
        </span>
        <span>Confidential — for the recipient of this email only.</span>
        {/* One disclaimer, four surfaces — see src/lib/report-disclaimer.ts.
            Platform-rendered, never model-written. */}
        <p style={{ width: "100%", margin: 0, lineHeight: 1.5 }}>
          {REPORT_DISCLAIMER}
        </p>
      </footer>
    </div>
  );
}
