"use client";

import Link from "next/link";
import { Logo } from "./Logo";

const COLS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Demo", href: "/demo" },
      { label: "Changelog", href: "/changelog" },
      // "API Docs" → roadmap stub. Surface that it's coming, don't pretend
      // we have a public API today.
      { label: "API (coming soon)", href: "/docs" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Blog", href: "/blog" },
      { label: "Security", href: "/security" },
      // "Status" link removed — page still reachable via /status and
      // /api/health for external monitors, just not advertised in nav
      // until we have an "all systems operational" public reason to.
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
];

// Discord and GitHub icons removed — both linked to placeholder URLs
// that don't resolve yet (Discord server not created, GitHub org not
// public). Better no link than a 404. Add back once the channels exist.
const SOCIALS = [
  {
    label: "X",
    href: "https://x.com/vaultbrief",
    svg: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
];

export function Footer() {
  return (
    <footer
      className="vb-pad-x"
      style={{
        paddingTop: 60,
        paddingBottom: 40,
        borderTop: "1px solid var(--vb-border)",
        background: "var(--vb-bg)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 40,
        }}
      >
        <div>
          <Logo size={22} />
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "var(--vb-dim)",
              maxWidth: 240,
              lineHeight: 1.6,
              margin: "12px 0 0",
            }}
          >
            Automated investor reporting for crypto projects. Connect once,
            report forever.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            {SOCIALS.map(({ svg, href, label }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  border: "1px solid var(--vb-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--vb-dim)",
                  textDecoration: "none",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#00e87b";
                  e.currentTarget.style.borderColor = "rgba(0,232,123,0.3)";
                  e.currentTarget.style.background = "rgba(0,232,123,0.06)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#555555";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {svg}
              </a>
            ))}
          </div>
        </div>

        {COLS.map((col) => (
          <div key={col.title}>
            <h4
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--vb-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                margin: "0 0 16px",
              }}
            >
              {col.title}
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {col.links.map(({ label, href }) => (
                <Link
                  key={label}
                  href={href}
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: "var(--vb-muted)",
                    textDecoration: "none",
                    transition: "color 0.2s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "#f0f0f0")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "#888888")
                  }
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          maxWidth: 1200,
          margin: "40px auto 0",
          paddingTop: 24,
          borderTop: "1px solid var(--vb-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "var(--vb-dim)",
          }}
        >
          © {new Date().getFullYear()} Vault Brief. All rights reserved.
        </span>
        <a
          href="mailto:hello@vaultbrief.io"
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "var(--vb-dim)",
            textDecoration: "none",
            transition: "color 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#00e87b")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#555555")}
        >
          hello@vaultbrief.io
        </a>
      </div>
    </footer>
  );
}
