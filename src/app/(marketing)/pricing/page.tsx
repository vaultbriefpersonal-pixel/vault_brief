import type { Metadata } from "next";
import { PricingCards } from "@/components/marketing/PricingCards";

export const metadata: Metadata = {
  title: "Pricing — Vault Brief",
  description:
    "Simple, transparent pricing for automated Web3 investor reporting. Start free, upgrade when you need more.",
};

const COMPARISON = [
  { feature: "Wallets", seed: "1", growth: "10", vc: "Unlimited" },
  { feature: "GitHub repos", seed: "1", growth: "5", vc: "Unlimited" },
  { feature: "Monthly reports", seed: "✓", growth: "✓", vc: "✓" },
  { feature: "PDF export", seed: "✓", growth: "✓", vc: "✓" },
  { feature: "AI narratives", seed: "—", growth: "✓", vc: "✓" },
  { feature: "Custom branding", seed: "—", growth: "✓", vc: "✓" },
  { feature: "Investor portal", seed: "—", growth: "✓", vc: "✓" },
  { feature: "Multi-project", seed: "—", growth: "—", vc: "✓" },
  { feature: "White-label reports", seed: "—", growth: "—", vc: "✓" },
  { feature: "API access", seed: "—", growth: "—", vc: "✓" },
  { feature: "Dedicated CSM", seed: "—", growth: "—", vc: "✓" },
];

const FAQ_ITEMS = [
  {
    q: "Is there a free trial?",
    a: "Yes — 14 days starting from your first sign-in. Connect wallets, sync data, generate and send your first investor report. No credit card required. After 14 days, paid plans unlock continued sync and report generation; your existing data stays visible regardless.",
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
    a: "Yes. Annual billing saves 20% across all plans.",
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
          Pricing
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
          Simple, transparent pricing
        </h1>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 18,
            color: "var(--vb-muted)",
            maxWidth: 480,
            margin: "0 auto",
            lineHeight: 1.6,
          }}
        >
          Start free. Upgrade when you need more. No per-report fees, no seat
          limits.
        </p>
      </section>

      {/* Pricing cards */}
      <section
        style={{
          padding: "0 20px 80px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <PricingCards />
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--vb-dim)",
            marginTop: 32,
          }}
        >
          14-day free trial — full features, no credit card. After that, your
          data stays; upgrade to keep generating new reports. Questions? Email{" "}
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
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
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
            Compare plans
          </h2>

          <div
            className="vb-table-scroll"
            style={{
              border: "1px solid var(--vb-border)",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                background: "var(--vb-card)",
                borderBottom: "1px solid var(--vb-border)",
              }}
            >
              <div style={{ padding: "16px 24px" }} />
              {["Seed", "Growth", "VC Suite"].map((plan) => (
                <div
                  key={plan}
                  style={{
                    padding: "16px 24px",
                    textAlign: "center",
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 15,
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
                  gridTemplateColumns: "2fr 1fr 1fr 1fr",
                  borderBottom:
                    i < COMPARISON.length - 1
                      ? "1px solid rgba(255,255,255,0.06)"
                      : "none",
                  background: i % 2 === 0 ? "#0a0a0a" : "#0d0d0d",
                }}
              >
                <div
                  style={{
                    padding: "14px 24px",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14,
                    color: "var(--vb-muted)",
                  }}
                >
                  {row.feature}
                </div>
                {[row.seed, row.growth, row.vc].map((val, j) => (
                  <div
                    key={j}
                    style={{
                      padding: "14px 24px",
                      textAlign: "center",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 14,
                      color: val === "—" ? "#333333" : val === "✓" ? "#00e87b" : "#f0f0f0",
                      fontWeight: val === "✓" || val === "—" ? 600 : 400,
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
                style={{ borderBottom: "1px solid var(--vb-border)", paddingBottom: 20, paddingTop: 20 }}
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
