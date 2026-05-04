import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * Trial countdown banner above the dashboard. Three states:
 *
 *   active       (free + trialEndsAt in future)  → show days left + Upgrade
 *   ending-soon  (free + ≤3 days left)            → urgent yellow variant
 *   expired      (free + trialEndsAt in past)     → red read-only notice
 *   none         (paid plan, or no trial info)    → render nothing
 *
 * Server component so the trial state is computed at request time and not
 * cached client-side. Sits in the dashboard layout, so every authed page
 * surfaces the same status.
 */
export async function TrialBanner() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [user] = await db
    .select({
      plan: users.plan,
      trialEndsAt: users.trialEndsAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!user) return null;
  if (user.plan !== "free") return null;
  if (!user.trialEndsAt) return null;

  const now = Date.now();
  const expiresAt = user.trialEndsAt.getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((expiresAt - now) / msPerDay);

  // Three visual variants. Same shape, different color + copy.
  const config =
    daysLeft <= 0
      ? {
          variant: "expired" as const,
          bg: "rgba(248,113,113,0.08)",
          border: "rgba(248,113,113,0.3)",
          accent: "#f87171",
          icon: "🔒",
          message: "Your 14-day trial has ended. Existing data stays visible — upgrade to keep generating new reports.",
        }
      : daysLeft <= 3
        ? {
            variant: "ending-soon" as const,
            bg: "rgba(240,184,71,0.08)",
            border: "rgba(240,184,71,0.3)",
            accent: "#f0b847",
            icon: "⏳",
            message: `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Upgrade now to keep your account active.`,
          }
        : {
            variant: "active" as const,
            bg: "rgba(0,232,123,0.06)",
            border: "rgba(0,232,123,0.2)",
            accent: "#00e87b",
            icon: "🎁",
            message: `${daysLeft} days left in your free trial. Upgrade any time to extend the runway.`,
          };

  return (
    <div
      role="status"
      style={{
        background: config.bg,
        borderBottom: `1px solid ${config.border}`,
        padding: "10px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
          flex: "1 1 320px",
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>
          {config.icon}
        </span>
        <span style={{ color: "var(--vb-text)" }}>
          <strong style={{ color: config.accent }}>
            {config.variant === "expired"
              ? "Trial ended"
              : config.variant === "ending-soon"
                ? `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
                : `${daysLeft} days left in trial`}
          </strong>
          {" — "}
          {config.message.replace(/^[^—]+— ?/, "")}
        </span>
      </div>
      <Link
        href="/billing"
        style={{
          background: config.accent,
          color: "#0a0a0a",
          padding: "7px 14px",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          flexShrink: 0,
        }}
      >
        Upgrade →
      </Link>
    </div>
  );
}
