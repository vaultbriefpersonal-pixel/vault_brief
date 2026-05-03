import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { users, projects } from "@/server/db/schema";
import { eq, count } from "drizzle-orm";
import Link from "next/link";
import { Check } from "lucide-react";

const PLAN_DETAILS: Record<
  string,
  { label: string; projectLimit: string; walletLimit: string; price: string; features: string[] }
> = {
  free: {
    label: "Free Trial",
    projectLimit: "1",
    walletLimit: "1",
    price: "$0",
    features: ["1 project", "1 wallet", "1 GitHub repo", "Monthly PDF reports", "Email distribution"],
  },
  starter: {
    label: "Seed",
    projectLimit: "1",
    walletLimit: "1",
    price: "$99",
    features: ["1 project", "1 wallet", "1 GitHub repo", "Monthly PDF reports", "Email distribution"],
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
    .select({ plan: users.plan, planExpiresAt: users.planExpiresAt })
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
    color: "#555555",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    margin: "0 0 8px",
  };

  const valStyle: React.CSSProperties = {
    fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
    fontSize: 24,
    fontWeight: 700,
    color: "#f0f0f0",
    margin: 0,
  };

  const cardStyle: React.CSSProperties = {
    background: "#161616",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: "28px",
  };

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <h2
        style={{
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 18,
          fontWeight: 700,
          color: "#f0f0f0",
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
                      color: "#00e87b",
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
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6,
                  padding: "9px 18px",
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  color: "#888888",
                  textDecoration: "none",
                }}
              >
                Change plan
              </Link>
            </div>

            <div className="vb-grid-2" style={{ gap: 14 }}>
              <div
                style={{
                  background: "#0a0a0a",
                  borderRadius: 10,
                  padding: "18px 20px",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <p style={labelStyle}>Projects used</p>
                <p style={{ ...valStyle, fontSize: 20 }}>
                  {projectCount?.value ?? 0}
                  <span style={{ color: "#555555", fontSize: 15, fontWeight: 400 }}>
                    {" "}/ {planInfo.projectLimit}
                  </span>
                </p>
              </div>
              <div
                style={{
                  background: "#0a0a0a",
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
                    color: "#888888",
                    margin: 0,
                  }}
                >
                  {currentPlan === "free"
                    ? "No payment method on file"
                    : "Managed via Stripe"}
                </p>
              </div>
              {currentPlan !== "free" && (
                <button
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 6,
                    padding: "9px 18px",
                    fontSize: 14,
                    fontWeight: 500,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    color: "#888888",
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
                color: "#555555",
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
                    color: "#888888",
                  }}
                >
                  <Check size={15} color="#00e87b" style={{ flexShrink: 0 }} />
                  {f}
                </li>
              ))}
            </ul>

            {currentPlan === "free" && (
              <Link
                href="/pricing"
                style={{
                  display: "block",
                  background: "#00e87b",
                  color: "#0a0a0a",
                  borderRadius: 8,
                  padding: "14px 24px",
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  textDecoration: "none",
                  textAlign: "center",
                  marginTop: 20,
                }}
              >
                Upgrade plan
              </Link>
            )}
          </div>

          {/* Usage tips */}
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
                color: "#f0f0f0",
                margin: "0 0 10px",
              }}
            >
              Getting started
            </p>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 15,
                color: "#888888",
                margin: "0 0 6px",
                lineHeight: 1.6,
              }}
            >
              Create a project, connect a wallet, and generate your first investor report in under 5 minutes.
            </p>
            <Link
              href="/projects/new"
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 15,
                color: "#00e87b",
                textDecoration: "none",
                fontWeight: 500,
                display: "inline-block",
                marginTop: 8,
              }}
            >
              Create your first project →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
