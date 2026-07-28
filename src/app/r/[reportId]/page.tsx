import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq, desc } from "drizzle-orm";
import { db } from "@/server/db";
import { reports, projects, treasurySnapshots, milestones } from "@/server/db/schema";
import { ReportPreview } from "@/components/report/ReportPreview";
import { ReportWidgets } from "@/components/report/ReportWidgets";
import { formatDate } from "@/lib/utils";
import { getSafeInfoForProject } from "@/server/services/safe-info";

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

// Block search engine indexing — investor reports are not public marketing
// surfaces. Anyone with the link can read; nobody should find them via Google.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PublicReportPage({ params }: Props) {
  const { reportId } = await params;

  // Cheap pre-DB validation — random garbage in the URL shouldn't burn a
  // round-trip. Drizzle would reject the cast anyway, but we'd rather 404
  // fast than surface a stack trace.
  if (!UUID_RE.test(reportId)) notFound();

  const report = await db.query.reports.findFirst({
    where: eq(reports.id, reportId),
    // Join the linked treasury snapshot so we can render the KPI /
    // breakdown / token / GitHub widget strip above the markdown
    // narrative. Drizzle resolves this as a single SQL JOIN.
    with: { snapshot: true },
  });

  // Status gate: only delivered reports are visible publicly. A leaked
  // UUID for a draft would otherwise expose the founder's WIP narrative.
  if (!report || report.status !== "sent") notFound();

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, report.projectId),
  });

  if (!project) notFound();

  const branding = (project.customBranding as {
    primaryColor?: string;
    logoUrl?: string;
  } | null) ?? null;

  const accent = branding?.primaryColor ?? "#00e87b";
  const period = formatDate(report.periodEnd);
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
    <div
      style={{
        background: "var(--vb-bg)",
        minHeight: "100dvh",
        color: "var(--vb-text)",
        fontFamily: "var(--font-inter), Inter, sans-serif",
      }}
    >
      <header
        style={{
          borderBottom: `2px solid ${accent}`,
          padding: "24px 28px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          maxWidth: 880,
          margin: "0 auto",
        }}
      >
        {branding?.logoUrl && (
          // Investor-facing surface — keep this as a plain <img> so a
          // broken upstream logo URL doesn't 500 the whole page (next/image
          // would try to optimize and could fail noisily on opaque CDN URLs).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt={`${project.name} logo`}
            style={{ maxHeight: 36, maxWidth: 140, objectFit: "contain" }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            {project.name}
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--vb-muted)",
              margin: "4px 0 0",
            }}
          >
            Monthly Investor Update · {period}
          </p>
        </div>
      </header>

      <article
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "8px 0 64px",
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
        />
        <ReportPreview content={report.contentMd ?? ""} />
      </article>

      <footer
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "16px 28px 48px",
          borderTop: "1px solid var(--vb-border)",
          fontSize: 11,
          color: "var(--vb-dim)",
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
            style={{ color: "var(--vb-muted)", textDecoration: "underline" }}
          >
            Vault Brief
          </a>
        </span>
        <span>
          Confidential — for the recipient of this email only.
        </span>
      </footer>
    </div>
  );
}
