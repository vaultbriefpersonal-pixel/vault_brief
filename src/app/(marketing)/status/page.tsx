import type { Metadata } from "next";
import { runHealthChecks, type ServiceCheck } from "@/server/services/health-checks";

export const metadata: Metadata = {
  title: "Status — Vault Brief",
  description: "Real-time status of Vault Brief services.",
};

// Re-run checks at most once per minute. Each render hits external APIs
// (Resend, Stripe, OpenRouter, Dune, Alchemy) so we don't want to ping
// upstream on every page load.
export const revalidate = 60;

const STATUS_COLOR: Record<string, string> = {
  operational: "#00e87b",
  degraded: "#f0b847",
  outage: "#f87171",
};

const STATUS_LABEL: Record<string, string> = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
};

const INCIDENTS: { date: string; title: string; status: string; desc: string }[] = [];

function formatLatency(check: ServiceCheck): string {
  if (check.detail === "not configured") return "—";
  if (check.latencyMs === null) return "—";
  return `${check.latencyMs} ms`;
}

export default async function StatusPage() {
  const health = await runHealthChecks();
  const allOperational = health.overall === "operational";

  const headlineLabel =
    health.overall === "operational"
      ? "All systems operational"
      : health.overall === "degraded"
        ? "Some systems degraded"
        : "Service disruption";

  const ringColor = allOperational
    ? "rgba(0,232,123,0.3)"
    : health.overall === "degraded"
      ? "rgba(240,184,71,0.3)"
      : "rgba(248,113,113,0.3)";
  const ringBg = allOperational
    ? "rgba(0,232,123,0.12)"
    : health.overall === "degraded"
      ? "rgba(240,184,71,0.12)"
      : "rgba(248,113,113,0.12)";

  return (
    <div style={{ paddingTop: 72 }}>
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 80,
          paddingBottom: 120,
          maxWidth: 800,
          margin: "0 auto",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: ringBg,
              border: `2px solid ${ringColor}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
              fontSize: 24,
            }}
          >
            {allOperational ? "✓" : "!"}
          </div>
          <h1
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 36,
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              margin: "0 0 10px",
            }}
          >
            {headlineLabel}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 15,
              color: "var(--vb-muted)",
              margin: 0,
            }}
          >
            For real-time issues, email{" "}
            <a
              href="mailto:hello@vaultbrief.io?subject=Status%20issue"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              hello@vaultbrief.io
            </a>
          </p>
        </div>

        {/* Services */}
        <div
          style={{
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 14,
            overflow: "hidden",
            marginBottom: 24,
          }}
        >
          {health.checks.map((svc, i) => (
            <div
              key={svc.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 24px",
                borderBottom:
                  i < health.checks.length - 1
                    ? "1px solid rgba(255,255,255,0.06)"
                    : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: STATUS_COLOR[svc.status],
                    display: "inline-block",
                  }}
                />
                <div>
                  <div
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 15,
                      color: "var(--vb-text)",
                    }}
                  >
                    {svc.name}
                  </div>
                  {svc.detail && (
                    <div
                      style={{
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        fontSize: 11.5,
                        color: "#666666",
                        marginTop: 2,
                      }}
                    >
                      {svc.detail}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: STATUS_COLOR[svc.status],
                    fontWeight: 500,
                  }}
                >
                  {STATUS_LABEL[svc.status]}
                </div>
                <div
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
                    fontSize: 11,
                    color: "var(--vb-dim)",
                    marginTop: 2,
                  }}
                >
                  {formatLatency(svc)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "var(--vb-dim)",
            margin: "0 0 48px",
            lineHeight: 1.6,
            textAlign: "center",
          }}
        >
          Checks performed{" "}
          {new Date(health.checkedAt).toLocaleString("en-US", {
            timeZone: "UTC",
            dateStyle: "medium",
            timeStyle: "medium",
          })}{" "}
          UTC · cached up to 60s · machine-readable JSON at{" "}
          <a
            href="/api/health"
            style={{ color: "var(--vb-muted)", textDecoration: "underline" }}
          >
            /api/health
          </a>
        </p>

        {/* Incidents — only render the section once we actually have one to
            report. An empty "Past incidents · No incidents reported" stub
            historically read as "site is so new we have nothing to say"
            rather than "stable." Hide entirely instead. */}
        {INCIDENTS.length > 0 && (
          <>
            <h2
              style={{
                fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: 22,
                fontWeight: 600,
                color: "var(--vb-text)",
                margin: "0 0 24px",
                letterSpacing: "-0.02em",
              }}
            >
              Past incidents
            </h2>
            {INCIDENTS.map((inc) => (
            <div
              key={inc.title}
              style={{
                background: "var(--vb-card)",
                border: "1px solid var(--vb-border)",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <h3
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    margin: 0,
                  }}
                >
                  {inc.title}
                </h3>
                <span
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 12,
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  {inc.status}
                </span>
              </div>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 12,
                  color: "var(--vb-dim)",
                  margin: "0 0 10px",
                }}
              >
                {inc.date}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 14,
                  color: "var(--vb-muted)",
                  lineHeight: 1.65,
                  margin: 0,
                }}
              >
                {inc.desc}
              </p>
            </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
