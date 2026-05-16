import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy — Vault Brief",
};

const s = {
  h2: { fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 600, color: "var(--vb-text)", margin: "40px 0 12px", letterSpacing: "-0.02em" } as React.CSSProperties,
  p: { fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 15, color: "var(--vb-muted)", lineHeight: 1.75, margin: "0 0 16px" } as React.CSSProperties,
};

const COOKIES = [
  { name: "session", type: "Essential", purpose: "Keeps you logged in across page loads. Expires when you close the browser.", duration: "Session" },
  { name: "vb_auth", type: "Essential", purpose: "Stores your authentication token securely. Required for the dashboard to function.", duration: "30 days" },
  { name: "_plausible", type: "Analytics", purpose: "Privacy-first analytics. No personal data collected. IP addresses are anonymized.", duration: "1 year" },
];

export default function CookiesPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      <section className="vb-pad-x" style={{ paddingTop: 80, paddingBottom: 120, maxWidth: 720, margin: "0 auto" }}>
        <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--vb-dim)", marginBottom: 12 }}>Last updated: May 1, 2026</p>
        <h1 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: "clamp(32px, 4vw, 44px)", fontWeight: 700, color: "var(--vb-text)", letterSpacing: "-0.03em", margin: "0 0 40px" }}>Cookie Policy</h1>

        <p style={s.p}>Vault Brief uses a small number of cookies to make the service work and to understand how it is being used. We do not use advertising cookies or sell data to ad networks.</p>

        <h2 style={s.h2}>Cookies we use</h2>

        <div className="vb-table-scroll" style={{ background: "var(--vb-card)", border: "1px solid var(--vb-border)", borderRadius: 12, overflow: "hidden", marginBottom: 32 }}>
          <div style={{ minWidth: 600 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr 1fr", background: "#0d0d0d", padding: "12px 20px", borderBottom: "1px solid var(--vb-border)" }}>
            {["Cookie", "Type", "Purpose", "Duration"].map((h) => (
              <span key={h} style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 11, fontWeight: 600, color: "var(--vb-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>
            ))}
          </div>
          {COOKIES.map((c, i) => (
            <div key={c.name} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr 1fr", padding: "14px 20px", borderBottom: i < COOKIES.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "var(--accent)" }}>{c.name}</span>
              <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: c.type === "Essential" ? "#f0f0f0" : "#888888" }}>{c.type}</span>
              <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--vb-muted)", lineHeight: 1.5 }}>{c.purpose}</span>
              <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--vb-dim)" }}>{c.duration}</span>
            </div>
          ))}
          </div>
        </div>

        <h2 style={s.h2}>Your choices</h2>
        <p style={s.p}>Essential cookies are required for Vault Brief to function and cannot be disabled. Analytics cookies can be opted out of by clicking "Decline" on the cookie banner when you first visit, or by emailing us.</p>
        <p style={s.p}>You can also clear cookies at any time in your browser settings. Note that clearing essential cookies will log you out of your account.</p>

        <h2 style={s.h2}>Contact</h2>
        <p style={s.p}>Questions about our cookie use? Email <a href="mailto:hello@vaultbrief.io" style={{ color: "var(--accent)", textDecoration: "underline" }}>hello@vaultbrief.io</a>.</p>
      </section>
    </div>
  );
}
