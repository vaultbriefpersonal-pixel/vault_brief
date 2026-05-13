import { ImageResponse } from "next/og";
import { POSTS } from "@/lib/blog-posts";

// Per-blog-post OG image. Each post gets its own preview card so a
// share to Telegram / Twitter / LinkedIn shows the actual post title +
// category.
//
// IMPORTANT (Next.js 16): we run on the default nodejs runtime, NOT
// edge. `generateImageMetadata` (which we previously used for the
// `alt` text) compiles to a synthetic `[__metadata_id__]` route that
// needs `generateStaticParams` internally — and edge runtime is
// incompatible with `generateStaticParams`. Build error:
//   "Edge runtime is not supported with `generateStaticParams`"
// We dropped `generateImageMetadata` (only needed for multi-image
// per route) and prerender every known slug via `generateStaticParams`.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Vault Brief — Blog post";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

const BG = "#0a0a0a";
const ACCENT = "#00e87b";
const TEXT = "#f5f5f5";
const MUTED = "#a3a3a3";
const DIM = "#525252";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);

  // Defensive title — if we ever miss a slug-to-post lookup, fall back
  // to the generic brand frame rather than crashing the OG endpoint.
  const title = post?.title ?? "Vault Brief Blog";
  const category = post?.category ?? "Web3";
  const readTime = post?.readTime ?? "";

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
        }}
      >
        {/* Accent glow */}
        <div
          style={{
            position: "absolute",
            top: -180,
            left: -180,
            width: 560,
            height: 560,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,232,123,0.18) 0%, rgba(0,232,123,0) 65%)",
            display: "flex",
          }}
        />

        {/* Logo + category pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 18px",
              borderRadius: 100,
              border: `1px solid rgba(0,232,123,0.35)`,
              background: "rgba(0,232,123,0.08)",
            }}
          >
            <span
              style={{
                fontSize: 18,
                color: ACCENT,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {category}
            </span>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex" }} />

        {/* Title — clamp to keep two-line max in most cases. We don't
            have a real text-clamp in satori, so rely on font sizing.
            Long titles will simply wrap to three lines. */}
        <h1
          style={{
            fontSize: title.length > 60 ? 64 : 76,
            fontWeight: 700,
            color: TEXT,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            margin: 0,
            maxWidth: 1040,
          }}
        >
          {title}
        </h1>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 40,
          }}
        >
          <span
            style={{
              fontSize: 22,
              color: DIM,
              letterSpacing: "0.02em",
            }}
          >
            vaultbrief.io / blog
          </span>
          {readTime && (
            <span
              style={{
                fontSize: 20,
                color: MUTED,
                fontWeight: 500,
              }}
            >
              {readTime}
            </span>
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
