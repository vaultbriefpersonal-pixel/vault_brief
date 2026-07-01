"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/marketing/Logo";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/projects";

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await signIn("resend", {
      email,
      callbackUrl,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setError(
        result.error === "EmailSignin"
          ? "Could not send the magic link. Check the email address and try again."
          : "Something went wrong. Please try again in a moment."
      );
      return;
    }
    setSent(true);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--vb-alt)",
    border: "1px solid var(--vb-border)",
    borderRadius: 8,
    padding: "12px 14px",
    fontSize: 14,
    color: "var(--vb-text)",
    fontFamily: "var(--font-inter), Inter, sans-serif",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    // <main> landmark — axe-core's `landmark-one-main` rule flags any
    // page that ships without one. Login is a full-page surface
    // (no marketing nav / footer wrapper), so the form itself is the
    // main content.
    <main
      aria-label="Sign in"
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--vb-bg)",
        padding: "48px 24px",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 700,
          height: 400,
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse, rgba(0,232,123,0.07) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <Logo size={22} />
        </div>

        <div
          style={{
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 16,
            padding: "36px 32px",
          }}
        >
          <h1
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: "0 0 6px",
              letterSpacing: "-0.02em",
              textAlign: "center",
            }}
          >
            Sign in to Vault Brief
          </h1>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              color: "var(--vb-dim)",
              margin: "0 0 28px",
              textAlign: "center",
            }}
          >
            Enter your email to continue
          </p>

          {sent ? (
            <div
              style={{
                background: "rgba(0,232,123,0.08)",
                border: "1px solid rgba(0,232,123,0.2)",
                borderRadius: 10,
                padding: "18px 20px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 14,
                  color: "var(--accent)",
                  margin: 0,
                }}
              >
                Magic link sent to{" "}
                <strong style={{ color: "var(--vb-text)" }}>{email}</strong>. Check
                your inbox.
              </p>
            </div>
          ) : (
            <>
              <form
                onSubmit={handleEmailSubmit}
                style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}
              >
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: "100%",
                    background: "#00e87b",
                    color: "#0a0a0a",
                    border: "none",
                    borderRadius: 8,
                    padding: "12px 20px",
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    cursor: loading ? "not-allowed" : "pointer",
                    opacity: loading ? 0.7 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  {loading ? "Sending..." : "Send magic link"}
                </button>
                {error && (
                  <p
                    role="alert"
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "#f87171",
                      margin: 0,
                      lineHeight: 1.5,
                    }}
                  >
                    {error}
                  </p>
                )}
              </form>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: "rgba(255,255,255,0.08)",
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--vb-dim)",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  or
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: "rgba(255,255,255,0.08)",
                  }}
                />
              </div>

              <button
                onClick={() => signIn("google", { callbackUrl })}
                style={{
                  width: "100%",
                  background: "var(--vb-alt)",
                  border: "1px solid var(--vb-border)",
                  borderRadius: 8,
                  padding: "12px 20px",
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "var(--vb-text)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </button>
            </>
          )}
        </div>

        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--vb-dim)",
            textAlign: "center",
            marginTop: 20,
            lineHeight: 1.5,
          }}
        >
          New here? Enter your email and we&apos;ll create your account
          automatically.
          <br />
          <span style={{ color: "var(--vb-muted)", fontSize: 12 }}>
            Free to use — no credit card, no paid plans.
          </span>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
