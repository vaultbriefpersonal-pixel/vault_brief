"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./Logo";
import { useIsMobile } from "@/lib/use-is-mobile";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  { label: "Blog", href: "/blog" },
  { label: "About", href: "/about" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Lock body scroll while drawer is open.
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, isMobile]);

  // Close drawer when leaving mobile.
  useEffect(() => {
    if (!isMobile) setOpen(false);
  }, [isMobile]);

  const linkStyle: React.CSSProperties = {
    color: "var(--vb-muted)",
    textDecoration: "none",
    fontSize: 16,
    fontWeight: 500,
    fontFamily: "var(--font-inter), Inter, sans-serif",
    transition: "color 0.2s",
  };

  const ctaStyle: React.CSSProperties = {
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
  };

  return (
    <>
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
          background: scrolled || open ? "rgba(10,10,10,0.92)" : "transparent",
          backdropFilter:
            scrolled || open ? "blur(20px) saturate(140%)" : "none",
          borderBottom:
            scrolled || open
              ? "1px solid rgba(255,255,255,0.08)"
              : "1px solid transparent",
          transition: "all 0.3s ease",
        }}
      >
        <Link
          href="/"
          style={{ textDecoration: "none", flexShrink: 0 }}
          onClick={() => setOpen(false)}
        >
          <Logo size={26} />
        </Link>

        {/* Desktop: center links + right Login/CTA. Hidden on mobile. */}
        {!isMobile && (
          <>
            <div
              style={{ display: "flex", alignItems: "center", gap: 28 }}
            >
              {NAV_LINKS.map(({ label, href }) => (
                <Link
                  key={label}
                  href={href}
                  style={linkStyle}
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                flexShrink: 0,
              }}
            >
              <Link
                href="/login"
                style={{ ...linkStyle, fontSize: 14 }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "#f0f0f0")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "#888888")
                }
              >
                Login
              </Link>
              <Link
                href="/login"
                style={ctaStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow =
                    "0 4px 20px rgba(0,232,123,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                Start Free Trial
              </Link>
            </div>
          </>
        )}

        {/* Mobile: burger only. Drawer rendered below. */}
        {isMobile && (
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
            style={{
              background: "transparent",
              border: "1px solid var(--vb-border)",
              borderRadius: 8,
              color: "var(--vb-text)",
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        )}
      </nav>

      {/* Mobile drawer — full-screen overlay below the fixed nav. */}
      {isMobile && (
        <div
          aria-hidden={!open}
          style={{
            position: "fixed",
            top: 72,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
            background: "rgba(10,10,10,0.98)",
            backdropFilter: "blur(20px) saturate(140%)",
            transform: open ? "translateX(0)" : "translateX(100%)",
            transition: "transform 0.25s ease",
            padding: "32px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {NAV_LINKS.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                padding: "14px 4px",
                fontSize: 18,
                fontWeight: 500,
                color: "var(--vb-text)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                textDecoration: "none",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {label}
            </Link>
          ))}

          <Link
            href="/login"
            onClick={() => setOpen(false)}
            style={{
              display: "block",
              padding: "14px 4px",
              fontSize: 16,
              color: "var(--vb-muted)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              textDecoration: "none",
              marginTop: 8,
            }}
          >
            Login
          </Link>

          <Link
            href="/login"
            onClick={() => setOpen(false)}
            style={{
              ...ctaStyle,
              textAlign: "center",
              padding: "14px 24px",
              marginTop: 16,
            }}
          >
            Start Free Trial
          </Link>
        </div>
      )}
    </>
  );
}
