import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security — Vault Brief",
  description:
    "Vault Brief uses public wallet data and read-only integrations to generate investor reports. Read about our security posture and roadmap.",
};

// Concrete, shipped security controls — no vague "roadmap" promises.
// Every item below corresponds to an actual mechanism in the codebase:
//   - read-only data path:      src/server/services/wallet-sync.ts (RPC reads only, no signers)
//   - private key never asked:  no signer config anywhere in /lib/*
//   - HTTPS everywhere:         Vercel-enforced HSTS (next.config.ts / Vercel platform)
//   - Webhook signature checks: /api/webhooks/{stripe,resend,atlos} verify HMAC / Svix
//   - Per-route rate limits:    src/server/lib/ratelimit.ts (Upstash Redis)
//   - Encrypted PII at rest:    GitHub PAT stored encrypted (projects.githubTokenEncrypted)
//   - Authenticated dashboard:  NextAuth v5 + Drizzle adapter, single-host magic links
//   - Manual review on send:    reports default status='draft'; investor email needs user click
const ITEMS = [
  {
    icon: "🔒",
    title: "Read-only wallet access",
    desc: "Vault Brief reads from public RPC endpoints (Alchemy, Dune Sim, Helius) using project-owned wallet addresses. The product holds no signing keys and cannot move funds, approve allowances, or modify on-chain state.",
  },
  {
    icon: "🔐",
    title: "No private key storage",
    desc: "There is no signer in our code path. We never ask for seed phrases or wallet signing permissions, and no API or UI surface accepts them.",
  },
  {
    icon: "📨",
    title: "Signed webhooks only",
    desc: "Every inbound webhook is signature-verified before any side-effect runs. Stripe events check the official HMAC header; Resend uses Svix-signed events for email tracking; Atlos USDC postbacks are HMAC-SHA256 over the raw body with timing-safe comparison.",
  },
  {
    icon: "🔑",
    title: "Encrypted credentials at rest",
    desc: "GitHub personal access tokens are encrypted before they hit the database. Stripe customer references are opaque IDs only; no card details ever touch our servers.",
  },
  {
    icon: "🛡️",
    title: "Auth and transport",
    desc: "TLS 1.2+ enforced end-to-end via Vercel with HSTS preload. Authentication runs on NextAuth v5 with single-host magic links (no cross-origin redirects, no callback hijacking surface). DKIM, SPF, and DMARC verified for the sending domain.",
  },
  {
    icon: "⏱️",
    title: "Rate-limited surfaces",
    desc: "Sign-in attempts, project creation, on-demand sync, autofill lookups, and chat are all rate-limited via Upstash Redis sliding windows. Burst protection lives at the edge before any DB or LLM call.",
  },
  {
    icon: "✅",
    title: "Manual review before send",
    desc: "Generated reports land in draft status. Nothing is sent to investors until you click \"Send\". The sender drawer shows recipient list, edited markdown, and PDF preview side-by-side.",
  },
  {
    icon: "🧾",
    title: "Audit-friendly data layer",
    desc: "Treasury snapshots are append-only. Every report references the exact snapshot it was generated from, and every webhook event is idempotently logged (Stripe events, Atlos events). Numbers in the AI narrative are validated against the source snapshot at generation time — no fabricated figures.",
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
              <h2
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
              </h2>
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
          <h2
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
          </h2>
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
              href="mailto:hello@vaultbrief.io?subject=Security%20report"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              hello@vaultbrief.io
            </a>{" "}
            with subject &ldquo;Security report&rdquo; — include a clear
            description and reproduction steps. Reports are triaged the
            same business day.
          </p>
        </div>
      </section>
    </div>
  );
}
