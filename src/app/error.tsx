"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Root error boundary. Catches anything that throws past a nested
 * `error.tsx` (or that hits a server component without one). Shows a
 * branded apology + a one-click "try again" rather than a stack trace.
 *
 * The `error.digest` field is set by Next.js on server-side throws —
 * it's the only piece of forensic data we can show the user without
 * leaking implementation detail. Sentry (when configured via
 * SENTRY_DSN) sees the full error server-side via the existing
 * sentry.server.config.ts init; this client-side `error.tsx` deals
 * only with the visible apology.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort: forward to Sentry if it's loaded on the client.
    // Wrapped in a guard so a missing window.Sentry doesn't itself throw.
    if (typeof window !== "undefined") {
      const w = window as unknown as {
        Sentry?: { captureException?: (e: unknown) => void };
      };
      w.Sentry?.captureException?.(error);
    }
  }, [error]);

  return (
    <div
      style={{
        background: "var(--vb-bg)",
        minHeight: "100dvh",
        color: "var(--vb-text)",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        textAlign: "center",
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
        Something broke
      </p>
      <h1
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: "clamp(32px, 4.5vw, 44px)",
          fontWeight: 700,
          letterSpacing: "-0.03em",
          margin: "0 0 16px",
          maxWidth: 720,
        }}
      >
        We hit an error rendering this page
      </h1>
      <p
        style={{
          fontSize: 16,
          color: "var(--vb-muted)",
          margin: "0 auto 24px",
          maxWidth: 540,
          lineHeight: 1.6,
        }}
      >
        It&apos;s been logged on our side. Try reloading — if it
        persists, drop us a line at{" "}
        <a
          href="mailto:hello@vaultbrief.io?subject=Error%20report"
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          hello@vaultbrief.io
        </a>
        {error.digest && (
          <>
            {" "}
            and include error id{" "}
            <code
              style={{
                background: "var(--vb-card)",
                padding: "2px 8px",
                borderRadius: 4,
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 13,
              }}
            >
              {error.digest}
            </code>
          </>
        )}
        .
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <button
          onClick={() => reset()}
          style={{
            background: "var(--accent)",
            color: "#0a0a0a",
            padding: "13px 24px",
            borderRadius: 8,
            border: "none",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <Link
          href="/"
          style={{
            background: "transparent",
            border: "1px solid var(--vb-border)",
            color: "var(--vb-text)",
            padding: "13px 24px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
