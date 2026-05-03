import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Status — VaultBrief",
  description: "Real-time status of VaultBrief services.",
};

// Services we report on. Status is currently a placeholder ("operational" by
// assumption — if the site loads, the API and dashboard are up). Replace this
// list with a fetch from a real monitoring backend (Better Stack / Statuspage /
// OneUptime / Vercel checks) when one is wired up; uptime % values were
// removed because publishing fake numbers misleads investors.
const SERVICES: { name: string; status: "operational" | "degraded" | "outage" }[] = [
  { name: "API", status: "operational" },
  { name: "Dashboard", status: "operational" },
  { name: "Report Generation", status: "operational" },
  { name: "PDF Export", status: "operational" },
  { name: "Monthly Sync Jobs", status: "operational" },
  { name: "Email Delivery", status: "operational" },
  { name: "Investor Portal", status: "operational" },
  { name: "Webhook Delivery", status: "operational" },
];

// Source-of-truth list of public incidents. Empty by default — populate when
// something actually goes wrong, with the date and resolution.
const INCIDENTS: { date: string; title: string; status: string; desc: string }[] = [];

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

export default function StatusPage() {
  const allOperational = SERVICES.every((s) => s.status === "operational");

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
              background: allOperational
                ? "rgba(0,232,123,0.12)"
                : "rgba(248,113,113,0.12)",
              border: allOperational
                ? "2px solid rgba(0,232,123,0.3)"
                : "2px solid rgba(248,113,113,0.3)",
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
              color: "#f0f0f0",
              letterSpacing: "-0.03em",
              margin: "0 0 10px",
            }}
          >
            {allOperational ? "All systems operational" : "Service disruption"}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 15,
              color: "#888888",
              margin: 0,
            }}
          >
            For real-time issues, email{" "}
            <a
              href="mailto:support@vaultbrief.io"
              style={{ color: "#00e87b", textDecoration: "none" }}
            >
              support@vaultbrief.io
            </a>
          </p>
        </div>

        {/* Services */}
        <div
          style={{
            background: "#161616",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 14,
            overflow: "hidden",
            marginBottom: 48,
          }}
        >
          {SERVICES.map((svc, i) => (
            <div
              key={svc.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 24px",
                borderBottom:
                  i < SERVICES.length - 1
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
                <span
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14.5,
                    color: "#f0f0f0",
                  }}
                >
                  {svc.name}
                </span>
              </div>
              <span
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color: STATUS_COLOR[svc.status],
                  fontWeight: 500,
                }}
              >
                {STATUS_LABEL[svc.status]}
              </span>
            </div>
          ))}
        </div>

        {/* Uptime disclosure — be honest until real monitoring is plugged in. */}
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "#555555",
            margin: "0 0 48px",
            lineHeight: 1.6,
            textAlign: "center",
          }}
        >
          Detailed uptime metrics will appear here once the monitoring backend
          is connected. We don&apos;t publish numbers we can&apos;t back up.
        </p>

        {/* Incidents */}
        <h2
          style={{
            fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: 22,
            fontWeight: 600,
            color: "#f0f0f0",
            margin: "0 0 24px",
            letterSpacing: "-0.02em",
          }}
        >
          Past incidents
        </h2>
        {INCIDENTS.length === 0 ? (
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              color: "#555555",
            }}
          >
            No incidents reported.
          </p>
        ) : (
          INCIDENTS.map((inc) => (
            <div
              key={inc.title}
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.08)",
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
                    color: "#f0f0f0",
                    margin: 0,
                  }}
                >
                  {inc.title}
                </h3>
                <span
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 12,
                    color: "#00e87b",
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
                  color: "#555555",
                  margin: "0 0 10px",
                }}
              >
                {inc.date}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 14,
                  color: "#888888",
                  lineHeight: 1.65,
                  margin: 0,
                }}
              >
                {inc.desc}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
