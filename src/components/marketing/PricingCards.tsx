"use client";

import Link from "next/link";
import { useState } from "react";

const TIERS = [
  {
    name: "Seed",
    price: 99,
    desc: "For early-stage projects with a single treasury wallet",
    features: [
      "1 wallet",
      "1 GitHub repo",
      "Monthly reports",
      "PDF export",
      "Email support",
    ],
    featured: false,
    cta: "Start Free Trial",
    href: "/login",
  },
  {
    name: "Growth",
    price: 299,
    desc: "For scaling projects with multi-chain treasuries",
    features: [
      "10 wallets",
      "5 GitHub repos",
      "AI narratives",
      "Custom branding",
      "Investor portal",
      "Priority support",
    ],
    featured: true,
    cta: "Start Free Trial",
    href: "/login",
  },
  {
    name: "VC Suite",
    price: 799,
    desc: "For funds and multi-entity projects",
    features: [
      "Unlimited wallets",
      "Unlimited repos",
      "Multi-project",
      "White-label reports",
      "API access",
      "Dedicated CSM",
    ],
    featured: false,
    cta: "Contact us",
    href: "mailto:hello@vaultbrief.com",
  },
];

function PricingCard({
  tier,
  annual,
}: {
  tier: (typeof TIERS)[number];
  annual: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [ctaHovered, setCtaHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: tier.featured ? "#1c1c1c" : hovered ? "#1a1a1a" : "#161616",
        borderRadius: 16,
        padding: "clamp(20px, 4vw, 36px)",
        border: tier.featured
          ? "2px solid #00e87b"
          : `1px solid ${hovered ? "rgba(0,232,123,0.2)" : "rgba(255,255,255,0.08)"}`,
        position: "relative",
        transform: tier.featured
          ? "scale(1.03)"
          : hovered
            ? "translateY(-4px)"
            : "none",
        boxShadow: tier.featured
          ? "0 8px 40px rgba(0,232,123,0.12)"
          : hovered
            ? "0 12px 40px rgba(0,0,0,0.3)"
            : "none",
        transition: "all 0.3s ease",
      }}
    >
      {tier.featured && (
        <div
          style={{
            position: "absolute",
            top: -12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#00e87b",
            color: "#0a0a0a",
            fontSize: 11,
            fontWeight: 700,
            padding: "4px 14px",
            borderRadius: 100,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            whiteSpace: "nowrap",
          }}
        >
          Most Popular
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <h3
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: 22,
            fontWeight: 600,
            color: "var(--vb-text)",
            margin: "0 0 6px",
          }}
        >
          {tier.name}
        </h3>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--vb-muted)",
            margin: 0,
          }}
        >
          {tier.desc}
        </p>
      </div>

      <div style={{ marginBottom: 28 }}>
        <span
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: 48,
            fontWeight: 700,
            color: "var(--vb-text)",
          }}
        >
          ${annual ? Math.round(tier.price * 0.8) : tier.price}
        </span>
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            color: "var(--vb-dim)",
          }}
        >
          /month
        </span>
      </div>

      <Link
        href={tier.href}
        onMouseEnter={() => setCtaHovered(true)}
        onMouseLeave={() => setCtaHovered(false)}
        style={{
          display: "block",
          width: "100%",
          padding: "13px 0",
          textAlign: "center",
          background: tier.featured
            ? ctaHovered
              ? "var(--accent-bright)"
              : "var(--accent)"
            : ctaHovered
              ? "rgba(0,232,123,0.08)"
              : "transparent",
          color: tier.featured ? "#0a0a0a" : ctaHovered ? "#00e87b" : "#f0f0f0",
          border: tier.featured
            ? "none"
            : `1px solid ${ctaHovered ? "rgba(0,232,123,0.3)" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          textDecoration: "none",
          marginBottom: 28,
          transition: "all 0.2s",
          boxSizing: "border-box",
          transform: ctaHovered ? "translateY(-1px)" : "none",
        }}
      >
        {tier.cta}
      </Link>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {tier.features.map((f) => (
          <div
            key={f}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 8l3 3 7-7"
                stroke="#00e87b"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                color: "var(--vb-muted)",
              }}
            >
              {f}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PricingCards() {
  const [annual, setAnnual] = useState(false);

  return (
    <>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          background: "var(--vb-card)",
          borderRadius: 10,
          border: "1px solid var(--vb-border)",
          padding: 4,
          marginBottom: 48,
        }}
      >
        {["Monthly", "Annual"].map((o) => {
          const active = o === "Annual" ? annual : !annual;
          return (
            <button
              key={o}
              onClick={() => setAnnual(o === "Annual")}
              style={{
                background: active ? "#00e87b" : "transparent",
                color: active ? "#0a0a0a" : "#888888",
                border: "none",
                borderRadius: 7,
                padding: "8px 20px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {o}
            </button>
          );
        })}
        {annual && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--accent)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              padding: "0 8px 0 0",
            }}
          >
            Save 20%
          </span>
        )}
      </div>

      <div
        className="vb-grid-3"
        style={{
          gap: 20,
          alignItems: "start",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        {TIERS.map((t) => (
          <PricingCard key={t.name} tier={t} annual={annual} />
        ))}
      </div>
    </>
  );
}
