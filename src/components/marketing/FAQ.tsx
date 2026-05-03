"use client";

import { useState } from "react";

const ITEMS = [
  {
    q: "How does VaultBrief connect to my wallets?",
    a: "We use read-only connections. You provide wallet addresses and we pull balances and transaction data from on-chain sources. We never have access to your private keys or the ability to move funds.",
  },
  {
    q: "Which blockchains do you support?",
    a: "Ethereum, Solana, Arbitrum, Optimism, Polygon, Avalanche, BNB Chain, Base, and more. We add new chains monthly based on customer requests.",
  },
  {
    q: "Can I edit the AI-generated reports?",
    a: "Yes. Every report goes through a review step before sending. You can edit the narrative, add sections, attach files, and include a personal note to investors.",
  },
  {
    q: "Is my financial data secure?",
    a: "All data is encrypted at rest and in transit. We use read-only connections and can never move funds. SOC 2 Type II audit is on our roadmap for Q3 2026.",
  },
  {
    q: "What if I need a report outside the monthly schedule?",
    a: "Growth and VC Suite plans can generate reports on demand at any time. Seed plan users can purchase additional reports for $25 each.",
  },
  {
    q: "Do investors need to create an account?",
    a: "No. Investors receive a secure link to a read-only portal. No sign-up required on their end.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="vb-section">
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
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
            FAQ
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
            Common questions
          </h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {ITEMS.map((item, i) => (
            <div
              key={i}
              style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                aria-controls={`faq-answer-${i}`}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  padding: "20px 0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.2s",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 15.5,
                    fontWeight: 500,
                    color: "#f0f0f0",
                  }}
                >
                  {item.q}
                </span>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  style={{
                    flexShrink: 0,
                    marginLeft: 16,
                    transform: open === i ? "rotate(45deg)" : "none",
                    transition: "transform 0.25s ease",
                  }}
                >
                  <path
                    d="M10 4v12M4 10h12"
                    stroke={open === i ? "#00e87b" : "#555555"}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <div
                id={`faq-answer-${i}`}
                role="region"
                style={{
                  maxHeight: open === i ? 600 : 0,
                  overflow: "hidden",
                  transition: "max-height 0.3s ease",
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14.5,
                    color: "#888888",
                    lineHeight: 1.65,
                    margin: "0 0 20px",
                    paddingRight: 36,
                  }}
                >
                  {item.a}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
