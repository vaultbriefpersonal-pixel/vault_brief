import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Demo Report — Vault Brief",
  description:
    "See what a Vault Brief investor report looks like. Generated from real public on-chain data. No signup required.",
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
          Live Demo
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
          Sample Investor Report
        </h1>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 16,
            color: "var(--vb-muted)",
            margin: "0 0 28px",
          }}
        >
          Generated from public on-chain data. This is exactly what your
          investors receive.
        </p>
        <Link
          href="/login"
          className="btn-sm-primary"
        >
          Start Free Trial
        </Link>
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
                Monthly Investor Report
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
              Auto-generated
            </span>
          </div>

          <div style={{ padding: "40px" }}>
            {/* KPI row */}
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

            {/* Two-col layout */}
            <div
              className="vb-grid-2"
              style={{ gap: 24, marginBottom: 40 }}
            >
              {/* Treasury breakdown */}
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
                  Treasury Breakdown
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {BREAKDOWN.map((b) => (
                    <div key={b.label}>
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
                          {b.label}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-inter), Inter, sans-serif",
                            fontSize: 13,
                            color: "var(--vb-text)",
                            fontWeight: 500,
                          }}
                        >
                          {b.usd}
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
                            width: `${b.pct}%`,
                            background: b.color,
                            borderRadius: 2,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Expenses */}
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
                  Expense Breakdown
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {EXPENSES.map((e) => (
                    <div key={e.label}>
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
                          {e.label}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-inter), Inter, sans-serif",
                            fontSize: 13,
                            color: "var(--vb-text)",
                            fontWeight: 500,
                          }}
                        >
                          {e.usd}
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
                            width: `${e.pct}%`,
                            background: "#00e87b",
                            opacity: 0.4 + e.pct / 100,
                            borderRadius: 2,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* GitHub stats */}
            <div
              style={{
                background: "var(--vb-bg)",
                borderRadius: 12,
                border: "1px solid var(--vb-border)",
                padding: 24,
                marginBottom: 40,
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
                Development Activity
              </h3>
              <div
                className="vb-grid-3"
                style={{ gap: 16 }}
              >
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

            {/* AI narrative sample */}
            <div
              style={{
                background: "var(--vb-bg)",
                borderRadius: 12,
                border: "1px solid var(--vb-border)",
                padding: 24,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <h3
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    margin: 0,
                  }}
                >
                  Executive Summary
                </h3>
                <span
                  style={{
                    padding: "2px 8px",
                    background: "rgba(0,232,123,0.12)",
                    color: "var(--accent)",
                    borderRadius: 4,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  AI Generated
                </span>
              </div>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 15,
                  color: "var(--vb-muted)",
                  lineHeight: 1.75,
                  margin: 0,
                }}
              >
                April was a strong month for Meridian Protocol. Treasury balance
                grew 3.2% to $2.4M, driven primarily by a $120K USDC inflow
                from our partnership agreement with Lattice Finance. Monthly
                burn rate decreased 11.8% to $184K, reflecting the completion
                of a major contractor engagement. At current burn, runway extends
                to 13.1 months — up from 11 months last quarter. Development
                velocity remained high with 247 commits and 38 merged PRs across
                12 active contributors. The protocol's native token appreciated
                18.5% over the month, though liquidity-adjusted treasury
                calculations use a 30% haircut on this position.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
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
            Ready to send reports like this?
          </p>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 15,
              color: "var(--vb-muted)",
              margin: "0 0 24px",
            }}
          >
            Connect your wallets and get your first report in minutes.
          </p>
          <Link
            href="/login"
            className="btn-primary"
          >
            Start Free Trial
          </Link>
        </div>
      </section>
    </div>
  );
}
