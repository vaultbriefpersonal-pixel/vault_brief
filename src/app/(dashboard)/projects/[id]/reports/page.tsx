import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects, reports } from "@/server/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { FileText } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  draft: { background: "rgba(255,255,255,0.06)", color: "#888888" },
  review: {
    background: "rgba(251,191,36,0.12)",
    color: "#fbbf24",
  },
  sent: { background: "rgba(0,232,123,0.12)", color: "#00e87b" },
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

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <h2
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 18,
          fontWeight: 700,
          color: "#f0f0f0",
          margin: "0 0 24px",
          letterSpacing: "-0.02em",
        }}
      >
        Reports
      </h2>

      {reportList.length === 0 ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "#161616",
            borderRadius: 14,
            padding: "64px 24px",
            textAlign: "center",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "rgba(0,232,123,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <FileText size={20} color="#00e87b" />
          </div>
          <p
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 16,
              fontWeight: 600,
              color: "#f0f0f0",
              margin: "0 0 8px",
            }}
          >
            No reports yet
          </p>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "#555555",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Reports are generated automatically on the 1st of each month after
            your data syncs.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reportList.map((report) => (
            <Link
              key={report.id}
              href={`/projects/${projectId}/reports/${report.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.08)",
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
                    color: "#f0f0f0",
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
                      color: "#555555",
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
                      color: "#555555",
                    }}
                  >
                    Sent to {report.sentToCount} · {report.openedCount ?? 0}{" "}
                    opened
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
      )}
    </div>
  );
}
