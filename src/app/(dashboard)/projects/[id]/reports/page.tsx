import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects, reports, treasurySnapshots } from "@/server/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { formatDate } from "@/lib/utils";
import { ReportsEmptyState } from "@/components/reports/ReportsEmptyState";
import { GenerateReportButton } from "@/components/reports/GenerateReportButton";

interface Props {
  params: Promise<{ id: string }>;
}

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

  // Latest snapshot drives the manual-generate empty state.
  const latestSnapshot = await db.query.treasurySnapshots.findFirst({
    where: eq(treasurySnapshots.projectId, projectId),
    orderBy: [desc(treasurySnapshots.snapshotDate)],
  });

  const latestSnapshotHasReport = latestSnapshot
    ? reportList.some((r) => r.snapshotId === latestSnapshot.id)
    : false;

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <h2
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--vb-text)",
          margin: "0 0 24px",
          letterSpacing: "-0.02em",
        }}
      >
        Reports
      </h2>

      {reportList.length === 0 ? (
        <ReportsEmptyState
          projectId={projectId}
          latestSnapshot={
            latestSnapshot
              ? { id: latestSnapshot.id, snapshotDate: latestSnapshot.snapshotDate }
              : null
          }
          latestSnapshotHasReport={latestSnapshotHasReport}
        />
      ) : (
        <>
          <GenerateReportButton
            projectId={projectId}
            latestSnapshotId={latestSnapshot?.id ?? null}
            latestSnapshotHasReport={latestSnapshotHasReport}
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
                    textTransform: "capitalize",
                    ...(STATUS_STYLE[report.status] ?? STATUS_STYLE.draft),
                  }}
                >
                  {report.status}
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
