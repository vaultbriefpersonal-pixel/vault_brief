import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { POSTS } from "@/lib/blog-posts";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) return { title: "Blog — VaultBrief" };
  return {
    title: `${post.title} — VaultBrief`,
    description: post.excerpt,
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) notFound();

  return (
    <div style={{ paddingTop: 72 }}>
      <section className="vb-pad-x" style={{ paddingTop: 80, paddingBottom: 120 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <Link
            href="/blog"
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "#555555",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 40,
            }}
          >
            ← Back to Blog
          </Link>

          <div
            style={{
              display: "inline-block",
              padding: "4px 12px",
              background: "rgba(0,232,123,0.12)",
              color: "#00e87b",
              borderRadius: 100,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 20,
            }}
          >
            {post.category}
          </div>

          <h1
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(28px, 4vw, 40px)",
              fontWeight: 700,
              color: "#f0f0f0",
              letterSpacing: "-0.03em",
              margin: "0 0 16px",
              lineHeight: 1.15,
            }}
          >
            {post.title}
          </h1>

          <div
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "#555555",
              marginBottom: 48,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              paddingBottom: 24,
            }}
          >
            {post.date} · {post.readTime}
          </div>

          <div
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 16,
              color: "#888888",
              lineHeight: 1.8,
            }}
          >
            {post.content.map((section, i) => {
              if (section.type === "lead") {
                return (
                  <p
                    key={i}
                    style={{ margin: "0 0 28px", color: "#cccccc", fontSize: 17, lineHeight: 1.7 }}
                  >
                    {section.text}
                  </p>
                );
              }
              if (section.type === "h2") {
                return (
                  <h2
                    key={i}
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                      fontSize: 24,
                      fontWeight: 600,
                      color: "#f0f0f0",
                      margin: "40px 0 16px",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {section.text}
                  </h2>
                );
              }
              if (section.type === "code") {
                return (
                  <div
                    key={i}
                    style={{
                      background: "#161616",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      padding: 24,
                      margin: "24px 0",
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 13.5,
                      color: "#00e87b",
                      lineHeight: 1.65,
                      whiteSpace: "pre",
                      overflowX: "auto",
                    }}
                  >
                    {section.code}
                  </div>
                );
              }
              return (
                <p key={i} style={{ margin: "0 0 20px" }}>
                  {section.text}
                </p>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 64,
              padding: 32,
              background: "#161616",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14,
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: 22,
                fontWeight: 600,
                color: "#f0f0f0",
                margin: "0 0 8px",
              }}
            >
              Get these metrics in every report automatically
            </p>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 14,
                color: "#888888",
                margin: "0 0 20px",
              }}
            >
              VaultBrief generates investor-ready reports from your on-chain
              data. No spreadsheets.
            </p>
            <Link
              href="/login"
              style={{
                background: "#00e87b",
                color: "#0a0a0a",
                borderRadius: 8,
                padding: "12px 28px",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
