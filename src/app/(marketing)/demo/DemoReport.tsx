"use client";

import { useState } from "react";
import Link from "next/link";

type Mode = "investor" | "grant";

// ─── investor dataset ───────────────────────────────────────────────────
// Real, public ENS DAO treasury data from a recent sync (treasury
// multisig 0xFe89cc7aBB2C4183683ab71653C4cdc9B02D44b7). Unchanged from
// the prior single-mode demo — this side already got the "switch to
// real public numbers" treatment, so it stays as-is.
const INVESTOR_KPIS = [
  { label: "Total Balance", val: "$79.8M", change: "+3.2%", positive: true },
  { label: "Monthly Net Flow", val: "+$2.5M", change: "vs last month", positive: true },
  { label: "Inflows", val: "$4.9M", change: "this period", positive: true },
  { label: "ENS Token Price", val: "$6.95", change: "+18.5%", positive: true },
];

const INVESTOR_BREAKDOWN = [
  { label: "Native Token (ENS)", pct: 84, usd: "$67.4M", color: "var(--accent)" },
  { label: "ETH", pct: 13, usd: "$10.2M", color: "#4f9cf9" },
  { label: "Stablecoins (USDC)", pct: 3, usd: "$2.2M", color: "#a78bfa" },
];

const INVESTOR_EXPENSES = [
  { label: "Treasury rebalance", pct: 70, usd: "$1.68M" },
  { label: "Grants", pct: 18, usd: "$432K" },
  { label: "Contractors", pct: 9, usd: "$216K" },
  { label: "Infrastructure", pct: 3, usd: "$72K" },
];

const INVESTOR_GITHUB = [
  { label: "Commits", val: "316" },
  { label: "PRs Merged", val: "47" },
  { label: "Active Contributors", val: "18" },
];

// ENS token metrics. Price + market cap from CoinGecko, holder count
// from Dune Sim.
const INVESTOR_TOKEN_METRICS = [
  { label: "Token Price", val: "$6.95", note: "+18.5% MoM" },
  { label: "Market Cap", val: "$210M", note: "Fully diluted: $695M" },
  { label: "Holders", val: "~80K", note: "ERC-20 wallets" },
  { label: "Governance", val: "Active", note: "DAO via Snapshot" },
];

const INVESTOR_SUMMARY =
  "The ENS DAO treasury currently stands at $79.8M. The period saw a net inflow of $2.5M, driven by $4.9M in inflows and $2.4M in outflows — the largest single outflow being a treasury rebalance from native ENS into stablecoins to fund the next round of working-group budgets. Native token holdings remain the majority position at $67.4M (84%); stablecoin reserves at $2.2M cover roughly nine months of current operational outflows independent of token price. Development velocity stayed high across ensdomains with 316 commits and 47 merged PRs from 18 active contributors. The ENS token appreciated 18.5% over the month, though liquidity-adjusted treasury calculations apply a 30% haircut on the native position when assessing runway.";

// ─── grant dataset ──────────────────────────────────────────────────────
// Illustrative only — "L2 Ecosystem Fund" is a generic placeholder, not
// a real grant program, and every figure below is invented for the
// demo. The shape is not invented: it mirrors the real grant_fund_usage,
// grant_milestone_progress, leftover_funds, plan_deviation, and
// external_dashboard sections in src/server/services/report-sections.ts
// — award vs. tranches vs. spend, never a treasury-balance claim; a
// leftover figure paired with a stated plan for it; a standing
// deviation-from-plan statement; a link back to the live dashboard.
const GRANT_AWARD = {
  grantor: "L2 Ecosystem Fund",
  program: "Builder Grants — Cohort 4",
  status: "Active",
};

const GRANT_KPIS = [
  { label: "Awarded", val: "$150K", change: "total award", positive: true },
  { label: "Received to Date", val: "$100K", change: "2 of 3 tranches", positive: true },
  { label: "Received This Period", val: "$50K", change: "Tranche 2", positive: true },
  { label: "Not Yet Disbursed", val: "$50K", change: "Tranche 3 pending", positive: false },
];

const GRANT_TRANCHES = [
  { label: "Tranche 1 — Kickoff", usd: "$50K", pct: 100, status: "Received Feb 4" },
  { label: "Tranche 2 — Milestone 1", usd: "$50K", pct: 100, status: "Received Apr 6" },
  { label: "Tranche 3 — Final milestone", usd: "$0 of $50K", pct: 0, status: "Not yet disbursed" },
];

const GRANT_UTILIZATION = [
  { label: "Utilized to date", usd: "$62K", pct: 62, color: "var(--accent)" },
  { label: "Leftover (received minus utilized)", usd: "$38K", pct: 38, color: "#a78bfa" },
];

const GRANT_LEFTOVER_PLAN =
  "Held for the final security audit and integration testing ahead of the v1.1 release — not allocated to team compensation.";

const GRANT_MILESTONES = [
  {
    title: "Ship v1 SDK integration",
    status: "Completed",
    target: "Mar 15",
    actual: "Mar 10 (5 days early)",
    source: "GitHub — release v1.0.0",
  },
  {
    title: "Onboard 25 pilot developers",
    status: "Completed",
    target: "May 1",
    actual: "May 12 (11 days late)",
    source: "Dashboard — cohort report",
  },
  {
    title: "Publish integration case study",
    status: "In progress",
    target: "Jul 15",
    actual: "Not completed",
    source: "Forum link pending",
  },
];

const GRANT_DEVIATION_STATEMENT = "No changes to the original plan.";

const GRANT_DASHBOARD_URL = "dashboard.l2ecosystemfund.example/awards/1042";

const GRANT_GITHUB = [
  { label: "Commits", val: "142" },
  { label: "PRs Merged", val: "23" },
  { label: "Active Contributors", val: "6" },
];

const GRANT_SUMMARY =
  "Under the L2 Ecosystem Fund's Builder Grants program, this project has received $100K of a $150K award across two of three tranches; the final $50K tranche remains undisbursed pending the last milestone. Of the funds received, $62K is recorded as utilized, leaving $38K held for the final security audit and integration testing ahead of the v1.1 release. Milestone 1 (SDK integration) shipped five days ahead of target; Milestone 2 (pilot developer onboarding) landed 11 days late; the closing milestone, an integration case study, is in progress against a Jul 15 target. There are no changes to the original plan this period. Full award details are available on the live grant dashboard.";

const KPI_TAB: { key: Mode; label: string }[] = [
  { key: "investor", label: "Investor report" },
  { key: "grant", label: "Grant report" },
];

export function DemoReport() {
  const [mode, setMode] = useState<Mode>("investor");
  const isInvestor = mode === "investor";
  const today = new Date();

  return (
    <>
      {/* Header */}
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 60,
          paddingBottom: 40,
          textAlign: "center",
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.04) 0%, transparent 100%)",
          borderBottom: "1px solid var(--vb-border)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--accent)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          Sample · No signup required
        </p>
        <h1
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: "clamp(32px, 4vw, 48px)",
            fontWeight: 700,
            color: "var(--vb-text)",
            letterSpacing: "-0.03em",
            margin: "0 0 12px",
          }}
        >
          {isInvestor ? "Demo Investor Report" : "Demo Grant Report"}
        </h1>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 16,
            color: "var(--vb-muted)",
            margin: "0 auto 22px",
            maxWidth: 620,
            lineHeight: 1.6,
          }}
        >
          {isInvestor
            ? "See how Vault Brief turns Web3 project data into an investor-ready report. This sample uses real public data from the ENS DAO treasury, rendered through the same report pipeline your own project would use."
            : "See how Vault Brief turns a grant award into a report your funder can verify. This sample uses illustrative figures for a generic builder-grant program, rendered through the same report pipeline your own project would use."}
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link href="/login" className="btn-sm-primary">
            {isInvestor ? "Generate Demo Draft Report" : "Generate Demo Grant Report"}
          </Link>
          <Link
            href="/login"
            className="btn-secondary"
            style={{ padding: "10px 22px", fontSize: 14 }}
          >
            Get started free
          </Link>
        </div>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "var(--vb-dim)",
            margin: "18px auto 0",
            maxWidth: 600,
            lineHeight: 1.5,
          }}
        >
          The demo creates a sample draft report so you can preview the
          format before connecting your own data. Real project reports are
          generated from your connected wallets, GitHub activity, token
          metrics, and project context.
        </p>
      </section>

      {/* Mode toggle */}
      <div
        className="vb-pad-x"
        style={{ display: "flex", justifyContent: "center", marginTop: 32 }}
      >
        <div
          role="tablist"
          aria-label="Demo report type"
          style={{
            display: "inline-flex",
            gap: 4,
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 10,
            padding: 4,
          }}
        >
          {KPI_TAB.map((t) => {
            const active = t.key === mode;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(t.key)}
                style={{
                  border: "none",
                  borderRadius: 7,
                  padding: "9px 20px",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: active ? "rgba(0,232,123,0.14)" : "transparent",
                  color: active ? "var(--accent)" : "var(--vb-muted)",
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Report */}
      <section className="vb-pad-x" style={{ paddingTop: 24, paddingBottom: 100 }}>
        <div
          style={{
            maxWidth: 900,
            margin: "0 auto",
            background: "var(--vb-card)",
            borderRadius: 16,
            border: "1px solid var(--vb-border)",
            overflow: "hidden",
          }}
        >
          {/* Report Header */}
          <div
            style={{
              padding: "32px 40px",
              borderBottom: "1px solid var(--vb-border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 11,
                  color: "var(--vb-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.09em",
                  margin: "0 0 6px",
                }}
              >
                {isInvestor
                  ? "Monthly Investor Report — Demo Draft"
                  : "Grant Report — Demo Draft"}
              </p>
              <h2
                style={{
                  fontFamily:
                    "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                  fontSize: 26,
                  fontWeight: 700,
                  color: "var(--vb-text)",
                  margin: "0 0 4px",
                  letterSpacing: "-0.02em",
                }}
              >
                {isInvestor
                  ? "ENS DAO (real public data)"
                  : `${GRANT_AWARD.grantor} — ${GRANT_AWARD.program} (illustrative)`}
              </h2>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color: "var(--vb-muted)",
                  margin: 0,
                }}
              >
                {`${today.toLocaleDateString("en-US", { month: "long", year: "numeric" })} · Generated ${today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
              </p>
            </div>
            <span
              style={{
                padding: "6px 14px",
                background: "rgba(0,232,123,0.12)",
                color: "var(--accent)",
                borderRadius: 6,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {isInvestor ? "Live ENS data" : "Illustrative sample"}
            </span>
          </div>

          <div style={{ padding: "40px" }}>
            {isInvestor ? (
              <>
                {/* Treasury overview KPI strip */}
                <SectionHeading subtitle="Treasury overview · Runway and burn">
                  At a glance
                </SectionHeading>
                <KpiStrip items={INVESTOR_KPIS} />

                {/* Two-col layout — treasury breakdown + expenses */}
                <div className="vb-grid-2" style={{ gap: 24, marginBottom: 40 }}>
                  <ReportPanel title="Treasury Breakdown">
                    {INVESTOR_BREAKDOWN.map((b) => (
                      <BarRow key={b.label} label={b.label} value={b.usd} pct={b.pct} color={b.color} />
                    ))}
                  </ReportPanel>

                  <ReportPanel title="Expense Breakdown">
                    {INVESTOR_EXPENSES.map((e) => (
                      <BarRow
                        key={e.label}
                        label={e.label}
                        value={e.usd}
                        pct={e.pct}
                        color="#00e87b"
                        barOpacity={0.4 + e.pct / 100}
                      />
                    ))}
                  </ReportPanel>
                </div>

                {/* Token metrics */}
                <SectionHeading subtitle="From Dune Sim and on-chain queries">
                  Token Metrics
                </SectionHeading>
                <MetricGrid items={INVESTOR_TOKEN_METRICS} />

                {/* GitHub activity */}
                <SectionHeading subtitle="From GitHub API">
                  GitHub activity
                </SectionHeading>
                <GithubStrip items={INVESTOR_GITHUB} />

                {/* AI executive summary */}
                <SectionHeading subtitle="AI-written, validated against the source data">
                  Executive Summary
                </SectionHeading>
                <SummaryBlock text={INVESTOR_SUMMARY} />
              </>
            ) : (
              <>
                {/* Award summary KPI strip */}
                <SectionHeading subtitle={`${GRANT_AWARD.grantor} · ${GRANT_AWARD.program} · ${GRANT_AWARD.status}`}>
                  At a glance
                </SectionHeading>
                <KpiStrip items={GRANT_KPIS} />

                {/* Two-col layout — tranche schedule + utilization */}
                <div className="vb-grid-2" style={{ gap: 24, marginBottom: 40 }}>
                  <ReportPanel title="Tranche Schedule">
                    {GRANT_TRANCHES.map((t) => (
                      <BarRow key={t.label} label={t.label} value={`${t.usd} · ${t.status}`} pct={t.pct} color="var(--accent)" />
                    ))}
                  </ReportPanel>

                  <ReportPanel title="Fund Utilization (this award)">
                    {GRANT_UTILIZATION.map((u) => (
                      <BarRow key={u.label} label={u.label} value={u.usd} pct={u.pct} color={u.color} />
                    ))}
                  </ReportPanel>
                </div>

                {/* Leftover funds + plan */}
                <SectionHeading subtitle="Grant-scoped — never a treasury balance">
                  Leftover Funds
                </SectionHeading>
                <div
                  style={{
                    background: "var(--vb-bg)",
                    borderRadius: 12,
                    border: "1px solid var(--vb-border)",
                    padding: 24,
                    marginBottom: 40,
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 15,
                      color: "var(--vb-muted)",
                      lineHeight: 1.7,
                      margin: 0,
                    }}
                  >
                    <strong style={{ color: "var(--vb-text)" }}>$38K</strong>{" "}
                    received but not yet utilized under this award.{" "}
                    <strong style={{ color: "var(--vb-text)" }}>Stated plan:</strong>{" "}
                    {GRANT_LEFTOVER_PLAN}
                  </p>
                </div>

                {/* Milestone progress */}
                <SectionHeading subtitle="Every committed deliverable, whatever its status">
                  Milestone Progress
                </SectionHeading>
                <MilestoneTable items={GRANT_MILESTONES} />

                {/* Plan deviation */}
                <SectionHeading subtitle="A standing statement, every period">
                  Deviation from the Plan
                </SectionHeading>
                <div
                  style={{
                    background: "var(--vb-bg)",
                    borderRadius: 12,
                    border: "1px solid var(--vb-border)",
                    padding: 24,
                    marginBottom: 40,
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 15,
                      color: "var(--vb-muted)",
                      margin: 0,
                    }}
                  >
                    {GRANT_DEVIATION_STATEMENT}
                  </p>
                </div>

                {/* GitHub activity */}
                <SectionHeading subtitle="From GitHub API">
                  GitHub activity
                </SectionHeading>
                <GithubStrip items={GRANT_GITHUB} />

                {/* AI executive summary */}
                <SectionHeading subtitle="AI-written, validated against the source data">
                  Executive Summary
                </SectionHeading>
                <SummaryBlock text={GRANT_SUMMARY} />

                {/* External dashboard */}
                <SectionHeading subtitle="This report is a snapshot — the dashboard is the source of truth">
                  Live Dashboard
                </SectionHeading>
                <div
                  style={{
                    background: "var(--vb-bg)",
                    borderRadius: 12,
                    border: "1px solid var(--vb-border)",
                    padding: 24,
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 13,
                      color: "var(--accent)",
                      margin: 0,
                    }}
                  >
                    {GRANT_DASHBOARD_URL}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Bottom CTA */}
        <div style={{ textAlign: "center", marginTop: 56 }}>
          <p
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 26,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: "0 0 12px",
              letterSpacing: "-0.02em",
            }}
          >
            Want this for your own project?
          </p>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 15,
              color: "var(--vb-muted)",
              margin: "0 auto 24px",
              maxWidth: 540,
              lineHeight: 1.6,
            }}
          >
            {isInvestor
              ? "Connect your treasury wallet and GitHub org to generate an investor report from your own data."
              : "Connect the treasury behind your grant to generate a grant report from your own data."}
          </p>
          <Link href="/login" className="btn-primary">
            Get started free
          </Link>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--vb-dim)",
              marginTop: 14,
            }}
          >
            Free to use.
          </p>
        </div>
      </section>
    </>
  );
}

// ─── shared presentational primitives ──────────────────────────────────────

function SectionHeading({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 16,
          fontWeight: 600,
          color: "var(--vb-text)",
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        {children}
      </h3>
      {subtitle && (
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "var(--vb-dim)",
            margin: "4px 0 0",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

function ReportPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--vb-bg)",
        borderRadius: 12,
        border: "1px solid var(--vb-border)",
        padding: 24,
      }}
    >
      <h3
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 15,
          fontWeight: 600,
          color: "var(--vb-text)",
          margin: "0 0 20px",
        }}
      >
        {title}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function BarRow({
  label,
  value,
  pct,
  color,
  barOpacity,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
  barOpacity?: number;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 6,
          gap: 12,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--vb-muted)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--vb-text)",
            fontWeight: 500,
            textAlign: "right",
            flexShrink: 0,
          }}
        >
          {value}
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            opacity: barOpacity,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}

function KpiStrip({
  items,
}: {
  items: { label: string; val: string; change: string; positive: boolean }[];
}) {
  return (
    <div className="vb-grid-4" style={{ gap: 16, marginBottom: 40 }}>
      {items.map((b) => (
        <div
          key={b.label}
          style={{
            background: "var(--vb-bg)",
            borderRadius: 10,
            padding: "20px 16px",
            border: "1px solid var(--vb-border)",
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
            {b.label}
          </p>
          <p
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: "0 0 4px",
            }}
          >
            {b.val}
          </p>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: b.positive ? "#00e87b" : "#f87171",
              margin: 0,
              fontWeight: 500,
            }}
          >
            {b.change}
          </p>
        </div>
      ))}
    </div>
  );
}

function MetricGrid({
  items,
}: {
  items: { label: string; val: string; note: string }[];
}) {
  return (
    <div className="vb-grid-4" style={{ gap: 16, marginBottom: 40 }}>
      {items.map((m) => (
        <div
          key={m.label}
          style={{
            background: "var(--vb-bg)",
            borderRadius: 10,
            padding: "20px 16px",
            border: "1px solid var(--vb-border)",
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
            {m.label}
          </p>
          <p
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: "0 0 4px",
            }}
          >
            {m.val}
          </p>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--vb-muted)",
              margin: 0,
            }}
          >
            {m.note}
          </p>
        </div>
      ))}
    </div>
  );
}

function GithubStrip({ items }: { items: { label: string; val: string }[] }) {
  return (
    <div
      style={{
        background: "var(--vb-bg)",
        borderRadius: 12,
        border: "1px solid var(--vb-border)",
        padding: 24,
        marginBottom: 40,
      }}
    >
      <div className="vb-grid-3" style={{ gap: 16 }}>
        {items.map((g) => (
          <div key={g.label} style={{ textAlign: "center" }}>
            <p
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: 32,
                fontWeight: 700,
                color: "var(--accent)",
                margin: "0 0 4px",
              }}
            >
              {g.val}
            </p>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                color: "var(--vb-muted)",
                margin: 0,
              }}
            >
              {g.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        background: "var(--vb-bg)",
        borderRadius: 12,
        border: "1px solid var(--vb-border)",
        padding: 24,
        marginBottom: 40,
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 15,
          color: "var(--vb-muted)",
          lineHeight: 1.75,
          margin: 0,
        }}
      >
        {text}
      </p>
    </div>
  );
}

// Milestone progress renders as a table, matching the real product's own
// systemPromptFragment for `grant_milestone_progress` in
// report-sections.ts ("Render as a table — Deliverable, Status, Target
// date, Completed, Slippage").
function MilestoneTable({
  items,
}: {
  items: {
    title: string;
    status: string;
    target: string;
    actual: string;
    source: string;
  }[];
}) {
  return (
    <div
      style={{
        background: "var(--vb-bg)",
        borderRadius: 12,
        border: "1px solid var(--vb-border)",
        padding: 24,
        marginBottom: 40,
        overflowX: "auto",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr>
            {["Deliverable", "Status", "Target", "Completed", "Source of Truth"].map(
              (h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 11,
                    color: "var(--vb-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "0 12px 10px 0",
                    borderBottom: "1px solid var(--vb-border)",
                  }}
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.title}>
              <td
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color: "var(--vb-text)",
                  padding: "10px 12px 10px 0",
                  borderBottom: "1px solid var(--vb-border)",
                }}
              >
                {m.title}
              </td>
              <td
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color: "var(--vb-muted)",
                  padding: "10px 12px 10px 0",
                  borderBottom: "1px solid var(--vb-border)",
                }}
              >
                {m.status}
              </td>
              <td
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color: "var(--vb-muted)",
                  padding: "10px 12px 10px 0",
                  borderBottom: "1px solid var(--vb-border)",
                }}
              >
                {m.target}
              </td>
              <td
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color: "var(--vb-muted)",
                  padding: "10px 12px 10px 0",
                  borderBottom: "1px solid var(--vb-border)",
                }}
              >
                {m.actual}
              </td>
              <td
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color: "var(--accent)",
                  padding: "10px 0 10px 0",
                  borderBottom: "1px solid var(--vb-border)",
                }}
              >
                {m.source}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
