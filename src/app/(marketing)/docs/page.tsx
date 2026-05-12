import type { Metadata } from "next";
import { ApiWaitlistForm } from "@/components/marketing/ApiWaitlistForm";

export const metadata: Metadata = {
  title: "API — Vault Brief",
  description:
    "Public API for Vault Brief is in development. Sign up to be notified when read-only project, treasury, and report endpoints land.",
};

// The original /docs shipped a 1063-line API reference for an API that
// doesn't exist yet — that read as overpromising. This page replaces it
// with an honest roadmap stub + waitlist. When the API lands the body
// gets re-filled from the legacy content (preserved in git history if
// we want to recover it).
export default function DocsPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 100,
          paddingBottom: 80,
          maxWidth: 720,
          margin: "0 auto",
          textAlign: "center",
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.04) 0%, transparent 100%)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--accent)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          Roadmap
        </p>
        <h1
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: "clamp(36px, 5vw, 56px)",
            fontWeight: 700,
            color: "var(--vb-text)",
            letterSpacing: "-0.035em",
            margin: "0 0 24px",
            lineHeight: 1.1,
          }}
        >
          Public API — on the roadmap
        </h1>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 17,
            color: "var(--vb-muted)",
            lineHeight: 1.7,
            margin: 0,
          }}
        >
          Read-only endpoints for projects, treasury snapshots, and
          reports. Programmatic access for funds running portfolio
          dashboards, custom widgets on investor portals, and integrations
          with internal accounting tools.
        </p>
      </section>

      <section
        className="vb-section-sm"
        style={{ background: "var(--vb-alt)" }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: "0 0 16px",
              letterSpacing: "-0.02em",
            }}
          >
            What it will expose
          </h2>
          <ul
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 15,
              color: "var(--vb-muted)",
              lineHeight: 1.7,
              margin: "0 0 32px",
              paddingLeft: 20,
            }}
          >
            <li>
              <strong style={{ color: "var(--vb-text)" }}>
                GET /v1/projects
              </strong>{" "}
              — list your projects with their latest snapshot summary
            </li>
            <li>
              <strong style={{ color: "var(--vb-text)" }}>
                GET /v1/projects/:id/snapshots
              </strong>{" "}
              — historical treasury snapshots with all balance + flow fields
            </li>
            <li>
              <strong style={{ color: "var(--vb-text)" }}>
                GET /v1/projects/:id/reports
              </strong>{" "}
              — generated reports (Markdown + PDF URLs)
            </li>
            <li>
              <strong style={{ color: "var(--vb-text)" }}>
                POST /v1/projects/:id/sync
              </strong>{" "}
              — trigger an on-demand sync (rate-limited per plan tier)
            </li>
          </ul>

          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: "32px 0 16px",
              letterSpacing: "-0.02em",
            }}
          >
            Get notified when it ships
          </h2>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 15,
              color: "var(--vb-muted)",
              lineHeight: 1.6,
              margin: "0 0 20px",
            }}
          >
            One email when the API opens. No marketing.
          </p>
          <ApiWaitlistForm />
        </div>
      </section>
    </div>
  );
}
