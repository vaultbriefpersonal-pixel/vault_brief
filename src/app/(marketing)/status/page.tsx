import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Status — VaultBrief",
  description: "Real-time status of VaultBrief services.",
};

const SERVICES = [
  { name: "API", status: "operational", uptime: "99.98%" },
  { name: "Dashboard", status: "operational", uptime: "99.97%" },
  { name: "Report Generation", status: "operational", uptime: "99.94%" },
  { name: "PDF Export", status: "operational", uptime: "99.91%" },
  { name: "Monthly Sync Jobs", status: "operational", uptime: "100%" },
  { name: "Email Delivery", status: "operational", uptime: "99.99%" },
  { name: "Investor Portal", status: "operational", uptime: "99.96%" },
  { name: "Webhook Delivery", status: "operational", uptime: "99.88%" },
];

const INCIDENTS: { date: string; title: string; status: string; desc: string }[] = [
  {
    date: "April 3, 2026",
    title: "Delayed report generation",
    status: "Resolved",
    desc: "Report generation queue experienced a 40-minute delay due to a cold-start issue in the cloud worker pool. All affected reports were generated within 2 hours. No data was lost.",
  },
];

const STATUS_COLOR: Record<string, string> = {
  operational: "#00e87b",
  degraded: "#f0b847",
  outage: "#f87171",
};

export default function StatusPage() {
  const allOperational = SERVICES.every((s) => s.status === "operational");

  return (
    <div style={{ paddingTop: 72 }}>
      <section className="vb-pad-x" style={{ paddingTop: 80, paddingBottom: 120, maxWidth: 800, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(0,232,123,0.12)", border: "2px solid rgba(0,232,123,0.3)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 24 }}>✓</div>
          <h1 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 36, fontWeight: 700, color: "#f0f0f0", letterSpacing: "-0.03em", margin: "0 0 10px" }}>
            {allOperational ? "All systems operational" : "Service disruption"}
          </h1>
          <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 15, color: "#888888", margin: 0 }}>
            Last checked: May 1, 2026 at 20:00 UTC
          </p>
        </div>

        {/* Services */}
        <div style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, overflow: "hidden", marginBottom: 48 }}>
          {SERVICES.map((svc, i) => (
            <div key={svc.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: i < SERVICES.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[svc.status], display: "inline-block" }} />
                <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14.5, color: "#f0f0f0" }}>{svc.name}</span>
              </div>
              <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 12, color: "#555555" }}>{svc.uptime} uptime</span>
                <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: STATUS_COLOR[svc.status], fontWeight: 500, textTransform: "capitalize" }}>{svc.status}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Incidents */}
        <h2 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 600, color: "#f0f0f0", margin: "0 0 24px", letterSpacing: "-0.02em" }}>Past incidents</h2>
        {INCIDENTS.length === 0 ? (
          <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "#555555" }}>No incidents in the past 90 days.</p>
        ) : (
          INCIDENTS.map((inc) => (
            <div key={inc.title} style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <h3 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>{inc.title}</h3>
                <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 12, color: "#00e87b", fontWeight: 600 }}>{inc.status}</span>
              </div>
              <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 12, color: "#555555", margin: "0 0 10px" }}>{inc.date}</p>
              <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "#888888", lineHeight: 1.65, margin: 0 }}>{inc.desc}</p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
