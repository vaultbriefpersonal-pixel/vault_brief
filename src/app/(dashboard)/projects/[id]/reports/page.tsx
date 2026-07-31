import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import {
  grantAwards,
  projects,
  reports,
  treasurySnapshots,
} from "@/server/db/schema";
import { and, eq, asc, desc } from "drizzle-orm";
import { formatDate } from "@/lib/utils";
import { ReportsEmptyState } from "@/components/reports/ReportsEmptyState";
import { ReportPeriodPicker } from "@/components/reports/ReportPeriodPicker";
import {
  balanceBasisOf,
  reconstructionMetaOf,
} from "@/server/services/report-derived";
import type { PeriodSnapshotChoice } from "@/server/services/report-period-options";

/**
 * How many recent snapshots the period picker gets to resolve against.
 *
 * Two years of monthly syncs, which comfortably covers the 12-month
 * reconstruction horizon `assertPeriodSupported` enforces — a period older
 * than that is refused before coverage is even considered, so a deeper read
 * could not change any answer.
 */
const PICKER_SNAPSHOT_LIMIT = 24;

interface Props {
  params: Promise<{ id: string }>;
}

// User-facing labels — never show the raw "draft" / "review" status as
// the product type. Per copy rules: the output is always a "report"; the
// `draft` schema value is a stage label, surfaced as "Pending review".
const STATUS_LABELS: Record<string, string> = {
  draft: "Pending review",
  review: "Ready to send",
  sent: "Sent",
};

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  draft: { background: "rgba(255,255,255,0.06)", color: "var(--vb-muted)" },
  review: {
    background: "rgba(251,191,36,0.12)",
    color: "#fbbf24",
  },
  sent: { background: "rgba(0,232,123,0.12)", color: "var(--accent)" },
};

export default async function ReportsPage({ params }: Props) {
  const { id: projectId } = await params;
  const session = await auth();

  const project = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectId),
      eq(projects.userId, session!.user!.id!)
    ),
  });
  if (!project) notFound();

  const reportList = await db.query.reports.findMany({
    where: eq(reports.projectId, projectId),
    orderBy: [desc(reports.periodEnd)],
  });

  // Every period the picker may resolve against, newest first. A report is
  // generated FROM a snapshot and covers exactly that snapshot's window, so the
  // set of reportable periods IS the set of stored snapshots — see
  // `buildPeriodOptions`.
  const snapshotRows = await db.query.treasurySnapshots.findMany({
    where: eq(treasurySnapshots.projectId, projectId),
    orderBy: [desc(treasurySnapshots.snapshotDate)],
    limit: PICKER_SNAPSHOT_LIMIT,
  });
  const latestSnapshot = snapshotRows[0];

  // Provenance is resolved HERE, through the single readers of the two
  // columns, so `report-period-options.ts` never touches `balance_basis` or
  // `reconstruction_meta` itself and there stays exactly one reader of each.
  const snapshotChoices: PeriodSnapshotChoice[] = snapshotRows.map((s) => ({
    id: s.id,
    snapshotDate: s.snapshotDate,
    periodStart: s.periodStart,
    basis: balanceBasisOf(s),
    reconstruction: reconstructionMetaOf(s),
  }));

  const awards = await db.query.grantAwards.findMany({
    where: eq(grantAwards.projectId, projectId),
    orderBy: [asc(grantAwards.awardDate)],
  });

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {reportList.length === 0 ? (
        <ReportsEmptyState
          projectId={projectId}
          latestSnapshot={
            latestSnapshot
              ? { id: latestSnapshot.id, snapshotDate: latestSnapshot.snapshotDate }
              : null
          }
        />
      ) : (
        <>
          <ReportPeriodPicker
            projectId={projectId}
            snapshots={snapshotChoices}
            grantAwards={awards.map((a) => ({
              id: a.id,
              grantor: a.grantor,
              awardDate: a.awardDate,
              reportingStartDate: a.reportingStartDate,
            }))}
            // `reportList` is ordered by periodEnd desc, so the head is the
            // latest period already reported on — what "since last report"
            // continues from.
            lastReportPeriodEnd={reportList[0]?.periodEnd ?? null}
            // Resolved server-side as a UTC day. Letting the browser supply it
            // would let a client in another timezone build a different option
            // list than the one that was server-rendered.
            today={new Date().toISOString().slice(0, 10)}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reportList.map((report) => (
            <Link
              key={report.id}
              href={`/projects/${projectId}/reports/${report.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--vb-card)",
                border: "1px solid var(--vb-border)",
                borderRadius: 12,
                padding: "16px 20px",
                textDecoration: "none",
              }}
            >
              <div>
                <p
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    margin: "0 0 3px",
                  }}
                >
                  {formatDate(report.periodEnd)}
                </p>
                {report.executiveSummary && (
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "var(--vb-dim)",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 480,
                    }}
                  >
                    {report.executiveSummary}
                  </p>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  flexShrink: 0,
                }}
              >
                {(report.sentToCount ?? 0) > 0 && (
                  <span
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 12,
                      color: "var(--vb-dim)",
                    }}
                  >
                    Sent to {report.sentToCount} · {report.openedCount ?? 0}{" "}
                    opened
                    {(report.clickedCount ?? 0) > 0
                      ? ` · ${report.clickedCount} clicked`
                      : ""}
                  </span>
                )}
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    ...(STATUS_STYLE[report.status] ?? STATUS_STYLE.draft),
                  }}
                >
                  {STATUS_LABELS[report.status] ?? report.status}
                </span>
              </div>
            </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
