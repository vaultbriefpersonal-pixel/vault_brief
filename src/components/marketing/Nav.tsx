"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Logo } from "./Logo";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  { label: "Blog", href: "/blog" },
  { label: "About", href: "/about" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav
      className="vb-pad-x"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        height: 72,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: scrolled ? "rgba(10,10,10,0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(20px) saturate(140%)" : "none",
        borderBottom: scrolled
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid transparent",
        transition: "all 0.3s ease",
      }}
    >
      <Link href="/" style={{ textDecoration: "none", flexShrink: 0 }}>
        <Logo size={26} />
      </Link>

      {/* Center links */}
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        {NAV_LINKS.map(({ label, href }) => (
          <Link
            key={label}
            href={href}
            style={{
              color: "#888888",
              textDecoration: "none",
              fontSize: 16,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#f0f0f0")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#888888")}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Right: Login + CTA */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexShrink: 0 }}>
        <Link
          href="/login"
          style={{
            color: "#888888",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            transition: "color 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#f0f0f0")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#888888")}
        >
          Login
        </Link>

        <Link
          href="/login"
          style={{
            background: "#00e87b",
            color: "#0a0a0a",
            borderRadius: 8,
            padding: "11px 24px",
            fontSize: 16,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            textDecoration: "none",
            display: "inline-block",
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,232,123,0.35)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          Start Free Trial
        </Link>
      </div>
    </nav>
  );
}
