import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/marketing/Nav";
import { Footer } from "@/components/marketing/Footer";
import { FAQ } from "@/components/marketing/FAQ";

export const metadata: Metadata = {
  title: "VaultBrief — Automated Investor Reporting for Web3",
  description:
    "Connect wallets and GitHub once. Every month, VaultBrief pulls your data, writes the narrative, and sends polished PDF reports to investors.",
};

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

const STEPS = [
  {
    num: "01",
    title: "Connect",
    desc: "Link your wallets and GitHub repos. Takes about 2 minutes. We support 15+ chains and any GitHub org.",
  },
  {
    num: "02",
    title: "We pull the data",
    desc: "On the 1st of each month, VaultBrief syncs balances, transactions, dev activity, and token metrics automatically.",
  },
  {
    num: "03",
    title: "AI writes the report",
    desc: "Expenses are classified, burn rate calculated, and a readable narrative is generated from your data.",
  },
  {
    num: "04",
    title: "Review and send",
    desc: "Edit anything you want, add a personal note, hit send. Investors get a polished PDF in their inbox.",
  },
];

const TESTIMONIALS = [
  {
    text: "We used to spend 8 hours every month pulling data from Etherscan and formatting Google Docs. Now it is 15 minutes of review.",
    author: "Sarah Chen",
    role: "CFO, Meridian Protocol",
  },
  {
    text: "Our investors actually read the reports now. The AI narratives are surprisingly good — we barely edit them.",
    author: "Marcus Rivera",
    role: "Co-founder, Lattice Finance",
  },
  {
    text: "The multi-chain tracking alone is worth it. Having everything in one place changed how we think about treasury ops.",
    author: "Anika Patel",
    role: "Head of Finance, Prism DAO",
  },
];

const LOGOS = ["Meridian Protocol", "Lattice DAO", "Prism Finance", "Atlas Labs", "Nova Network", "Cascade Finance"];

export default function LandingPage() {
  return (
    <div style={{ background: "#0a0a0a", minHeight: "100dvh" }}>
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
              color: "#00e87b",
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
              color: "#f0f0f0",
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
              color: "#888888",
              maxWidth: 540,
              margin: "0 auto 44px",
            }}
          >
            Connect wallets and GitHub once. Every month, VaultBrief pulls your
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
              background: "#161616",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.08)",
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
                    color: "#555555",
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
                    color: "#f0f0f0",
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
                  color: "#00e87b",
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
                    background: "#0a0a0a",
                    borderRadius: 10,
                    padding: "18px 16px",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#555555",
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
                      color: "#f0f0f0",
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
          borderTop: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <p
          style={{
            fontSize: 12,
            color: "#555555",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            marginBottom: 32,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 500,
          }}
        >
          Used by crypto projects worldwide
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 56,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {LOGOS.map((l) => (
            <span
              key={l}
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: 15,
                fontWeight: 600,
                color: "#555555",
                letterSpacing: "-0.01em",
              }}
            >
              {l}
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
              color: "#00e87b",
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
              color: "#f0f0f0",
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
                background: "#161616",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.08)",
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
                  color: "#f0f0f0",
                  margin: "0 0 8px",
                  letterSpacing: "-0.01em",
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 14.5,
                  color: "#888888",
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
      <section className="vb-section" style={{ background: "#111111" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 72 }}>
            <p
              style={{
                fontSize: 13,
                color: "#00e87b",
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
                color: "#f0f0f0",
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
            {STEPS.map((s) => (
              <div key={s.num}>
                <div
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 64,
                    fontWeight: 700,
                    color: "#00e87b",
                    opacity: 0.25,
                    lineHeight: 1,
                    marginBottom: 16,
                  }}
                >
                  {s.num}
                </div>
                <h3
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "#f0f0f0",
                    margin: "0 0 10px",
                  }}
                >
                  {s.title}
                </h3>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14.5,
                    color: "#888888",
                    lineHeight: 1.6,
                    margin: 0,
                  }}
                >
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="vb-section" style={{ background: "#111111" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <p
              style={{
                fontSize: 13,
                color: "#00e87b",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 600,
              }}
            >
              Testimonials
            </p>
            <h2
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: "clamp(32px, 4vw, 44px)",
                fontWeight: 700,
                color: "#f0f0f0",
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              What teams are saying
            </h2>
          </div>

          <div
            className="vb-grid-3"
            style={{ gap: 20 }}
          >
            {TESTIMONIALS.map((q) => (
              <div
                key={q.author}
                className="card-hover"
                style={{
                  background: "#161616",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: 32,
                }}
              >
                <div
                  style={{
                    fontSize: 28,
                    color: "#00e87b",
                    marginBottom: 16,
                    lineHeight: 1,
                  }}
                >
                  "
                </div>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 15,
                    color: "#f0f0f0",
                    lineHeight: 1.65,
                    margin: "0 0 24px",
                  }}
                >
                  {q.text}
                </p>
                <div>
                  <div
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#f0f0f0",
                    }}
                  >
                    {q.author}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "#555555",
                    }}
                  >
                    {q.role}
                  </div>
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
          background: "#111111",
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
              color: "#f0f0f0",
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
              color: "#888888",
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
    </div>
  );
}
