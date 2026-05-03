import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects, treasurySnapshots } from "@/server/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { Wallet, FileText, Users, Settings } from "lucide-react";
import { formatUsd, formatDate } from "@/lib/utils";
import { TreasuryChart } from "@/components/charts/TreasuryChart";
import { BurnRateChart } from "@/components/charts/BurnRateChart";
import { ExpenseBreakdown } from "@/components/charts/ExpenseBreakdown";
import { IncomeBreakdown } from "@/components/charts/IncomeBreakdown";
import { SyncNowButton } from "@/components/projects/SyncNowButton";

interface Props {
  params: Promise<{ id: string }>;
}

const statCard = (label: string, value: string, accent?: string) => (
  <div
    style={{
      background: "var(--vb-card)",
      border: "1px solid var(--vb-border)",
      borderRadius: 12,
      padding: "18px 20px",
    }}
  >
    <p
      style={{
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: 11,
        color: "var(--vb-dim)",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        margin: "0 0 8px",
      }}
    >
      {label}
    </p>
    <p
      style={{
        fontFamily:
          "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
        fontSize: 22,
        fontWeight: 700,
        color: accent ?? "#f0f0f0",
        margin: 0,
      }}
    >
      {value}
    </p>
  </div>
);

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session!.user!.id!)),
    with: { wallets: true, reports: true, investors: true },
  });

  if (!project) notFound();

  const snapshots = await db.query.treasurySnapshots.findMany({
    where: eq(treasurySnapshots.projectId, id),
    orderBy: [desc(treasurySnapshots.snapshotDate)],
    limit: 12,
  });

  const latestSnapshot = snapshots[0];

  const treasuryChartData = [...snapshots].reverse().map((s) => ({
    date: formatDate(s.snapshotDate),
    totalBalanceUsd: Number(s.totalBalanceUsd ?? 0),
  }));

  const burnChartData = [...snapshots].reverse().map((s) => ({
    date: formatDate(s.snapshotDate),
    burnRateUsd: Number(s.burnRateUsd ?? 0),
  }));

  const expenseData =
    (latestSnapshot?.expensesByCategory as Record<string, number> | null) ?? {};
  const incomeData =
    (latestSnapshot?.incomeByCategory as Record<string, number> | null) ?? {};

  const NAV = [
    {
      href: `/projects/${id}/wallets`,
      label: "Wallets",
      icon: Wallet,
      count: project.wallets.length,
    },
    {
      href: `/projects/${id}/reports`,
      label: "Reports",
      icon: FileText,
      count: project.reports.length,
    },
    {
      href: `/projects/${id}/investors`,
      label: "Investors",
      icon: Users,
      count: project.investors.length,
    },
    {
      href: `/projects/${id}/settings`,
      label: "Settings",
      icon: Settings,
    },
  ];

  return (
    <div style={{ padding: "24px 28px", minHeight: "100dvh" }}>
      <div
        style={{
          marginBottom: 28,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 18,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: "0 0 4px",
              letterSpacing: "-0.02em",
            }}
          >
            {project.name}
          </h2>
          {project.description && (
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 14,
                color: "var(--vb-dim)",
                margin: 0,
                maxWidth: 720,
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {project.description}
            </p>
          )}
        </div>
        <SyncNowButton projectId={id} />
      </div>

      {latestSnapshot && (
        <div
          className="vb-grid-4"
          style={{ gap: 12, marginBottom: 24 }}
        >
          {statCard(
            "Treasury",
            formatUsd(Number(latestSnapshot.totalBalanceUsd ?? 0))
          )}
          {statCard(
            "Burn / mo",
            latestSnapshot.burnRateUsd
              ? formatUsd(Number(latestSnapshot.burnRateUsd))
              : "—",
            "#f87171"
          )}
          {statCard(
            "Runway",
            latestSnapshot.runwayMonths
              ? `${Number(latestSnapshot.runwayMonths).toFixed(0)} mo`
              : "—",
            "#00e87b"
          )}
          {statCard(
            "Stablecoins",
            formatUsd(Number(latestSnapshot.stablecoinsUsd ?? 0))
          )}
        </div>
      )}

      <div
        className="vb-grid-4"
        style={{ gap: 10, marginBottom: 32 }}
      >
        {NAV.map(({ href, label, icon: Icon, count }) => (
          <Link
            key={href}
            href={href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--vb-card)",
              border: "1px solid var(--vb-border)",
              borderRadius: 12,
              padding: "16px 18px",
              textDecoration: "none",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(0,232,123,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon size={15} color="#00e87b" />
            </div>
            <div>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 11,
                  color: "var(--vb-dim)",
                  margin: 0,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {label}
              </p>
              {count !== undefined && (
                <p
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 18,
                    fontWeight: 700,
                    color: "var(--vb-text)",
                    margin: 0,
                  }}
                >
                  {count}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>

      <div
        className="vb-grid-2"
        style={{ gap: 16 }}
      >
        <div
          style={{
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <h3
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--vb-muted)",
              margin: "0 0 16px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Treasury over time
          </h3>
          <TreasuryChart data={treasuryChartData} />
        </div>
        <div
          style={{
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <h3
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--vb-muted)",
              margin: "0 0 16px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Monthly burn rate
          </h3>
          <BurnRateChart data={burnChartData} />
        </div>
        <div
          style={{
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <h3
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--vb-muted)",
              margin: "0 0 16px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Expense breakdown
          </h3>
          <ExpenseBreakdown data={expenseData} />
        </div>
        <div
          style={{
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <h3
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--vb-muted)",
              margin: "0 0 16px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Income breakdown
          </h3>
          <IncomeBreakdown data={incomeData} />
        </div>
        {latestSnapshot?.githubCommitsCount !== null && (
          <div
            style={{
              background: "var(--vb-card)",
              border: "1px solid var(--vb-border)",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--vb-muted)",
                margin: "0 0 16px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Development activity
            </h3>
            <div
              className="vb-grid-3"
              style={{ gap: 16 }}
            >
              {[
                {
                  val: latestSnapshot?.githubCommitsCount ?? 0,
                  label: "Commits",
                },
                {
                  val: latestSnapshot?.githubPrsMerged ?? 0,
                  label: "PRs merged",
                },
                {
                  val: latestSnapshot?.githubContributorsActive ?? 0,
                  label: "Contributors",
                },
              ].map(({ val, label }) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <p
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                      fontSize: 28,
                      fontWeight: 700,
                      color: "var(--vb-text)",
                      margin: "0 0 4px",
                    }}
                  >
                    {val}
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 12,
                      color: "var(--vb-dim)",
                      margin: 0,
                    }}
                  >
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
