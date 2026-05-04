"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

/**
 * ATLOS "Pay with USDC" button. Loads atlos.js via next/script, exposes
 * window.atlos.Pay() once ready, and triggers the widget on click.
 *
 * orderId encodes "userId:plan:nonce" — the webhook (route.ts) parses it to
 * apply the right plan to the right user. Nonce prevents collisions when a
 * user opens the widget, abandons, then re-opens with the same plan.
 */

// ATLOS doesn't ship types. Mirror the parameters we use; everything else is
// optional from atlos.io/docs/widget/parameters.
declare global {
  interface Window {
    atlos?: {
      Pay: (params: AtlosPayParams) => void;
      RECURRENCE_DAY: number;
      RECURRENCE_WEEK: number;
      RECURRENCE_MONTH: number;
      RECURRENCE_YEAR: number;
    };
  }
}

interface AtlosPayParams {
  merchantId: string;
  orderId: string;
  orderAmount: number;
  orderCurrency?: string;
  userName?: string;
  userEmail?: string;
  recurrence?: number;
  postbackUrl?: string;
  onSuccess?: () => void;
  onCanceled?: () => void;
  onCompleted?: () => void;
  theme?: "light" | "dark";
}

export type AtlosPlan = "starter" | "growth" | "vc_suite";

interface PayWithUsdcButtonProps {
  userId: string;
  userEmail?: string;
  userName?: string;
  plan: AtlosPlan;
  amount: number;
  /** Visual variant: "primary" green, "secondary" outlined. */
  variant?: "primary" | "secondary";
  className?: string;
  children?: React.ReactNode;
}

export function PayWithUsdcButton({
  userId,
  userEmail,
  userName,
  plan,
  amount,
  variant = "secondary",
  className,
  children,
}: PayWithUsdcButtonProps) {
  const [ready, setReady] = useState(false);
  const merchantId = process.env.NEXT_PUBLIC_ATLOS_MERCHANT_ID;

  // atlos.js may already be loaded (e.g. user navigated from another page
  // that mounted this component). Re-check on mount.
  useEffect(() => {
    if (typeof window !== "undefined" && window.atlos) setReady(true);
  }, []);

  const handleClick = () => {
    if (!merchantId) {
      console.error("NEXT_PUBLIC_ATLOS_MERCHANT_ID not configured");
      return;
    }
    if (!window.atlos) {
      console.warn("atlos.js not loaded yet");
      return;
    }
    // crypto.randomUUID() is fine in any modern browser; falling back to
    // Date.now() keeps SSR/older runtimes from crashing.
    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : String(Date.now());
    const orderId = `${userId.replace(/:/g, "_")}:${plan}:${nonce}`;
    window.atlos.Pay({
      merchantId,
      orderId,
      orderAmount: amount,
      orderCurrency: "USD",
      userEmail,
      userName,
      recurrence: window.atlos.RECURRENCE_MONTH,
      onSuccess: () => {
        // Hard reload to /billing so server components re-fetch updated plan.
        // Webhook may land a beat after onSuccess, so we wait 1.5s — good
        // enough on Vercel→Neon round-trip; UI also tolerates stale plan
        // gracefully (still shows "Free" until refresh).
        setTimeout(() => {
          window.location.href = "/billing?source=atlos&status=success";
        }, 1500);
      },
      theme: "dark",
    });
  };

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "13px 0",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "var(--font-inter), Inter, sans-serif",
    cursor: "pointer",
    width: "100%",
    transition: "all 0.2s",
    boxSizing: "border-box",
  };

  const variantStyle: React.CSSProperties =
    variant === "primary"
      ? {
          background: "var(--accent)",
          color: "#0a0a0a",
          border: "none",
        }
      : {
          background: "transparent",
          color: "var(--vb-text)",
          border: "1px solid rgba(0,232,123,0.25)",
        };

  return (
    <>
      <Script
        src="https://atlos.io/packages/app/atlos.js"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={!ready}
        className={className}
        style={{
          ...baseStyle,
          ...variantStyle,
          opacity: ready ? 1 : 0.5,
          cursor: ready ? "pointer" : "wait",
        }}
        aria-label={`Pay with USDC for ${plan} plan`}
      >
        {/* Inline USDC-ish circle icon — keeps zero-deps. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" />
          <text
            x="12"
            y="16"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="currentColor"
            fontFamily="monospace"
          >
            $
          </text>
        </svg>
        {children ?? "Pay with USDC"}
      </button>
    </>
  );
}
