import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { users, projects } from "@/server/db/schema";
import { eq, count } from "drizzle-orm";
import Link from "next/link";
import { Check } from "lucide-react";
import { PayWithUsdcButton } from "@/components/billing/PayWithUsdcButton";
import { ATLOS_PLAN_AMOUNTS, type AtlosPlan } from "@/lib/atlos";

const PLAN_DETAILS: Record<
  string,
  { label: string; projectLimit: string; walletLimit: string; price: string; features: string[] }
> = {
  free: {
    label: "Free Trial",
    projectLimit: "1",
    walletLimit: "5",
    price: "$0",
    // Limits below mirror PLAN_PROJECT_LIMITS / PLAN_WALLET_LIMITS in the
    // tRPC routers — keep in sync. Trial is generous (5 wallets) so the
    // first-time user can connect a real multi-chain treasury without
    // hitting an upsell wall before they see value.
    features: ["1 project", "Up to 5 wallets (any chain)", "1 GitHub org", "Monthly PDF reports", "Email distribution"],
  },
  starter: {
    label: "Seed",
    projectLimit: "1",
    walletLimit: "5",
    price: "$99",
    features: ["1 project", "Up to 5 wallets", "1 GitHub org", "Monthly PDF reports", "Email distribution"],
  },
  growth: {
    label: "Growth",
    projectLimit: "3",
    walletLimit: "10",
    price: "$299",
    features: ["3 projects", "10 wallets", "5 GitHub repos", "AI-written narratives", "Custom branding", "Investor portal", "Multi-chain support"],
  },
  vc_suite: {
    label: "VC Suite",
    projectLimit: "∞",
    walletLimit: "∞",
    price: "$799",
    features: ["Unlimited projects", "Unlimited wallets", "Unlimited repos", "Portfolio dashboard", "White-label reports", "API access", "Dedicated CSM"],
  },
};

export default async function BillingPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [user] = await db
    .select({
      plan: users.plan,
      planExpiresAt: users.planExpiresAt,
      paymentProvider: users.paymentProvider,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, userId));

  const currentPlan = user?.plan ?? "free";
  const planInfo = PLAN_DETAILS[currentPlan] ?? PLAN_DETAILS.free;

  const [projectCount] = await db
    .select({ value: count() })
    .from(projects)
    .where(eq(projects.userId, userId));

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-inter), Inter, sans-serif",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--vb-dim)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    margin: "0 0 8px",
  };

  const valStyle: React.CSSProperties = {
    fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
    fontSize: 24,
    fontWeight: 700,
    color: "var(--vb-text)",
    margin: 0,
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--vb-card)",
    border: "1px solid var(--vb-border)",
    borderRadius: 12,
    padding: "28px",
  };

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <h2
        style={{
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--vb-text)",
          margin: "0 0 20px",
          letterSpacing: "-0.02em",
        }}
      >
        Billing
      </h2>

      <div className="vb-stack-mobile" style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 20, flex: 1 }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Current plan card */}
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 20,
              }}
            >
              <div>
                <p style={labelStyle}>Current plan</p>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <p style={valStyle}>{planInfo.label}</p>
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 15,
                      color: "var(--accent)",
                    }}
                  >
                    {planInfo.price}/mo
                  </span>
                </div>
              </div>
              <Link
                href="/pricing"
                style={{
                  background: "transparent",
                  border: "1px solid var(--vb-border)",
                  borderRadius: 6,
                  padding: "9px 18px",
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "var(--vb-muted)",
                  textDecoration: "none",
                }}
              >
                Change plan
              </Link>
            </div>

            <div className="vb-grid-2" style={{ gap: 14 }}>
              <div
                style={{
                  background: "var(--vb-bg)",
                  borderRadius: 10,
                  padding: "18px 20px",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <p style={labelStyle}>Projects used</p>
                <p style={{ ...valStyle, fontSize: 20 }}>
                  {projectCount?.value ?? 0}
                  <span style={{ color: "var(--vb-dim)", fontSize: 15, fontWeight: 400 }}>
                    {" "}/ {planInfo.projectLimit}
                  </span>
                </p>
              </div>
              <div
                style={{
                  background: "var(--vb-bg)",
                  borderRadius: 10,
                  padding: "18px 20px",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <p style={labelStyle}>Billing period</p>
                <p style={{ ...valStyle, fontSize: 20 }}>
                  {currentPlan === "free" ? "Trial" : "Monthly"}
                </p>
              </div>
            </div>
          </div>

          {/* Payment method */}
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <p style={labelStyle}>Payment method</p>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 15,
                    color: "var(--vb-muted)",
                    margin: 0,
                  }}
                >
                  {currentPlan === "free"
                    ? "No payment method on file"
                    : user?.paymentProvider === "atlos"
                      ? "Crypto (USDC via ATLOS)"
                      : "Managed via Stripe"}
                </p>
              </div>
              {currentPlan !== "free" && (
                <button
                  style={{
                    background: "transparent",
                    border: "1px solid var(--vb-border)",
                    borderRadius: 6,
                    padding: "9px 18px",
                    fontSize: 14,
                    fontWeight: 500,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "var(--vb-muted)",
                    cursor: "pointer",
                  }}
                >
                  Manage
                </button>
              )}
            </div>
          </div>

          {/* Invoices */}
          <div style={{ ...cardStyle, flex: 1 }}>
            <p style={labelStyle}>Invoice history</p>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 15,
                color: "var(--vb-dim)",
                margin: 0,
              }}
            >
              {currentPlan === "free"
                ? "No invoices yet. Invoices will appear here after you subscribe."
                : "Invoices are available in the Stripe customer portal."}
            </p>
          </div>
        </div>

        {/* Right column — plan features */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={cardStyle}>
            <p style={labelStyle}>Included in {planInfo.label}</p>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {planInfo.features.map((f) => (
                <li
                  key={f}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 15,
                    color: "var(--vb-muted)",
                  }}
                >
                  <Check size={15} color="#00e87b" style={{ flexShrink: 0 }} />
                  {f}
                </li>
              ))}
            </ul>

            {currentPlan === "free" && (
              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 12,
                    color: "var(--vb-dim)",
                    margin: "0 0 4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    fontWeight: 600,
                  }}
                >
                  Pay with USDC — any chain
                </p>
                {(["starter", "growth", "vc_suite"] as AtlosPlan[]).map((p) => (
                  <PayWithUsdcButton
                    key={p}
                    userId={userId}
                    userEmail={user?.email ?? undefined}
                    userName={user?.name ?? undefined}
                    plan={p}
                    amount={ATLOS_PLAN_AMOUNTS[p]}
                    variant={p === "growth" ? "primary" : "secondary"}
                  >
                    {p === "starter" && "Seed — $99/mo"}
                    {p === "growth" && "Growth — $299/mo"}
                    {p === "vc_suite" && "VC Suite — $799/mo"}
                  </PayWithUsdcButton>
                ))}
                <Link
                  href="/pricing"
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: "var(--vb-dim)",
                    textAlign: "center",
                    textDecoration: "none",
                    marginTop: 4,
                  }}
                >
                  Or pay with card →
                </Link>
              </div>
            )}
          </div>

          {/* Onboarding nudge — only render for users with zero projects.
              Once they've shipped their first project this card becomes
              noise; switch to a "Manage projects" pointer instead. */}
          <div
            style={{
              ...cardStyle,
              background: "rgba(0,232,123,0.04)",
              border: "1px solid rgba(0,232,123,0.1)",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: 16,
                fontWeight: 600,
                color: "var(--vb-text)",
                margin: "0 0 10px",
              }}
            >
              {(projectCount?.value ?? 0) === 0 ? "Getting started" : "Your projects"}
            </p>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 15,
                color: "var(--vb-muted)",
                margin: "0 0 6px",
                lineHeight: 1.6,
              }}
            >
              {(projectCount?.value ?? 0) === 0
                ? "Create a project, connect a wallet, and generate your first investor report in under 5 minutes."
                : `You're tracking ${projectCount?.value} project${(projectCount?.value ?? 0) === 1 ? "" : "s"}. Open Projects to manage wallets, run a sync, or send a report.`}
            </p>
            <Link
              href={(projectCount?.value ?? 0) === 0 ? "/projects/new" : "/projects"}
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 15,
                color: "var(--accent)",
                textDecoration: "none",
                fontWeight: 500,
                display: "inline-block",
                marginTop: 8,
              }}
            >
              {(projectCount?.value ?? 0) === 0
                ? "Create your first project →"
                : "Open Projects →"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
