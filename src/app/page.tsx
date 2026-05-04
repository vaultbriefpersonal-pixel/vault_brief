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
  title: "Vault Brief — Automated Investor Reporting for Web3",
  description:
    "Connect wallets and GitHub once. Every month, Vault Brief pulls your data, writes the narrative, and sends polished PDF reports to investors.",
};

// Re-render the homepage at most every 5 minutes so the stat strip's
// counts grow without hammering the DB on every visit. Static otherwise.
export const revalidate = 300;

const FEATURES = [
  {
    icon: "⛓",
    title: "Multi-Chain Treasury Tracking",
    desc: "Connect wallets across Ethereum, Solana, Arbitrum, Base, and 15+ chains. Balances, token positions, and transaction history sync automatically.",
  },
  {
    icon: "🤖",
    title: "AI-Written Narratives",
    desc: "Claude turns raw numbers into investor-ready prose. Expense classification, burn analysis, and development summaries — all generated.",
  },
  {
    icon: "📄",
    title: "One-Click PDF Export",
    desc: "Branded reports with your logo, colors, and formatting. Download or send directly to your investor list.",
  },
  {
    icon: "💻",
    title: "GitHub Activity Reports",
    desc: "Commits, PRs merged, active contributors, and release notes pulled from your connected repos automatically.",
  },
  {
    icon: "📊",
    title: "Token Metrics Dashboard",
    desc: "Price, market cap, holder count, and vesting schedule tracked and included in every report.",
  },
  {
    icon: "📬",
    title: "Automated Distribution",
    desc: "Reports go out on the 1st of every month. Investors get email with PDF attached. Track opens and engagement.",
  },
];

// Each step keys to a lucide icon imported below. "iconKey" is a string
// rather than the component itself so the constant stays plain-data and
// the actual icon resolution happens in the render block. Copy aims to
// name the real machinery (Alchemy / Dune / Helius / OpenRouter) so the
// section reads as "here's the engineering" rather than "the magic
// happens behind the curtain."
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
      "On the 1st of each month we pull balances from Alchemy + Dune + Helius, classify on-chain transactions into expense categories, and snapshot GitHub commit / PR / contributor activity. Cached aggressively so re-runs are free.",
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
      "Edit anything in the in-app Markdown editor. Mark Ready → Send. Investors get a branded PDF + an email with key KPIs already inline. Open / click tracking via Resend webhooks.",
  },
];

// Replaces the original three placeholder testimonials. The numbers come
// straight from the production DB (reports, wallets, treasury_snapshots);
// "20+ chains" is hard-coded because the support list is in `chains.ts`
// and the count rarely changes mid-month. Pattern matches the rest of the
// site: hide-when-zero / no-fake-padding (see /status past incidents and
// the dashboard sync warnings).
const STATS_FALLBACK = { reports: 0, wallets: 0, snapshots: 0 };
async function loadPublicStats() {
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
    // DB not reachable from a marketing edge cache — render fallbacks
    // rather than 500ing the homepage. Logged for ops visibility.
    console.warn("loadPublicStats: falling back to zeros", err);
    return STATS_FALLBACK;
  }
}

// The actual stack the product runs on. Renders as colored brand chips in
// the "Built on the stack you already trust" strip — replaces the original
// fake-DAO logo placeholders. Each chip uses the tool's brand color so the
// row reads as a real engineering manifest, not generic "powered by" filler.
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

export default async function LandingPage() {
  // "/" always renders the marketing landing — even for logged-in users.
  // The marketing Nav surfaces a "Dashboard" link when a session is present
  // so authenticated users can jump back to /projects without reloading.
  // Decision history: an earlier version auto-redirected logged-in users
  // to /projects, but that broke our own ability to view marketing while
  // signed in (and made share-links to / from inside the app land back on
  // the dashboard, never showing the actual landing). Net: keep "/" as a
  // public surface; navigation does the rest.
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
        {/* Grid pattern */}
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

        <div
          className="animate-fade-up"
          style={{ position: "relative", zIndex: 1 }}
        >
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
            Automated crypto investor reporting
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
            Your treasury reports,
            <br />
            <span className="gradient-text">on autopilot</span>
          </h1>

          <p
            className="vb-hero-copy"
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              lineHeight: 1.6,
              color: "var(--vb-muted)",
              maxWidth: 540,
              margin: "0 auto 44px",
            }}
          >
            Connect wallets and GitHub once. Every month, Vault Brief pulls your
            data, writes the narrative, and sends polished PDF reports to
            investors.
          </p>

          <div
            style={{
              display: "flex",
              gap: 14,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/login"
              className="btn-primary"
            >
              Start Free Trial
            </Link>
            <Link
              href="/demo"
              className="btn-secondary"
            >
              View Demo Report
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

            <div
              className="vb-grid-4"
              style={{ gap: 16 }}
            >
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

      {/* Features */}
      <section
        id="features"
        className="vb-section"
        style={{ maxWidth: 1200, margin: "0 auto" }}
      >
        <div style={{ textAlign: "center", marginBottom: 64 }}>
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
            Features
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
            Everything you need to report
          </h2>
        </div>

        <div
          className="vb-grid-3"
          style={{ gap: 16 }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="card-hover"
              style={{
                background: "var(--vb-card)",
                borderRadius: 14,
                border: "1px solid var(--vb-border)",
                padding: 32,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: "rgba(0,232,123,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  marginBottom: 18,
                }}
              >
                {f.icon}
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
                {f.title}
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
                {f.desc}
              </p>
            </div>
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

          <div
            className="vb-grid-4"
            style={{ gap: 24 }}
          >
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

      {/* Built in public — replaces the testimonials section.
          Numbers come from the live DB (revalidate every 5 min); chains
          count is static because it's pinned to chains.ts. */}
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
              Built in public
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
              Live numbers, not paid quotes
            </h2>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 15,
                color: "var(--vb-muted)",
                marginTop: 16,
                maxWidth: 540,
                margin: "16px auto 0",
                lineHeight: 1.6,
              }}
            >
              We&apos;re early. Instead of fake testimonials, here&apos;s
              what the system has actually done so far. Updated every five
              minutes from the production database.
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
                label: "Monthly snapshots",
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

      {/* CTA Banner */}
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
              maxWidth: 480,
              margin: "0 auto 36px",
              lineHeight: 1.6,
            }}
          >
            Set up in 5 minutes. Your first report generates automatically next
            month.
          </p>
          <Link
            href="/login"
            className="btn-primary"
            style={{ padding: "16px 40px" }}
          >
            Start Free Trial
          </Link>
        </div>
      </section>

      <Footer />
      <ChatWidget />
    </div>
  );
}
