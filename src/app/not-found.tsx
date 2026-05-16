import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/marketing/Nav";
import { Footer } from "@/components/marketing/Footer";

/**
 * Root-level 404. Renders for any unmatched path that gets past the
 * proxy auth gate (e.g. `/blog/<typo>`, `/r/<bad-uuid>`, deleted
 * report URLs forwarded around in email chains). Marketing chrome is
 * included so the page doesn't look like a hard crash — visitor lands
 * on Vault Brief, sees the brand, has a way back.
 *
 * Robots noindex because 404 pages should never appear in the index.
 */

export const metadata: Metadata = {
  title: "Page not found — Vault Brief",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div style={{ background: "var(--vb-bg)", minHeight: "100dvh" }}>
      <Nav />
      <main
        className="vb-pad-x"
        style={{
          minHeight: "calc(100dvh - 200px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "80px 24px",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 13,
            color: "var(--vb-dim)",
            margin: "0 0 12px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          404
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
          That page isn&apos;t here
        </h1>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 17,
            color: "var(--vb-muted)",
            margin: "0 auto 32px",
            maxWidth: 540,
            lineHeight: 1.6,
          }}
        >
          The link you followed is either broken or the report has been
          unpublished. If it came from an investor email, ask the sender
          to re-share — they may have rolled back to a draft.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Link
            href="/"
            style={{
              background: "var(--accent)",
              color: "#0a0a0a",
              padding: "13px 24px",
              borderRadius: 8,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Back to home
          </Link>
          <Link
            href="/demo"
            style={{
              background: "transparent",
              border: "1px solid var(--vb-border)",
              color: "var(--vb-text)",
              padding: "13px 24px",
              borderRadius: 8,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            View the demo report
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
