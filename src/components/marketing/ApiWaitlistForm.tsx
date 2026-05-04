"use client";

import { useState } from "react";

/**
 * Email-only waitlist form for the future public API. POSTs to
 * /api/waitlist/api-access which writes to the `api_waitlist` table.
 *
 * Submission states:
 *   idle    — initial render, button enabled
 *   loading — request inflight, button disabled
 *   ok      — server returned 200; show "We'll email you when it ships"
 *   err     — show error inline; button re-enables
 */
export function ApiWaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/waitlist/api-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      setState("ok");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("err");
    }
  }

  if (state === "ok") {
    return (
      <div
        style={{
          background: "rgba(0,232,123,0.08)",
          border: "1px solid rgba(0,232,123,0.25)",
          borderRadius: 10,
          padding: "16px 20px",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 14,
          color: "var(--vb-text)",
        }}
      >
        Thanks — we&apos;ll email{" "}
        <strong style={{ color: "var(--accent)" }}>{email}</strong> the
        moment the API opens. One email, no marketing.
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          type="email"
          required
          placeholder="you@protocol.xyz"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email"
          style={{
            flex: "1 1 240px",
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 15,
            color: "var(--vb-text)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          style={{
            background: "var(--accent)",
            color: "#0a0a0a",
            border: "none",
            borderRadius: 8,
            padding: "12px 20px",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor: state === "loading" ? "not-allowed" : "pointer",
            opacity: state === "loading" ? 0.6 : 1,
          }}
        >
          {state === "loading" ? "Submitting…" : "Notify me"}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "#f87171",
            margin: 0,
          }}
        >
          {error}
        </p>
      )}
    </form>
  );
}
