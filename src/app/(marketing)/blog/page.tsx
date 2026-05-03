"use client";

import { useState } from "react";
import Link from "next/link";
import { POSTS } from "@/lib/blog-posts";

const CATEGORIES = [
  "All",
  "Treasury Management",
  "Investor Relations",
  "Web3 Finance",
  "Product Updates",
];


const s = {
  label: {
    fontFamily: "var(--font-inter), Inter, sans-serif",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
};

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState("All");
  const featured = POSTS.find((p) => p.featured);
  const rest = POSTS.filter((p) => !p.featured);
  const filteredPosts = activeCategory === "All"
    ? rest
    : rest.filter((p) => p.category === activeCategory);

  return (
    <div style={{ paddingTop: 72 }}>
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 80,
          paddingBottom: 60,
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.04) 0%, transparent 100%)",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <p style={{ ...s.label, color: "var(--accent)", marginBottom: 12 }}>
            Blog
          </p>
          <h1
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(36px, 5vw, 56px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              margin: "0 0 48px",
            }}
          >
            Insights on treasury and investor relations
          </h1>

          {/* Category filter - visual only */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  padding: "6px 16px",
                  borderRadius: 100,
                  background: cat === activeCategory ? "#00e87b" : "transparent",
                  color: cat === activeCategory ? "#0a0a0a" : "#888888",
                  border:
                    cat === activeCategory ? "none" : "1px solid rgba(255,255,255,0.08)",
                  ...s.label,
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                  outline: "none",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="vb-pad-x" style={{ paddingTop: 60, paddingBottom: 120 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          {/* Featured */}
          {featured && (
            <Link
              href={`/blog/${featured.slug}`}
              style={{ textDecoration: "none", display: "block", marginBottom: 48 }}
            >
              <div
                className="card-hover vb-grid-2"
                style={{
                  background: "var(--vb-card)",
                  borderRadius: 16,
                  border: "1px solid var(--vb-border)",
                  padding: 48,
                  gap: 48,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                    <span
                      style={{
                        ...s.label,
                        color: "var(--accent)",
                        padding: "4px 12px",
                        background: "rgba(0,232,123,0.12)",
                        borderRadius: 100,
                      }}
                    >
                      Featured
                    </span>
                    <span style={{ ...s.label, color: "var(--vb-dim)" }}>
                      {featured.category}
                    </span>
                  </div>
                  <h2
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                      fontSize: 28,
                      fontWeight: 700,
                      color: "var(--vb-text)",
                      letterSpacing: "-0.02em",
                      margin: "0 0 16px",
                      lineHeight: 1.2,
                    }}
                  >
                    {featured.title}
                  </h2>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 15,
                      color: "var(--vb-muted)",
                      lineHeight: 1.65,
                      margin: "0 0 24px",
                    }}
                  >
                    {featured.excerpt}
                  </p>
                  <span
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "var(--vb-dim)",
                    }}
                  >
                    {featured.date} · {featured.readTime}
                  </span>
                </div>
                <div
                  style={{
                    background: "var(--vb-bg)",
                    borderRadius: 12,
                    aspectRatio: "16/9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <span style={{ fontSize: 48 }}>📊</span>
                </div>
              </div>
            </Link>
          )}

          {/* Grid */}
          <div
            className="vb-grid-3"
            style={{ gap: 24 }}
          >
            {filteredPosts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                style={{ textDecoration: "none" }}
              >
                <div
                  className="card-hover"
                  style={{
                    background: "var(--vb-card)",
                    borderRadius: 14,
                    border: "1px solid var(--vb-border)",
                    padding: 28,
                    height: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  <div style={{ marginBottom: 16 }}>
                    <span style={{ ...s.label, color: "var(--vb-dim)" }}>
                      {post.category}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--vb-text)",
                      letterSpacing: "-0.01em",
                      margin: "0 0 12px",
                      lineHeight: 1.3,
                    }}
                  >
                    {post.title}
                  </h3>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 14,
                      color: "var(--vb-muted)",
                      lineHeight: 1.6,
                      margin: "0 0 20px",
                    }}
                  >
                    {post.excerpt}
                  </p>
                  <span
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 12,
                      color: "var(--vb-dim)",
                    }}
                  >
                    {post.date} · {post.readTime}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
