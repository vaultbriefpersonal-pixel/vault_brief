import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security — Vault Brief",
  description:
    "Vault Brief uses public wallet data and read-only integrations to generate investor reports. Read about our security posture and roadmap.",
};

const ITEMS = [
  {
    icon: "🔒",
    title: "Read-only wallet access",
    desc: "Vault Brief works with public wallet addresses. It cannot sign transactions, move funds, or modify on-chain state.",
  },
  {
    icon: "🔐",
    title: "No private key storage",
    desc: "Vault Brief never asks for private keys, seed phrases, or wallet signing permissions.",
  },
  {
    icon: "🧾",
    title: "Controlled report access",
    desc: "Reports are generated inside your account. You decide what gets exported or shared.",
  },
  {
    icon: "✅",
    title: "Review before send",
    desc: "Nothing is sent automatically without user approval. Reports are reviewed before sharing.",
  },
  {
    icon: "🛡️",
    title: "Operational security",
    desc: "Vault Brief is built with standard application security practices, including access control, encrypted transport, and monitored production systems.",
  },
  {
    icon: "📋",
    title: "Security roadmap",
    desc: "Additional audit logs, stronger admin controls, and compliance documentation are part of the product roadmap.",
  },
];

export default function SecurityPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 100,
          paddingBottom: 80,
          maxWidth: 1000,
          margin: "0 auto",
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
            marginBottom: 16,
          }}
        >
          Security
        </p>
        <h1
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: "clamp(36px, 5vw, 52px)",
            fontWeight: 700,
            color: "var(--vb-text)",
            letterSpacing: "-0.035em",
            margin: "0 0 16px",
          }}
        >
          Security first, because treasury data matters
        </h1>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 17,
            color: "var(--vb-muted)",
            maxWidth: 640,
            lineHeight: 1.65,
            margin: "0 0 56px",
          }}
        >
          Vault Brief uses public wallet data and read-only integrations to
          generate investor reports. The product never asks for private keys
          and cannot move funds.
        </p>

        <div className="vb-grid-2" style={{ gap: 24 }}>
          {ITEMS.map((item) => (
            <div
              key={item.title}
              style={{
                background: "var(--vb-card)",
                borderRadius: 14,
                border: "1px solid var(--vb-border)",
                padding: 32,
              }}
            >
              <span style={{ fontSize: 28, display: "block", marginBottom: 16 }}>
                {item.icon}
              </span>
              <h3
                style={{
                  fontFamily:
                    "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                  fontSize: 18,
                  fontWeight: 600,
                  color: "var(--vb-text)",
                  margin: "0 0 10px",
                }}
              >
                {item.title}
              </h3>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 15,
                  color: "var(--vb-muted)",
                  lineHeight: 1.65,
                  margin: 0,
                }}
              >
                {item.desc}
              </p>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 60,
            padding: 32,
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 14,
          }}
        >
          <h3
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 18,
              fontWeight: 600,
              color: "var(--vb-text)",
              margin: "0 0 10px",
            }}
          >
            Report a vulnerability
          </h3>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 15,
              color: "var(--vb-muted)",
              lineHeight: 1.65,
              margin: 0,
            }}
          >
            If you discover a security issue, contact{" "}
            <a
              href="mailto:security@vaultbrief.com"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              security@vaultbrief.com
            </a>{" "}
            with a clear description and reproduction steps.
          </p>
        </div>
      </section>
    </div>
  );
}
