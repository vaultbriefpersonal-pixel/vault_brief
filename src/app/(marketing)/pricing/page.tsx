import type { Metadata } from "next";
import { PricingCards } from "@/components/marketing/PricingCards";

export const metadata: Metadata = {
  title: "Pricing — Vault Brief",
  description:
    "Start with a free demo report. Upgrade when you are ready to automate monthly investor reporting.",
};

// Comparison table: Free Demo / Seed / Growth / Custom. We deliberately
// mark coming-soon items with a "(soon)" suffix rather than a checkmark
// so the table doesn't quietly imply parity with what's actually live.
const COMPARISON = [
  { feature: "Sample report preview", demo: "✓", seed: "—", growth: "—", custom: "—" },
  { feature: "Wallets", demo: "—", seed: "1", growth: "10", custom: "Unlimited" },
  { feature: "GitHub repos", demo: "—", seed: "1", growth: "5", custom: "Unlimited" },
  { feature: "Monthly reports", demo: "—", seed: "✓", growth: "✓", custom: "✓" },
  { feature: "PDF export", demo: "—", seed: "✓", growth: "✓", custom: "✓" },
  { feature: "AI narratives", demo: "—", seed: "—", growth: "✓", custom: "✓" },
  { feature: "Custom branding", demo: "—", seed: "—", growth: "✓", custom: "✓" },
  { feature: "Investor portal (soon)", demo: "—", seed: "—", growth: "Roadmap", custom: "Roadmap" },
  { feature: "Multi-project", demo: "—", seed: "—", growth: "—", custom: "✓" },
  { feature: "White-label reports (soon)", demo: "—", seed: "—", growth: "—", custom: "Roadmap" },
  { feature: "API access (soon)", demo: "—", seed: "—", growth: "—", custom: "Roadmap" },
];

const FAQ_ITEMS = [
  {
    q: "Is there a free trial?",
    a: "Yes — start with the Free Demo to see a sample report, then 14 days of full features starting from your first sign-in. Connect wallets, sync data, generate and send your first investor report. No credit card required. After 14 days, paid plans unlock continued sync and report generation; your existing data stays visible regardless.",
  },
  {
    q: "What's in the demo?",
    a: "A demo draft report rendered from sample treasury, GitHub, and token data. Lets you preview the structure, sections, and tone before connecting your own wallets.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes. Upgrade or downgrade at any time. Prorated credits are applied automatically.",
  },
  {
    q: "What counts as a wallet?",
    a: "Each unique blockchain address counts as one wallet. Gnosis Safe, EOA, and exchange accounts all count.",
  },
  {
    q: "Do you offer annual discounts?",
    a: "Yes. Annual billing saves 20% across paid plans.",
  },
];

export default function PricingPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      {/* Hero */}
      <section
        className="vb-section-sm"
        style={{
          textAlign: "center",
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.04) 0%, transparent 100%)",
        }}
      >
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
          Pricing · Private beta
        </p>
        <h1
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: "clamp(36px, 5vw, 56px)",
            fontWeight: 700,
            color: "var(--vb-text)",
            letterSpacing: "-0.03em",
            margin: "0 0 16px",
          }}
        >
          Start with a demo. Upgrade when you&apos;re ready.
        </h1>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 18,
            color: "var(--vb-muted)",
            maxWidth: 560,
            margin: "0 auto",
            lineHeight: 1.6,
          }}
        >
          Generate one free demo report from sample data. Move to a paid plan
          when you want to automate monthly reporting from your own wallets.
        </p>
      </section>

      {/* Pricing cards */}
      <section
        style={{
          padding: "0 20px 40px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <PricingCards />
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            color: "var(--vb-muted)",
            marginTop: 32,
            maxWidth: 560,
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          Start with a demo report. Upgrade when you are ready to automate
          monthly reporting.
        </p>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--vb-dim)",
            marginTop: 14,
            textAlign: "center",
            maxWidth: 600,
            lineHeight: 1.6,
          }}
        >
          14-day free trial on paid plans — no credit card required. Vault
          Brief is in private beta; some advanced features are still rolling
          out (marked &ldquo;Roadmap&rdquo; below). Questions? Email{" "}
          <a
            href="mailto:hello@vaultbrief.com"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            hello@vaultbrief.com
          </a>
        </p>
      </section>

      {/* Comparison table */}
      <section
        className="vb-section-sm"
        style={{ background: "var(--vb-alt)" }}
      >
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(28px, 3.6vw, 40px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              textAlign: "center",
              margin: "0 0 16px",
            }}
          >
            Compare plans
          </h2>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "var(--vb-dim)",
              textAlign: "center",
              margin: "0 0 40px",
            }}
          >
            &ldquo;Roadmap&rdquo; = scheduled but not yet shipped.
          </p>

          <div
            className="vb-table-scroll"
            style={{
              border: "1px solid var(--vb-border)",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                background: "var(--vb-card)",
                borderBottom: "1px solid var(--vb-border)",
              }}
            >
              <div style={{ padding: "16px 20px" }} />
              {["Free Demo", "Seed", "Growth", "Custom"].map((plan) => (
                <div
                  key={plan}
                  style={{
                    padding: "16px 20px",
                    textAlign: "center",
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 14,
                    fontWeight: 600,
                    color: plan === "Growth" ? "#00e87b" : "#f0f0f0",
                  }}
                >
                  {plan}
                </div>
              ))}
            </div>

            {COMPARISON.map((row, i) => (
              <div
                key={row.feature}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                  borderBottom:
                    i < COMPARISON.length - 1
                      ? "1px solid rgba(255,255,255,0.06)"
                      : "none",
                  background: i % 2 === 0 ? "#0a0a0a" : "#0d0d0d",
                }}
              >
                <div
                  style={{
                    padding: "14px 20px",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14,
                    color: "var(--vb-muted)",
                  }}
                >
                  {row.feature}
                </div>
                {[row.demo, row.seed, row.growth, row.custom].map((val, j) => (
                  <div
                    key={j}
                    style={{
                      padding: "14px 20px",
                      textAlign: "center",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color:
                        val === "—"
                          ? "#333333"
                          : val === "✓"
                            ? "#00e87b"
                            : val === "Roadmap"
                              ? "var(--vb-dim)"
                              : "#f0f0f0",
                      fontWeight: val === "✓" || val === "—" ? 600 : 400,
                      fontStyle: val === "Roadmap" ? "italic" : "normal",
                    }}
                  >
                    {val}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="vb-section-sm">
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(32px, 4vw, 44px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              textAlign: "center",
              margin: "0 0 48px",
            }}
          >
            Frequently asked questions
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {FAQ_ITEMS.map((item, i) => (
              <div
                key={i}
                style={{
                  borderBottom: "1px solid var(--vb-border)",
                  paddingBottom: 20,
                  paddingTop: 20,
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    margin: "0 0 8px",
                  }}
                >
                  {item.q}
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 15,
                    color: "var(--vb-muted)",
                    lineHeight: 1.65,
                    margin: 0,
                  }}
                >
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
