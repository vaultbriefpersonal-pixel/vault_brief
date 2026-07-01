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
  if (!post) return { title: "Blog — Vault Brief" };
  return {
    title: `${post.title} — Vault Brief`,
    description: post.excerpt,
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) notFound();

  // JSON-LD Article schema for Google rich snippets. `headline`,
  // `datePublished`, and `author` are the three fields Search Console
  // calls out as required for the Article rich result; everything
  // else is enhancement. The image points at the per-post OG which is
  // already SSG-prerendered for every slug.
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: parseDateToIso(post.date),
    author: {
      "@type": "Organization",
      name: "Vault Brief",
      url: "https://vaultbrief.io",
    },
    publisher: {
      "@type": "Organization",
      name: "Vault Brief",
      url: "https://vaultbrief.io",
    },
    image: `https://vaultbrief.io/blog/${post.slug}/opengraph-image`,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://vaultbrief.io/blog/${post.slug}`,
    },
    articleSection: post.category,
  };

  return (
    <div style={{ paddingTop: 72 }}>
      <script
        type="application/ld+json"
        // JSON-LD payload — safe to inject as-is because we control
        // every field above. No user input.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <section className="vb-pad-x" style={{ paddingTop: 80, paddingBottom: 120 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <Link
            href="/blog"
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "var(--vb-dim)",
              textDecoration: "none",
              display: "flex",
              width: "fit-content",
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
              color: "var(--accent)",
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
              color: "var(--vb-text)",
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
              color: "var(--vb-dim)",
              marginBottom: 48,
              borderBottom: "1px solid var(--vb-border)",
              paddingBottom: 24,
            }}
          >
            {post.date} · {post.readTime}
          </div>

          <div
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 16,
              color: "var(--vb-muted)",
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
                      color: "var(--vb-text)",
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
                      background: "var(--vb-card)",
                      border: "1px solid var(--vb-border)",
                      borderRadius: 10,
                      padding: 24,
                      margin: "24px 0",
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 13,
                      color: "var(--accent)",
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
              background: "var(--vb-card)",
              border: "1px solid var(--vb-border)",
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
                color: "var(--vb-text)",
                margin: "0 0 8px",
              }}
            >
              Get these metrics in every report automatically
            </p>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 14,
                color: "var(--vb-muted)",
                margin: "0 0 20px",
              }}
            >
              Vault Brief generates investor-ready reports from your on-chain
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
              Get started free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Parse the human-readable post date ("May 2026", "April 28, 2026") to
 * an ISO 8601 string the schema.org spec wants. Falls back to the
 * year-month-1 form when the post only carries a month.
 */
function parseDateToIso(raw: string): string {
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  // "May 2026" → "2026-05-01"
  const m = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const monthIdx = new Date(`${m[1]} 1, ${m[2]}`).getMonth();
    if (!Number.isNaN(monthIdx)) {
      const mm = String(monthIdx + 1).padStart(2, "0");
      return `${m[2]}-${mm}-01`;
    }
  }
  return raw;
}
