import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Demo Investor Report — Vault Brief",
  description:
    "See how Vault Brief turns Web3 project data into an investor-ready report. This sample shows the structure your own report can follow.",
};

const BALANCES = [
  { label: "Total Balance", val: "$2,418,340", change: "+3.2%", positive: true },
  { label: "Monthly Burn", val: "$184,200", change: "-11.8%", positive: true },
  { label: "Runway", val: "13.1 months", change: "+2.1mo", positive: true },
  { label: "Token Price", val: "$0.84", change: "+18.5%", positive: true },
];

const BREAKDOWN = [
  { label: "Stablecoins (USDC, USDT)", pct: 42, usd: "$1,015,703", color: "var(--accent)" },
  { label: "ETH", pct: 28, usd: "$677,135", color: "#4f9cf9" },
  { label: "Native Token (PROJ)", pct: 22, usd: "$532,035", color: "#a78bfa" },
  { label: "Other Assets", pct: 8, usd: "$193,467", color: "var(--vb-dim)" },
];

const EXPENSES = [
  { label: "Payroll", pct: 58, usd: "$106,836" },
  { label: "Infrastructure", pct: 19, usd: "$34,998" },
  { label: "Marketing", pct: 12, usd: "$22,104" },
  { label: "Grants", pct: 7, usd: "$12,894" },
  { label: "Legal", pct: 4, usd: "$7,368" },
];

const GITHUB = [
  { label: "Commits", val: "247" },
  { label: "PRs Merged", val: "38" },
  { label: "Active Contributors", val: "12" },
];

// Sample token metrics. Mirrors what the live product shows when a
// project supplies a token contract — price + market cap + holder
// count come from Dune Sim, vesting cliff date is project-supplied.
const TOKEN_METRICS = [
  { label: "Token Price", val: "$0.84", note: "+18.5% MoM" },
  { label: "Market Cap", val: "$84.0M", note: "Fully diluted: $210M" },
  { label: "Holders", val: "12,847", note: "+412 this period" },
  { label: "Next Unlock", val: "Aug 2026", note: "5% to team + advisors" },
];

// Real production data sources, surfaced so a visitor sees the engineering
// behind the polished output rather than an opaque "AI does it" promise.
const DATA_SOURCES = [
  {
    label: "Alchemy + Helius",
    note: "EVM and Solana RPC for wallet balances and transaction history",
  },
  { label: "Dune Sim", note: "Token price, market cap, holder count, liquidity" },
  { label: "GitHub API", note: "Commits, merged PRs, active contributors, releases" },
  { label: "OpenRouter (Claude / Gemini)", note: "AI report narrative generation" },
  { label: "Snapshot.org", note: "On-chain governance proposals (when configured)" },
];

export default function DemoPage() {
  return (
    <div style={{ paddingTop: 72 }}>
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
          Demo Investor Report
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
          See how Vault Brief turns Web3 project data into an investor-ready
          report. This sample uses demo-style data and shows the structure
          your own report can follow.
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
            Generate Demo Draft Report
          </Link>
          <Link
            href="/login"
            className="btn-secondary"
            style={{ padding: "10px 22px", fontSize: 14 }}
          >
            Start Free Trial
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

      {/* Report */}
      <section className="vb-pad-x" style={{ paddingTop: 48, paddingBottom: 100 }}>
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
                Monthly Investor Report — Demo Draft
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
                Project Meridian
              </h2>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color: "var(--vb-muted)",
                  margin: 0,
                }}
              >
                {`${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })} · Generated ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
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
              Sample data
            </span>
          </div>

          <div style={{ padding: "40px" }}>
            {/* Treasury overview KPI strip */}
            <SectionHeading subtitle="Treasury overview · Runway and burn">
              At a glance
            </SectionHeading>
            <div
              className="vb-grid-4"
              style={{ gap: 16, marginBottom: 40 }}
            >
              {BALANCES.map((b) => (
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
                    {b.change} vs last month
                  </p>
                </div>
              ))}
            </div>

            {/* Two-col layout — treasury breakdown + expenses */}
            <div
              className="vb-grid-2"
              style={{ gap: 24, marginBottom: 40 }}
            >
              <ReportPanel title="Treasury Breakdown">
                {BREAKDOWN.map((b) => (
                  <BarRow key={b.label} label={b.label} value={b.usd} pct={b.pct} color={b.color} />
                ))}
              </ReportPanel>

              <ReportPanel title="Expense Breakdown">
                {EXPENSES.map((e) => (
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
            <div
              className="vb-grid-4"
              style={{
                gap: 16,
                marginBottom: 40,
              }}
            >
              {TOKEN_METRICS.map((m) => (
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

            {/* GitHub activity */}
            <SectionHeading subtitle="From GitHub API">
              GitHub activity
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
              <div className="vb-grid-3" style={{ gap: 16 }}>
                {GITHUB.map((g) => (
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

            {/* AI executive summary */}
            <SectionHeading subtitle="AI-written, validated against the source data">
              Executive Summary
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
                  lineHeight: 1.75,
                  margin: 0,
                }}
              >
                April was a strong month for Meridian Protocol. Treasury
                balance grew 3.2% to $2.4M, driven primarily by a $120K USDC
                inflow from our partnership agreement with Lattice Finance.
                Monthly burn rate decreased 11.8% to $184K, reflecting the
                completion of a major contractor engagement. At current burn,
                runway extends to 13.1 months — up from 11 months last
                quarter. Development velocity remained high with 247 commits
                and 38 merged PRs across 12 active contributors. The
                protocol&apos;s native token appreciated 18.5% over the month,
                though liquidity-adjusted treasury calculations use a 30%
                haircut on this position.
              </p>
            </div>

            {/* Data sources used — anchors the polished output to a real
                engineering manifest, not magic. */}
            <SectionHeading subtitle="Where each section pulls from">
              Data sources used
            </SectionHeading>
            <div
              style={{
                background: "var(--vb-bg)",
                borderRadius: 12,
                border: "1px solid var(--vb-border)",
                padding: 24,
              }}
            >
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {DATA_SOURCES.map((s) => (
                  <li
                    key={s.label}
                    style={{
                      display: "flex",
                      gap: 14,
                      alignItems: "baseline",
                      borderLeft: "2px solid rgba(0,232,123,0.4)",
                      paddingLeft: 14,
                    }}
                  >
                    <span
                      style={{
                        fontFamily:
                          "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--vb-text)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        fontSize: 13,
                        color: "var(--vb-muted)",
                        lineHeight: 1.5,
                      }}
                    >
                      {s.note}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
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
            Connect your treasury wallet and GitHub org to generate an
            investor report from your own data.
          </p>
          <Link href="/login" className="btn-primary">
            Start Free Trial
          </Link>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--vb-dim)",
              marginTop: 14,
            }}
          >
            No credit card required.
          </p>
        </div>
      </section>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

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
