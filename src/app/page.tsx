import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, Cable, Sparkles, Send } from "lucide-react";
import { Nav } from "@/components/marketing/Nav";
import { Footer } from "@/components/marketing/Footer";
import { FAQ } from "@/components/marketing/FAQ";
import { ChatWidget } from "@/components/marketing/ChatWidget";
import { db } from "@/server/db";
import { reports, wallets, treasurySnapshots } from "@/server/db/schema";
import { count } from "drizzle-orm";

// Icon-key → lucide component. Keeps the STEPS constant plain-data while
// the render block looks up the right glyph. New steps just add a key.
const STEP_ICONS = {
  connect: Wallet,
  sync: Cable,
  ai: Sparkles,
  send: Send,
} as const;

export const metadata: Metadata = {
  title: "Vault Brief — Investor Reports for Web3 Teams",
  description:
    "Generate monthly treasury reports from wallets, GitHub activity, and token metrics. Vault Brief turns raw on-chain data into investor-ready reports you can review, export, and send.",
};

// Re-render the homepage at most every 5 minutes so the stat strip's
// counts grow without hammering the DB on every visit. Static otherwise.
export const revalidate = 300;

// Two columns: features that ship today vs. the explicit roadmap. We
// chose to surface the roadmap rather than hide it — early-access users
// trust the product more when the gap between marketing and reality is
// not a discovery moment three weeks in.
const FEATURES_AVAILABLE = [
  {
    icon: "💼",
    title: "Treasury tracking",
    desc: "Track balances, inflows, outflows, and runway across project wallets.",
  },
  {
    icon: "💻",
    title: "GitHub activity",
    desc: "Summarize commits, merged PRs, contributors, and releases for investor updates.",
  },
  {
    icon: "🤖",
    title: "AI report narrative",
    desc: "Turn treasury and development data into a structured investor report.",
  },
  {
    icon: "📄",
    title: "PDF export",
    desc: "Export a polished report that can be shared with investors or internal stakeholders.",
  },
  {
    icon: "📊",
    title: "Token metrics",
    desc: "Include token price, market cap, holder count, and liquidity context where available.",
  },
  {
    icon: "✅",
    title: "Review before send",
    desc: "Nothing goes out automatically without user approval.",
  },
];

const FEATURES_COMING = [
  { icon: "🌐", title: "Investor portal", desc: "Read-only dashboard per investor instead of email-only delivery." },
  { icon: "📬", title: "Open and click tracking", desc: "Per-recipient engagement on every report you send." },
  { icon: "🔌", title: "API access", desc: "Programmatic report generation and export for fund operators." },
  { icon: "🎨", title: "White label reports", desc: "Branded PDFs without the Vault Brief footer." },
  { icon: "⏰", title: "Advanced monthly automation", desc: "Schedules, multi-recipient routing, conditional sends." },
];

// Each step keys to a lucide icon imported below. "iconKey" is a string
// rather than the component itself so the constant stays plain-data and
// the actual icon resolution happens in the render block.
const STEPS = [
  {
    num: "01",
    iconKey: "connect" as const,
    title: "Connect",
    desc:
      "Add your treasury wallets — multisig, EOA, or exchange — across 20+ chains. Connect a GitHub org for dev metrics. Two minutes, no read-write keys ever.",
  },
  {
    num: "02",
    iconKey: "sync" as const,
    title: "We pull the data",
    desc:
      "Balances pulled from Alchemy + Dune + Helius, on-chain transactions classified into expense categories, and GitHub commit / PR / contributor activity snapshotted. Cached aggressively so re-runs are free.",
  },
  {
    num: "03",
    iconKey: "ai" as const,
    title: "AI writes the report",
    desc:
      "An LLM (Claude or Gemini, via OpenRouter) reads the snapshot — current treasury, prior month, anomalies, milestones — and produces a structured Markdown narrative. Numbers are validated against the source data; the model can't fabricate a balance.",
  },
  {
    num: "04",
    iconKey: "send" as const,
    title: "Review and send",
    desc:
      "Edit anything in the in-app Markdown editor. Mark Ready → Send. Investors get a branded PDF + an email with key KPIs already inline.",
  },
];

const STATS_FALLBACK = { reports: 0, wallets: 0, snapshots: 0 };

// Cheap signal that the env is using the .env.example placeholder URL —
// CI / preview deploys often fall in this bucket. Skip the network round-
// trip rather than letting it fail and dump a stack into the logs.
function dbConfigured(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return Boolean(url) && !url.includes("placeholder");
}

let warnedFallback = false;

async function loadPublicStats() {
  if (!dbConfigured()) return STATS_FALLBACK;
  try {
    const [r] = await db.select({ n: count() }).from(reports);
    const [w] = await db.select({ n: count() }).from(wallets);
    const [s] = await db.select({ n: count() }).from(treasurySnapshots);
    return {
      reports: r?.n ?? 0,
      wallets: w?.n ?? 0,
      snapshots: s?.n ?? 0,
    };
  } catch (err) {
    if (!warnedFallback) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[landing] loadPublicStats fallback: ${msg.split("\n")[0]}`);
      warnedFallback = true;
    }
    return STATS_FALLBACK;
  }
}

const TOOL_STACK: Array<{ name: string; color: string }> = [
  { name: "Alchemy", color: "#0C0C0E" },
  { name: "Dune", color: "#FE6F37" },
  { name: "Helius", color: "#B8FF36" },
  { name: "OpenRouter", color: "#10A37F" },
  { name: "Resend", color: "#FFFFFF" },
  { name: "Neon", color: "#00E599" },
  { name: "Vercel", color: "#FFFFFF" },
  { name: "Stripe", color: "#635BFF" },
];

// "Input → report" pillar columns. Drives the new visual section that
// lets a visitor parse the product in 5 seconds without reading copy.
const INPUT_TO_REPORT = {
  inputs: [
    { label: "Wallets", note: "Treasury addresses across 20+ chains" },
    { label: "GitHub org", note: "Commits, PRs, contributors, releases" },
    { label: "Token contract", note: "Price, market cap, holder count" },
    { label: "Project context", note: "Milestones, funding, asks, governance" },
  ],
  outputs: [
    { label: "Treasury overview", note: "Balances + month-over-month change" },
    { label: "Burn and runway", note: "Net outflow + months at current pace" },
    { label: "GitHub progress", note: "Active dev signal for the period" },
    { label: "Executive summary", note: "AI-written, validated against source data" },
    { label: "PDF export", note: "Branded, investor-ready, click to download" },
  ],
};

export default async function LandingPage() {
  const stats = await loadPublicStats();
  return (
    <div style={{ background: "var(--vb-bg)", minHeight: "100dvh" }}>
      <Nav />

      {/* Hero */}
      <section
        className="vb-section-hero"
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          position: "relative",
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.06) 0%, transparent 60%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.03,
            backgroundImage:
              "linear-gradient(#888 1px, transparent 1px), linear-gradient(90deg, #888 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            pointerEvents: "none",
          }}
        />

        <div className="animate-fade-up" style={{ position: "relative", zIndex: 1 }}>
          {/* Beta badge: honest framing per the early-access strategy. */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(0,232,123,0.12)",
              border: "1px solid rgba(0,232,123,0.3)",
              borderRadius: 100,
              padding: "6px 16px",
              marginBottom: 32,
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--accent)",
              fontWeight: 500,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#00e87b",
              }}
            />
            Private beta · Automated wallet and GitHub reporting
          </div>

          <h1
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: "clamp(40px, 5.5vw, 76px)",
              lineHeight: 1.05,
              color: "var(--vb-text)",
              maxWidth: 800,
              margin: "0 auto 24px",
              letterSpacing: "-0.035em",
            }}
          >
            Investor reports
            <br />
            <span className="gradient-text">for Web3 teams</span>
          </h1>

          <p
            className="vb-hero-copy"
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              lineHeight: 1.6,
              color: "var(--vb-muted)",
              maxWidth: 600,
              margin: "0 auto 44px",
            }}
          >
            Generate monthly treasury reports from wallets, GitHub activity, and
            token metrics. Vault Brief turns raw on-chain data into
            investor-ready reports you can review, export, and send.
          </p>

          <div
            style={{
              display: "flex",
              gap: 14,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            {/* Demo first — early users need to see output before committing.
                Trial is the secondary CTA per the conversion strategy. */}
            <Link href="/demo" className="btn-primary">
              Generate Demo Report
            </Link>
            <Link href="/login" className="btn-secondary">
              Start Free Trial
            </Link>
          </div>
        </div>

        {/* Mock dashboard card */}
        <div
          className="animate-fade-up-delay"
          style={{
            marginTop: 72,
            width: "100%",
            maxWidth: 900,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              background: "var(--vb-card)",
              borderRadius: 16,
              border: "1px solid var(--vb-border)",
              padding: 32,
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 24,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--vb-dim)",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    marginBottom: 4,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {`Monthly Report — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    color: "var(--vb-text)",
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontWeight: 600,
                  }}
                >
                  Treasury Overview
                </div>
              </div>
              <span
                style={{
                  padding: "5px 12px",
                  background: "rgba(0,232,123,0.12)",
                  color: "var(--accent)",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                }}
              >
                Ready to Send
              </span>
            </div>

            <div className="vb-grid-4" style={{ gap: 16 }}>
              {[
                { label: "Total Balance", val: "$2.4M", change: "+3.2%" },
                { label: "Monthly Burn", val: "$185K", change: "-12%" },
                { label: "Runway", val: "13 months", change: "+2mo" },
                { label: "Token Price", val: "$0.84", change: "+18.5%" },
              ].map((d) => (
                <div
                  key={d.label}
                  style={{
                    background: "var(--vb-bg)",
                    borderRadius: 10,
                    padding: "18px 16px",
                    border: "1px solid var(--vb-border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--vb-dim)",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      marginBottom: 8,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {d.label}
                  </div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: "var(--vb-text)",
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    }}
                  >
                    {d.val}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: d.change.startsWith("+") ? "#00e87b" : "#f87171",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      marginTop: 4,
                      fontWeight: 500,
                    }}
                  >
                    {d.change} vs last month
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Input → report — the 5-second-comprehension section. Two columns
          read like a state diagram: stuff you connect on the left becomes
          the structured report on the right. */}
      <section className="vb-section" style={{ background: "var(--vb-alt)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--accent)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 600,
              }}
            >
              Input to report
            </p>
            <h2
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: "clamp(28px, 3.6vw, 40px)",
                fontWeight: 700,
                color: "var(--vb-text)",
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              What goes in. What comes out.
            </h2>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              gap: 24,
              alignItems: "stretch",
            }}
          >
            <PillarColumn
              kind="input"
              title="You connect"
              items={INPUT_TO_REPORT.inputs}
            />

            <div
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                color: "var(--accent)",
                opacity: 0.6,
              }}
            >
              →
            </div>

            <PillarColumn
              kind="output"
              title="Investor report"
              items={INPUT_TO_REPORT.outputs}
            />
          </div>
        </div>
      </section>

      {/* Logo bar */}
      <section
        className="vb-section-sm"
        style={{
          textAlign: "center",
          borderTop: "1px solid var(--vb-border)",
          borderBottom: "1px solid var(--vb-border)",
        }}
      >
        <p
          style={{
            fontSize: 12,
            color: "var(--vb-dim)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            marginBottom: 32,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 500,
          }}
        >
          Built on the stack you already trust
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 28,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {TOOL_STACK.map((t) => (
            <span
              key={t.name}
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: 14,
                fontWeight: 600,
                color: t.color,
                letterSpacing: "-0.01em",
                padding: "8px 16px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {t.name}
            </span>
          ))}
        </div>
      </section>

      {/* Features — split into Available now / Coming soon for honesty.
          Coming-soon block is dimmer + carries explicit badges so visitors
          aren't surprised when they don't find a feature on first login. */}
      <section
        id="features"
        className="vb-section"
        style={{ maxWidth: 1200, margin: "0 auto" }}
      >
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <p
            style={{
              fontSize: 13,
              color: "var(--accent)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 600,
            }}
          >
            Available now
          </p>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(32px, 4vw, 44px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              margin: 0,
            }}
          >
            What ships today
          </h2>
        </div>

        <div className="vb-grid-3" style={{ gap: 16 }}>
          {FEATURES_AVAILABLE.map((f) => (
            <FeatureCard key={f.title} {...f} status="available" />
          ))}
        </div>

        <div
          style={{
            textAlign: "center",
            marginTop: 96,
            marginBottom: 56,
          }}
        >
          <p
            style={{
              fontSize: 13,
              color: "var(--vb-dim)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 600,
            }}
          >
            Coming soon
          </p>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(28px, 3.4vw, 36px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              margin: 0,
            }}
          >
            On the roadmap
          </h2>
        </div>

        <div className="vb-grid-3" style={{ gap: 16 }}>
          {FEATURES_COMING.map((f) => (
            <FeatureCard key={f.title} {...f} status="coming" />
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="vb-section" style={{ background: "var(--vb-alt)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 72 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--accent)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 600,
              }}
            >
              How it works
            </p>
            <h2
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: "clamp(32px, 4vw, 44px)",
                fontWeight: 700,
                color: "var(--vb-text)",
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              Four steps. Zero spreadsheets.
            </h2>
          </div>

          <div className="vb-grid-4" style={{ gap: 24 }}>
            {STEPS.map((s) => {
              const Icon = STEP_ICONS[s.iconKey];
              return (
                <div key={s.num}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: "rgba(0,232,123,0.08)",
                        border: "1px solid rgba(0,232,123,0.18)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon
                        size={18}
                        color="var(--accent)"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </div>
                    <span
                      style={{
                        fontFamily:
                          "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                        fontSize: 28,
                        fontWeight: 700,
                        color: "var(--accent)",
                        opacity: 0.4,
                        lineHeight: 1,
                      }}
                    >
                      {s.num}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                      fontSize: 20,
                      fontWeight: 600,
                      color: "var(--vb-text)",
                      margin: "0 0 10px",
                    }}
                  >
                    {s.title}
                  </h3>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 15,
                      color: "var(--vb-muted)",
                      lineHeight: 1.6,
                      margin: 0,
                    }}
                  >
                    {s.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Early access metrics — was "Built in public / Live numbers". The
          rename keeps the same data but reframes it as honest beta usage
          rather than positioning low counts as social proof. */}
      <section className="vb-section" style={{ background: "var(--vb-alt)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--accent)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 600,
              }}
            >
              Early access metrics
            </p>
            <h2
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: "clamp(32px, 4vw, 44px)",
                fontWeight: 700,
                color: "var(--vb-text)",
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              Real usage, updated from production
            </h2>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 15,
                color: "var(--vb-muted)",
                marginTop: 16,
                maxWidth: 600,
                margin: "16px auto 0",
                lineHeight: 1.6,
              }}
            >
              Vault Brief is in private beta. Core reporting flows are live;
              advanced automation features are rolling out gradually. These
              numbers update from production usage every five minutes.
            </p>
          </div>

          <div className="vb-grid-4" style={{ gap: 20 }}>
            {[
              { value: "20+", label: "Chains supported", note: "Ethereum + L2s + Solana" },
              {
                value: stats.wallets.toLocaleString(),
                label: "Wallets tracked",
                note: "across all projects",
              },
              {
                value: stats.snapshots.toLocaleString(),
                label: "Snapshots generated",
                note: "balances · flows · GitHub",
              },
              {
                value: stats.reports.toLocaleString(),
                label: "Reports generated",
                note: "AI narratives shipped",
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: "var(--vb-card)",
                  borderRadius: 14,
                  border: "1px solid var(--vb-border)",
                  padding: "28px 24px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 36,
                    fontWeight: 700,
                    color: "var(--accent)",
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                  }}
                >
                  {s.value}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    marginTop: 10,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 12,
                    color: "var(--vb-dim)",
                    marginTop: 4,
                  }}
                >
                  {s.note}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <FAQ />

      {/* CTA Banner — final conversion. Demo-first to mirror the hero. */}
      <section
        className="vb-section-cta"
        style={{
          textAlign: "center",
          background: "var(--vb-alt)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,232,123,0.12) 0%, transparent 70%)",
            filter: "blur(60px)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(32px, 4vw, 44px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              margin: "0 0 16px",
            }}
          >
            Stop copy-pasting from Etherscan
          </h2>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 17,
              color: "var(--vb-muted)",
              maxWidth: 540,
              margin: "0 auto 36px",
              lineHeight: 1.6,
            }}
          >
            Connect a wallet and generate your first investor report in minutes.
            Schedule recurring monthly reports after review.
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/demo"
              className="btn-primary"
              style={{ padding: "16px 40px" }}
            >
              Generate Demo Report
            </Link>
            <Link
              href="/login"
              className="btn-secondary"
              style={{ padding: "16px 32px" }}
            >
              Start Free Trial
            </Link>
          </div>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--vb-dim)",
              marginTop: 18,
            }}
          >
            No credit card required.
          </p>
        </div>
      </section>

      <Footer />
      <ChatWidget />
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function FeatureCard({
  icon,
  title,
  desc,
  status,
}: {
  icon: string;
  title: string;
  desc: string;
  status: "available" | "coming";
}) {
  const isAvailable = status === "available";
  return (
    <div
      className="card-hover"
      style={{
        background: "var(--vb-card)",
        borderRadius: 14,
        border: `1px solid ${isAvailable ? "var(--vb-border)" : "rgba(255,255,255,0.06)"}`,
        padding: 32,
        opacity: isAvailable ? 1 : 0.85,
        position: "relative",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "3px 8px",
          borderRadius: 100,
          background: isAvailable
            ? "rgba(0,232,123,0.12)"
            : "rgba(255,255,255,0.05)",
          color: isAvailable ? "var(--accent)" : "var(--vb-dim)",
          border: `1px solid ${isAvailable ? "rgba(0,232,123,0.3)" : "rgba(255,255,255,0.08)"}`,
        }}
      >
        {isAvailable ? "Available" : "Coming soon"}
      </span>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: isAvailable
            ? "rgba(0,232,123,0.12)"
            : "rgba(255,255,255,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          marginBottom: 18,
        }}
      >
        {icon}
      </div>
      <h3
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 19,
          fontWeight: 600,
          color: "var(--vb-text)",
          margin: "0 0 8px",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 15,
          color: "var(--vb-muted)",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {desc}
      </p>
    </div>
  );
}

function PillarColumn({
  kind,
  title,
  items,
}: {
  kind: "input" | "output";
  title: string;
  items: { label: string; note: string }[];
}) {
  return (
    <div
      style={{
        background: "var(--vb-card)",
        border: "1px solid var(--vb-border)",
        borderRadius: 14,
        padding: 24,
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          color: kind === "output" ? "var(--accent)" : "var(--vb-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 600,
          margin: "0 0 6px",
        }}
      >
        {kind === "output" ? "Output" : "Input"}
      </p>
      <h3
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 22,
          fontWeight: 700,
          color: "var(--vb-text)",
          margin: "0 0 18px",
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h3>
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
        {items.map((it) => (
          <li
            key={it.label}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "10px 12px",
              background:
                kind === "output"
                  ? "rgba(0,232,123,0.05)"
                  : "rgba(255,255,255,0.02)",
              border: `1px solid ${kind === "output" ? "rgba(0,232,123,0.18)" : "var(--vb-border)"}`,
              borderRadius: 8,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: kind === "output" ? "var(--accent)" : "var(--vb-muted)",
                marginTop: 1,
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 12,
                opacity: 0.8,
              }}
            >
              {kind === "output" ? "↳" : "•"}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily:
                    "var(--font-inter), Inter, sans-serif",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--vb-text)",
                }}
              >
                {it.label}
              </div>
              <div
                style={{
                  fontFamily:
                    "var(--font-inter), Inter, sans-serif",
                  fontSize: 12,
                  color: "var(--vb-dim)",
                  marginTop: 2,
                  lineHeight: 1.5,
                }}
              >
                {it.note}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
