import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import {
  projects,
  reports,
  treasurySnapshots,
} from "@/server/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { formatDate, formatUsd } from "@/lib/utils";

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id!;

  // Aggregate KPIs across all projects owned by this user.
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
    with: {
      wallets: { columns: { id: true } },
    },
  });

  const projectIds = userProjects.map((p) => p.id);

  // Reports stats — only one query, then group in JS.
  const allReports = projectIds.length
    ? await db.query.reports.findMany({
        where: inArray(reports.projectId, projectIds),
        columns: {
          id: true,
          projectId: true,
          status: true,
          sentToCount: true,
          openedCount: true,
          periodEnd: true,
        },
      })
    : [];

  const totalProjects = userProjects.length;
  const totalWallets = userProjects.reduce((s, p) => s + p.wallets.length, 0);
  const totalReports = allReports.length;
  const reportsSent = allReports.filter((r) => r.status === "sent").length;
  const totalSentTo = allReports.reduce(
    (s, r) => s + (r.sentToCount ?? 0),
    0
  );
  const totalOpened = allReports.reduce(
    (s, r) => s + (r.openedCount ?? 0),
    0
  );
  const openRate =
    totalSentTo > 0 ? Math.round((totalOpened / totalSentTo) * 100) : null;

  // Latest snapshot per project — used in the per-project table.
  const latestByProject = new Map<
    string,
    { snapshotDate: string; burnRateUsd: string | null }
  >();
  if (projectIds.length) {
    const snapshots = await db
      .select({
        projectId: treasurySnapshots.projectId,
        snapshotDate: treasurySnapshots.snapshotDate,
        burnRateUsd: treasurySnapshots.burnRateUsd,
      })
      .from(treasurySnapshots)
      .where(inArray(treasurySnapshots.projectId, projectIds))
      .orderBy(desc(treasurySnapshots.snapshotDate));
    for (const s of snapshots) {
      if (!latestByProject.has(s.projectId)) {
        latestByProject.set(s.projectId, {
          snapshotDate: s.snapshotDate,
          burnRateUsd: s.burnRateUsd,
        });
      }
    }
  }

  // Average burn rate across the latest snapshot of each project.
  const burnValues = Array.from(latestByProject.values())
    .map((v) => Number(v.burnRateUsd ?? 0))
    .filter((v) => v > 0);
  const avgBurn = burnValues.length
    ? burnValues.reduce((s, v) => s + v, 0) / burnValues.length
    : null;

  return (
    <div style={{ padding: "24px 28px", minHeight: "100dvh" }}>
      <h2 style={titleStyle}>Analytics</h2>
      <p style={subtitleStyle}>
        How your projects are performing across treasury, reports, and investor
        engagement.
      </p>

      {/* KPI cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
          marginTop: 20,
          marginBottom: 28,
        }}
      >
        <Kpi label="Projects" value={totalProjects.toString()} />
        <Kpi label="Wallets" value={totalWallets.toString()} />
        <Kpi
          label="Reports sent"
          value={`${reportsSent} / ${totalReports}`}
        />
        <Kpi
          label="Investor open rate"
          value={openRate === null ? "—" : `${openRate}%`}
          hint={
            totalSentTo > 0 ? `${totalOpened} of ${totalSentTo} delivered` : undefined
          }
        />
        <Kpi
          label="Avg monthly burn"
          value={avgBurn === null ? "—" : formatUsd(avgBurn)}
          hint={
            burnValues.length ? `Across ${burnValues.length} project(s)` : undefined
          }
        />
      </div>

      {/* Per-project rows */}
      <div
        style={{
          background: "var(--vb-card)",
          border: "1px solid var(--vb-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div className="vb-table-scroll">
          <div style={{ minWidth: 600 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr",
              padding: "12px 18px",
              background: "#1a1a1a",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--vb-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
          <span>Project</span>
          <span>Wallets</span>
          <span>Last snapshot</span>
          <span>Reports</span>
        </div>
        {userProjects.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              fontSize: 14,
              color: "var(--vb-dim)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
            No projects yet —{" "}
            <Link href="/projects/new" style={{ color: "var(--accent)" }}>
              create your first
            </Link>
            .
          </div>
        )}
        {userProjects.map((p) => {
          const latest = latestByProject.get(p.id);
          const projReports = allReports.filter((r) => r.projectId === p.id);
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                padding: "16px 18px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                color: "var(--vb-text)",
                fontSize: 14,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                textDecoration: "none",
              }}
            >
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <span style={{ color: "var(--vb-muted)" }}>{p.wallets.length}</span>
              <span style={{ color: "var(--vb-muted)" }}>
                {latest ? formatDate(latest.snapshotDate) : "—"}
              </span>
              <span style={{ color: "var(--vb-muted)" }}>
                {projReports.length} ·{" "}
                <span style={{ color: "var(--accent)" }}>
                  {projReports.filter((r) => r.status === "sent").length} sent
                </span>
              </span>
            </Link>
          );
        })}
        </div>
        </div>
      </div>
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
  fontSize: 22,
  fontWeight: 700,
  color: "var(--vb-text)",
  letterSpacing: "-0.02em",
  margin: "0 0 4px",
};

const subtitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 13,
  color: "var(--vb-muted)",
  margin: 0,
  lineHeight: 1.6,
};

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        background: "var(--vb-card)",
        border: "1px solid var(--vb-border)",
        borderRadius: 12,
        padding: "16px 18px",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--vb-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 24,
          fontWeight: 700,
          color: "var(--vb-text)",
          margin: 0,
        }}
      >
        {value}
      </p>
      {hint && (
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 11,
            color: "var(--vb-dim)",
            margin: "6px 0 0",
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
