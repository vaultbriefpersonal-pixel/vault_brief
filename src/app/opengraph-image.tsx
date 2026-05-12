import { ImageResponse } from "next/og";

// Default OG image for every public marketing route that doesn't ship
// its own opengraph-image.tsx (root, /demo, /pricing, /about, /security,
// /changelog, /docs, /blog index, /privacy, /terms, /cookies, /status).
// Per-post blog images live at src/app/blog/[slug]/opengraph-image.tsx.

export const runtime = "edge";
export const alt =
  "Vault Brief — Investor reports for Web3 teams";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0a0a0a";
const ACCENT = "#00e87b";
const TEXT = "#f5f5f5";
const MUTED = "#a3a3a3";
const DIM = "#525252";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          padding: 80,
          position: "relative",
          // Edge runtime + satori only supports flex; no grid. Stack
          // top, fill, bottom blocks as separate flex sections.
        }}
      >
        {/* Soft accent glow in the top-right corner. ImageResponse
            supports gradient strings as CSS background. */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -160,
            width: 600,
            height: 600,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,232,123,0.18) 0%, rgba(0,232,123,0) 65%)",
            display: "flex",
          }}
        />

        {/* Logo row */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              border: `2px solid ${ACCENT}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: ACCENT,
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            V
          </div>
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: TEXT,
              letterSpacing: "-0.02em",
            }}
          >
            VAULT
          </span>
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: ACCENT,
              letterSpacing: "-0.02em",
            }}
          >
            BRIEF
          </span>
        </div>

        {/* Spacer — pushes content down so the title sits in the visual
            sweet spot. */}
        <div style={{ flex: 1, display: "flex" }} />

        {/* Title block */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <h1
            style={{
              fontSize: 88,
              fontWeight: 700,
              color: TEXT,
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
              margin: 0,
              maxWidth: 980,
            }}
          >
            Investor reports{" "}
            <span style={{ color: ACCENT }}>for Web3 teams</span>
          </h1>
          <p
            style={{
              fontSize: 28,
              color: MUTED,
              lineHeight: 1.4,
              margin: 0,
              maxWidth: 880,
            }}
          >
            Monthly treasury reports from wallets, GitHub activity, and
            token metrics.
          </p>
        </div>

        {/* Footer row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 56,
          }}
        >
          <span
            style={{
              fontSize: 22,
              color: DIM,
              letterSpacing: "0.02em",
            }}
          >
            vaultbrief.io
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 16px",
              borderRadius: 100,
              border: `1px solid rgba(0,232,123,0.35)`,
              background: "rgba(0,232,123,0.08)",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: ACCENT,
                display: "flex",
              }}
            />
            <span style={{ fontSize: 18, color: ACCENT, fontWeight: 600 }}>
              Automated wallet & GitHub reporting
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
