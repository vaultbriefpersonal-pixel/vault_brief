"use client";

import { trpc } from "@/lib/api";
import { formatDate } from "@/lib/utils";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  vc_suite: "VC Suite",
};

const TIERS = [
  { key: "starter" as const, label: "Starter" },
  { key: "growth" as const, label: "Growth" },
  { key: "vc_suite" as const, label: "VC Suite" },
];

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
  fontSize: 22,
  fontWeight: 700,
  color: "var(--vb-text)",
  letterSpacing: "-0.02em",
  margin: "0 0 4px",
};

const subtitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 13,
  color: "var(--vb-muted)",
  margin: 0,
  lineHeight: 1.6,
};

const cardStyle: React.CSSProperties = {
  background: "var(--vb-card)",
  border: "1px solid var(--vb-border)",
  borderRadius: 12,
  padding: 20,
};

export function BillingPanel({
  plansAvailable,
}: {
  plansAvailable: Record<"starter" | "growth" | "vc_suite", boolean>;
}) {
  const { data: currentPlan } = trpc.billing.getCurrentPlan.useQuery();
  const portal = trpc.billing.createPortalSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const planKey = currentPlan?.plan ?? "free";

  return (
    <div style={{ padding: "24px 28px", minHeight: "100dvh", maxWidth: 720 }}>
      <h2 style={titleStyle}>Billing</h2>
      <p style={{ ...subtitleStyle, marginBottom: 28 }}>
        Your current plan and payment settings.
      </p>

      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--vb-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: "0 0 8px",
          }}
        >
          Current plan
        </p>
        <p
          style={{
            fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: 24,
            fontWeight: 700,
            color: "var(--vb-text)",
            margin: "0 0 4px",
          }}
        >
          {PLAN_LABELS[planKey] ?? planKey}
        </p>
        {currentPlan?.expiresAt && (
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--vb-dim)",
              margin: "0 0 16px",
            }}
          >
            Renews/expires {formatDate(currentPlan.expiresAt)}
          </p>
        )}

        <button
          type="button"
          onClick={() => portal.mutate()}
          disabled={portal.isPending}
          style={{
            background: "transparent",
            border: "1px solid var(--vb-border)",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 13,
            color: "var(--vb-text)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor: portal.isPending ? "not-allowed" : "pointer",
            marginTop: currentPlan?.expiresAt ? 0 : 16,
          }}
        >
          {portal.isPending ? "Opening…" : "Manage billing"}
        </button>
        {portal.error && (
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--vb-dim)",
              margin: "8px 0 0",
            }}
          >
            {portal.error.message}
          </p>
        )}
      </div>

      <h3
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--vb-muted)",
          margin: "0 0 14px",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        Plans
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
        }}
      >
        {TIERS.map((tier) => {
          const available = plansAvailable[tier.key];
          return (
            <div key={tier.key} style={cardStyle}>
              <p
                style={{
                  fontFamily:
                    "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--vb-text)",
                  margin: "0 0 8px",
                }}
              >
                {tier.label}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 12,
                  color: "var(--vb-dim)",
                  margin: "0 0 16px",
                  lineHeight: 1.5,
                }}
              >
                Pricing hasn&apos;t been finalized yet.
              </p>
              <form action="/api/billing/checkout" method="post">
                <input type="hidden" name="plan" value={tier.key} />
                <input type="hidden" name="interval" value="monthly" />
                <button
                  type="submit"
                  disabled={!available}
                  style={{
                    width: "100%",
                    background: available ? "#00e87b" : "var(--vb-alt)",
                    color: available ? "#0a0a0a" : "var(--vb-dim)",
                    border: available ? "none" : "1px solid var(--vb-border)",
                    borderRadius: 8,
                    padding: "9px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    cursor: available ? "pointer" : "not-allowed",
                  }}
                >
                  {available ? "Upgrade" : "Coming soon"}
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
