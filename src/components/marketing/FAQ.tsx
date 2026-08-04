"use client";

import { useState } from "react";

// Production-SaaS framing — no "private beta" / "early access" copy.
// Reflects the v2 brief positioning: Vault Brief is a live reporting
// platform, not an upcoming one.
const ITEMS = [
  {
    q: "How does Vault Brief connect to my wallets?",
    a: "Vault Brief uses public wallet addresses only. You add treasury wallets, and the system pulls balances and transaction data from supported data providers. Vault Brief never asks for private keys and cannot move funds.",
  },
  {
    q: "What kind of reports does Vault Brief generate?",
    a: "Vault Brief generates investor reports with treasury overview, burn and runway, GitHub activity, token metrics, executive summary, and monthly changes. Reports can be reviewed and exported as PDF.",
  },
  {
    q: "Can I edit a report before sending it?",
    a: "Yes. Reports are generated for review first. You can edit the narrative, adjust context, and export the final version when ready.",
  },
  {
    q: "Do investors need an account?",
    a: "No. You can export a PDF and send it directly. A secure investor portal is on the roadmap for teams that want to share reports without sending PDFs manually.",
  },
  {
    q: "Do grant funders need an account?",
    a: "No. Export a PDF, or copy the report's Markdown export and paste it directly into the funder's forum thread or reporting portal — no account or integration required on their end.",
  },
  {
    q: "Which chains are supported?",
    a: "Vault Brief supports major EVM chains and Solana reporting flows. New chains are added based on customer requests.",
  },
  {
    q: "Is Vault Brief only for token projects?",
    a: "No. It works for Web3 startups, DAOs, protocols, funds, and teams that need to report treasury and development progress. Token metrics are optional.",
  },
  {
    q: "Is this fully automated?",
    a: "Vault Brief automates data collection and report generation. Sending stays under user control — reports are reviewed before they are shared.",
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
              color: "var(--accent)",
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
              color: "var(--vb-text)",
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
              style={{ borderBottom: "1px solid var(--vb-border)" }}
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
                    color: "var(--vb-text)",
                  }}
                >
                  {item.q}
                </span>
                <svg
                  aria-hidden="true"
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
                    stroke={open === i ? "#00e87b" : "var(--vb-dim)"}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <div
                id={`faq-answer-${i}`}
                // `role="region"` was previously set here, which
                // created 7 nameless region landmarks per page and
                // tripped axe-core's `landmark-unique` rule. Standard
                // accordion patterns don't need an explicit role —
                // the button's `aria-expanded` + `aria-controls`
                // pair already conveys disclosure semantics.
                style={{
                  maxHeight: open === i ? 600 : 0,
                  overflow: "hidden",
                  transition: "max-height 0.3s ease",
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 15,
                    color: "var(--vb-muted)",
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
