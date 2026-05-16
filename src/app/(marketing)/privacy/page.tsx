import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Vault Brief",
};

const s = {
  h2: { fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 600, color: "var(--vb-text)", margin: "40px 0 12px", letterSpacing: "-0.02em" } as React.CSSProperties,
  p: { fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 15, color: "var(--vb-muted)", lineHeight: 1.75, margin: "0 0 16px" } as React.CSSProperties,
};

export default function PrivacyPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      <section className="vb-pad-x" style={{ paddingTop: 80, paddingBottom: 120, maxWidth: 720, margin: "0 auto" }}>
        <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--vb-dim)", marginBottom: 12 }}>Last updated: May 1, 2026</p>
        <h1 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: "clamp(32px, 4vw, 44px)", fontWeight: 700, color: "var(--vb-text)", letterSpacing: "-0.03em", margin: "0 0 40px" }}>Privacy Policy</h1>

        <p style={s.p}>This Privacy Policy explains how Vault Brief ("we", "us", or "our") collects, uses, and shares information about you when you use our services.</p>

        <h2 style={s.h2}>Information we collect</h2>
        <p style={s.p}>We collect information you provide directly, such as your name, email address, and project details when you create an account. We also collect wallet addresses you connect and GitHub organization data you authorize us to read.</p>
        <p style={s.p}>We do not collect private keys, seed phrases, or any credentials that could allow us to access or move funds on your behalf.</p>

        <h2 style={s.h2}>How we use your information</h2>
        <p style={s.p}>We use your information to provide and improve the Vault Brief service: generating investor reports, syncing on-chain data, and delivering reports to your investor list.</p>
        <p style={s.p}>We do not sell your data to third parties. We do not use your financial data to train AI models. Report content is processed by AI providers (Anthropic, Google via OpenRouter) solely to generate report narratives.</p>

        <h2 style={s.h2}>Data storage</h2>
        <p style={s.p}>Data is stored in US-East AWS infrastructure. All data is encrypted at rest using AES-256. EU data residency is on our roadmap for Q4 2026.</p>

        <h2 style={s.h2}>Investor data</h2>
        <p style={s.p}>Investor names and email addresses you add to Vault Brief are used solely to deliver reports on your behalf. Investors may request removal from your list at any time by contacting us at hello@vaultbrief.io.</p>

        <h2 style={s.h2}>Cookies</h2>
        <p style={s.p}>We use essential cookies for authentication and session management. We use analytics cookies (Plausible Analytics, privacy-first) to understand usage. You can opt out of analytics cookies via our cookie banner.</p>

        <h2 style={s.h2}>Your rights</h2>
        <p style={s.p}>You have the right to access, export, correct, or delete your data at any time. Email us at hello@vaultbrief.io to exercise any of these rights. We respond within 30 days.</p>

        <h2 style={s.h2}>Contact</h2>
        <p style={s.p}>Questions about this policy? Email <a href="mailto:hello@vaultbrief.io" style={{ color: "var(--accent)", textDecoration: "underline" }}>hello@vaultbrief.io</a>.</p>
      </section>
    </div>
  );
}
