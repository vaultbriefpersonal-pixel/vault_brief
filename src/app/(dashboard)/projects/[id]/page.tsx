import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects, treasurySnapshots } from "@/server/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { Wallet, FileText, Users } from "lucide-react";
import { formatUsd, formatDate } from "@/lib/utils";
import { TreasuryChart } from "@/components/charts/TreasuryChart";
import { BurnRateChart } from "@/components/charts/BurnRateChart";
import { ExpenseBreakdown } from "@/components/charts/ExpenseBreakdown";
import { IncomeBreakdown } from "@/components/charts/IncomeBreakdown";
import { SyncNowButton } from "@/components/projects/SyncNowButton";
import { ProjectActionsMenu } from "@/components/projects/ProjectActionsMenu";
import { ChainIcon } from "@/components/ui/ChainIcon";

// Brand colors keyed by chain id, used by the per-chain stacked bar so
// each segment matches the wallet-list ChainIcon palette. Unknown chains
// fall back to a neutral gray.
const CHAIN_BAR_COLOR: Record<string, string> = {
  ethereum: "#627EEA",
  polygon: "#8247E5",
  arbitrum: "#28A0F0",
  base: "#0052FF",
  optimism: "#FF0420",
  solana: "#9945FF",
};

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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncNowButton projectId={id} />
          <ProjectActionsMenu projectId={id} projectSlug={project.slug} />
        </div>
      </div>

      {/* Sync warnings — surfaced when one or more wallets failed to fetch
          during the latest sync. Without this banner, founders see plausible-
          looking-but-incomplete numbers on every tile and chart, then send
          a wrong report to investors. The schema's `sync_warnings` column
          was added for this; we just need to render it. */}
      {Array.isArray(latestSnapshot?.syncWarnings) &&
        latestSnapshot.syncWarnings.length > 0 && (
          <div
            style={{
              marginBottom: 24,
              padding: "12px 16px",
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.25)",
              borderRadius: 10,
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fbbf24",
                  margin: "0 0 4px",
                }}
              >
                Snapshot is partial — {latestSnapshot.syncWarnings.length}{" "}
                wallet
                {latestSnapshot.syncWarnings.length === 1 ? "" : "s"} failed
                to sync
              </p>
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                  fontSize: 12,
                  color: "var(--vb-muted)",
                }}
              >
                {(
                  latestSnapshot.syncWarnings as Array<{
                    wallet?: string;
                    chain?: string;
                    error?: string;
                  }>
                )
                  .slice(0, 3)
                  .map((w, i) => (
                    <li key={i} style={{ lineHeight: 1.6 }}>
                      <code
                        style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          opacity: 0.7,
                        }}
                      >
                        {w.wallet?.slice(0, 10)}…{w.wallet?.slice(-4)}
                      </code>{" "}
                      ({w.chain}) — {w.error}
                    </li>
                  ))}
                {latestSnapshot.syncWarnings.length > 3 && (
                  <li
                    style={{ lineHeight: 1.6, opacity: 0.7, marginTop: 2 }}
                  >
                    + {latestSnapshot.syncWarnings.length - 3} more
                  </li>
                )}
              </ul>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--vb-dim)",
                  margin: "6px 0 0",
                }}
              >
                Numbers below reflect only the wallets that synced
                successfully. Click <strong>Sync now</strong> to retry.
              </p>
            </div>
          </div>
        )}

      {/* Tiles render even before first sync — empty placeholders ("—")
          are clearer than a blank section, and they double as a visual
          anchor for "Sync now" so the user understands what populates here. */}
      {!latestSnapshot && (
        <div className="vb-grid-4" style={{ gap: 12, marginBottom: 24 }}>
          {statCard("Treasury", "—")}
          {statCard("Burn / mo", "—")}
          {statCard("Runway", "—")}
          {statCard("Stablecoins", "—")}
        </div>
      )}
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
            // burn_rate is a numeric column → comes back as a string "0.00".
            // Truthy check on the raw value falsely flips $0 into the formatted
            // path; coerce to Number before testing. ENS-style projects whose
            // only outflows are token_sale rebalances legitimately have burn=0,
            // and "—" reads truer than "$0.00" for that case.
            Number(latestSnapshot.burnRateUsd ?? 0) > 0
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

      {/* Treasury by chain — stacked horizontal bar. Renders only when the
          snapshot has at least 2 chains; single-chain projects don't need a
          bar to say "100% one chain". balancesByChain is computed at sync
          time so this query is just a JSONB read. */}
      {(() => {
        const byChain =
          (latestSnapshot?.balancesByChain as Record<string, number> | null) ?? null;
        if (!byChain) return null;
        const entries = Object.entries(byChain).filter(([, v]) => v > 0);
        if (entries.length < 2) return null;
        const total = entries.reduce((s, [, v]) => s + v, 0);
        const sorted = [...entries].sort((a, b) => b[1] - a[1]);
        return (
          <div style={{ marginBottom: 24 }}>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 11,
                color: "var(--vb-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                margin: "0 0 10px",
              }}
            >
              Treasury by chain
            </p>
            <div
              role="img"
              aria-label={`Treasury split: ${sorted
                .map(
                  ([c, v]) =>
                    `${c} ${((v / total) * 100).toFixed(0)} percent`
                )
                .join(", ")}`}
              style={{
                display: "flex",
                height: 28,
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--vb-border)",
              }}
            >
              {sorted.map(([chain, v]) => (
                <div
                  key={chain}
                  title={`${chain}: ${formatUsd(v)} (${((v / total) * 100).toFixed(1)}%)`}
                  style={{
                    width: `${(v / total) * 100}%`,
                    background: CHAIN_BAR_COLOR[chain] ?? "#444",
                  }}
                />
              ))}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                marginTop: 12,
              }}
            >
              {sorted.map(([chain, v]) => (
                <div
                  key={chain}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: "var(--vb-muted)",
                  }}
                >
                  <ChainIcon chain={chain} size={12} withLabel />
                  <span style={{ color: "var(--vb-text)", fontWeight: 600 }}>
                    {formatUsd(v)}
                  </span>
                  <span style={{ color: "var(--vb-dim)" }}>
                    {((v / total) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div
        className="vb-grid-3"
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
