import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — VaultBrief",
};

const s = {
  h2: { fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 600, color: "#f0f0f0", margin: "40px 0 12px", letterSpacing: "-0.02em" } as React.CSSProperties,
  p: { fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 15, color: "#888888", lineHeight: 1.75, margin: "0 0 16px" } as React.CSSProperties,
};

export default function TermsPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      <section className="vb-pad-x" style={{ paddingTop: 80, paddingBottom: 120, maxWidth: 720, margin: "0 auto" }}>
        <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "#555555", marginBottom: 12 }}>Last updated: May 1, 2026</p>
        <h1 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: "clamp(32px, 4vw, 44px)", fontWeight: 700, color: "#f0f0f0", letterSpacing: "-0.03em", margin: "0 0 40px" }}>Terms of Service</h1>

        <p style={s.p}>By using VaultBrief, you agree to these Terms of Service. Please read them carefully.</p>

        <h2 style={s.h2}>The service</h2>
        <p style={s.p}>VaultBrief provides automated investor reporting tools for crypto projects. We connect to your wallet addresses and GitHub organization in read-only mode to generate monthly reports.</p>

        <h2 style={s.h2}>Your account</h2>
        <p style={s.p}>You are responsible for maintaining the security of your account credentials. You agree to provide accurate information and to keep it up to date. You may not share accounts or use VaultBrief on behalf of others without their authorization.</p>

        <h2 style={s.h2}>Acceptable use</h2>
        <p style={s.p}>You may not use VaultBrief to generate reports containing false financial information, to mislead investors, or for any unlawful purpose. We reserve the right to suspend accounts that violate these terms.</p>

        <h2 style={s.h2}>Payment</h2>
        <p style={s.p}>Paid plans are billed monthly or annually in advance. All prices are in USD. Refunds are provided at our discretion. If you cancel, you retain access until the end of your current billing period.</p>

        <h2 style={s.h2}>Data and reports</h2>
        <p style={s.p}>You retain ownership of all report content and financial data. VaultBrief does not claim any rights to your data. We store it solely to provide the service.</p>

        <h2 style={s.h2}>Limitation of liability</h2>
        <p style={s.p}>VaultBrief is provided "as is". We are not liable for decisions made based on report content, inaccuracies in on-chain data sources, or any indirect damages. Our maximum liability is limited to the fees you paid in the 12 months prior to the claim.</p>

        <h2 style={s.h2}>Changes to terms</h2>
        <p style={s.p}>We may update these terms. We will notify you by email 14 days before material changes take effect. Continued use of the service after that date constitutes acceptance.</p>

        <h2 style={s.h2}>Contact</h2>
        <p style={s.p}>Questions? Email <a href="mailto:hello@vaultbrief.com" style={{ color: "#00e87b", textDecoration: "none" }}>hello@vaultbrief.com</a>.</p>
      </section>
    </div>
  );
}
