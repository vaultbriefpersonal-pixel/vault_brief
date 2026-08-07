import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects, treasurySnapshots } from "@/server/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { formatUsd, formatDate } from "@/lib/utils";
import { TreasuryChart } from "@/components/charts/TreasuryChart";
import { BurnRateChart } from "@/components/charts/BurnRateChart";
import { ExpenseBreakdown } from "@/components/charts/ExpenseBreakdown";
import { IncomeBreakdown } from "@/components/charts/IncomeBreakdown";
import { ChainIcon } from "@/components/ui/ChainIcon";
import { trailingAverageBurn } from "@/server/services/burn-metrics";
import { composeTreasury } from "@/server/services/treasury-composition";
import {
  summarizeSyncWarnings,
  describeSyncCoverage,
} from "@/server/services/sync-warnings";

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

const statCard = (
  label: string,
  value: string,
  accent?: string,
  opts?: { subtitle?: string; tooltip?: string; small?: boolean }
) => (
  <div
    title={opts?.tooltip}
    style={{
      background: "var(--vb-card)",
      border: "1px solid var(--vb-border)",
      borderRadius: 12,
      padding: "18px 20px",
      cursor: opts?.tooltip ? "help" : "default",
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
        // The "no outflows" copy is longer than a dollar figure — drop the
        // size so it fits the same tile width without wrapping awkwardly.
        fontSize: opts?.small ? 14 : 22,
        fontWeight: opts?.small ? 600 : 700,
        color: accent ?? "#f0f0f0",
        margin: 0,
        lineHeight: opts?.small ? 1.4 : 1.2,
      }}
    >
      {value}
    </p>
    {opts?.subtitle && (
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          color: "var(--vb-dim)",
          margin: "4px 0 0",
          lineHeight: 1.4,
        }}
      >
        {opts.subtitle}
      </p>
    )}
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

  // Burn / mo logic. ENS-style treasuries can legitimately have $0 burn
  // in a given month (all outflows that period were token_sale rebalances,
  // which are reclassified as treasury operations, not opex). Showing
  // "$0.00" or "—" alone leaves the founder wondering if data is missing,
  // especially when the trailing chart bars ARE non-zero.
  //
  // So: if latest burn is 0 but earlier months had real outflows, label
  // it explicitly ("No outflows this period") and surface the trailing
  // 3-mo average as a tooltip. Founders who want the comparison get it
  // on hover; investors looking at the dashboard see truthful, calm copy.
  // Stablecoins tile, derived at read time from the snapshot's per-token
  // `balances_detail` rather than read off the frozen `stablecoins_usd` column.
  // Same classifier the report, the PDF donut and the investor email now use, so
  // the tile and the report can no longer print different stablecoin figures
  // for the same snapshot. (The column is still written by the sync — the
  // treasury/burn/runway tiles and the historical charts read it — but it is a
  // write-only cache; see treasury-composition.ts.)
  const latestComposition = latestSnapshot
    ? composeTreasury(latestSnapshot.balancesDetail, project)
    : null;

  const latestBurn = Number(latestSnapshot?.burnRateUsd ?? 0);
  // `slice(1)` drops the current snapshot — trailingAverageBurn takes PRIOR
  // periods only, and applies the same 3-month window and zero-burn exclusion
  // this block used to inline. Same numbers, one definition, now shared with
  // the report's runway calculation so the dashboard and the report cannot
  // disagree about what "trailing average burn" means.
  const trailing = trailingAverageBurn(snapshots.slice(1), 3);
  const trailingAvgBurn = trailing.avgUsd;
  const burnTile =
    latestBurn > 0
      ? statCard("Burn / mo", formatUsd(latestBurn), "#f87171")
      : trailingAvgBurn > 0
        ? statCard("Burn / mo", "No outflows this period", "var(--vb-muted)", {
            subtitle: `${formatUsd(trailingAvgBurn)} avg over prior ${trailing.monthsUsed} mo`,
            tooltip: `Latest snapshot reports zero operating outflows. Trailing ${trailing.monthsUsed}-month average: ${formatUsd(trailingAvgBurn)}. token_sale rebalances are tracked separately as treasury operations.`,
            small: true,
          })
        : statCard("Burn / mo", "—", "#f87171");

  // Which figures on this page are incomplete, and why. Summarised in one
  // shared place rather than counted inline: the old inline version counted
  // WARNINGS where it claimed to count WALLETS, and called a page-capped read
  // a failure. See sync-warnings.ts.
  const coverage = summarizeSyncWarnings(latestSnapshot?.syncWarnings);
  const coverageNote = describeSyncCoverage(coverage);

  return (
    <>
      {/* Sync warnings — surfaced when one or more wallets failed to fetch
          during the latest sync. Without this banner, founders see plausible-
          looking-but-incomplete numbers on every tile and chart, then send
          a wrong report to investors. The schema's `sync_warnings` column
          was added for this; we just need to render it. */}
      {coverageNote && Array.isArray(latestSnapshot?.syncWarnings) && (
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
                {coverageNote.title} — {coverageNote.detail}
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
                    walletAddress?: string;
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
                        {w.walletAddress?.slice(0, 10)}…{w.walletAddress?.slice(-4)}
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
                Click <strong>Sync now</strong> to retry. Per-wallet figures
                are on the <strong>Wallets</strong> tab.
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
          {burnTile}
          {statCard(
            "Runway",
            latestSnapshot.runwayMonths
              ? `${Number(latestSnapshot.runwayMonths).toFixed(0)} mo`
              : "—",
            "#00e87b"
          )}
          {statCard(
            "Stablecoins",
            formatUsd(latestComposition?.liquidStableUsd ?? 0)
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
    </>
  );
}
