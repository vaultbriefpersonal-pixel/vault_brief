import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security — VaultBrief",
  description: "How VaultBrief handles your data, encryption, and access controls.",
};

const ITEMS = [
  { icon: "🔒", title: "Read-only access", desc: "We connect to your wallets using public addresses only. VaultBrief cannot sign transactions, move funds, or modify on-chain state in any way." },
  { icon: "🔐", title: "Encryption at rest and in transit", desc: "All data is encrypted using AES-256 at rest and TLS 1.3 in transit. Sensitive fields like GitHub tokens are encrypted separately before storage." },
  { icon: "🧑‍💻", title: "No private key storage", desc: "We never ask for, store, or handle private keys or seed phrases. Wallet integration is done entirely via public addresses and read-only RPC calls." },
  { icon: "📋", title: "SOC 2 Type II (roadmap)", desc: "We are targeting SOC 2 Type II certification in Q3 2026. In the meantime, we follow SOC 2 controls internally and conduct quarterly security reviews." },
  { icon: "📝", title: "Audit logs", desc: "All report access, investor portal views, and admin actions are logged with timestamps. Available on Growth and VC Suite plans." },
  { icon: "🌐", title: "Data residency", desc: "All data is stored in US-East AWS infrastructure. EU data residency is on our roadmap for Q4 2026 to support GDPR-strict customers." },
];

export default function SecurityPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      <section className="vb-pad-x" style={{ paddingTop: 100, paddingBottom: 80, maxWidth: 1000, margin: "0 auto" }}>
        <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 16 }}>Security</p>
        <h1 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: "clamp(36px, 5vw, 52px)", fontWeight: 700, color: "var(--vb-text)", letterSpacing: "-0.035em", margin: "0 0 16px" }}>Your data is safe with us</h1>
        <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 17, color: "var(--vb-muted)", maxWidth: 600, lineHeight: 1.65, margin: "0 0 72px" }}>
          We take a security-first approach to building VaultBrief. Here is exactly how we protect your data and your investors' information.
        </p>

        <div className="vb-grid-2" style={{ gap: 24 }}>
          {ITEMS.map((item) => (
            <div key={item.title} style={{ background: "var(--vb-card)", borderRadius: 14, border: "1px solid var(--vb-border)", padding: 32 }}>
              <span style={{ fontSize: 28, display: "block", marginBottom: 16 }}>{item.icon}</span>
              <h3 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 600, color: "var(--vb-text)", margin: "0 0 10px" }}>{item.title}</h3>
              <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 15, color: "var(--vb-muted)", lineHeight: 1.65, margin: 0 }}>{item.desc}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 60, padding: 32, background: "var(--vb-card)", border: "1px solid var(--vb-border)", borderRadius: 14 }}>
          <h3 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 600, color: "var(--vb-text)", margin: "0 0 10px" }}>Report a vulnerability</h3>
          <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 15, color: "var(--vb-muted)", lineHeight: 1.65, margin: "0 0 16px" }}>
            If you discover a security issue, please email us at{" "}
            <a href="mailto:security@vaultbrief.com" style={{ color: "var(--accent)", textDecoration: "none" }}>security@vaultbrief.com</a>.
            We respond within 24 hours and offer responsible disclosure credit.
          </p>
        </div>
      </section>
    </div>
  );
}
