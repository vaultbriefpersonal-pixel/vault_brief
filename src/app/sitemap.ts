import type { MetadataRoute } from "next";
import { POSTS } from "@/lib/blog-posts";

// Canonical host. Matches the AUTH_URL setup (apex preferred).
const BASE = "https://vaultbrief.io";

// Static marketing routes with their priority. Higher = more important
// for Google indexing rank within the site. Login / register / API /
// dashboard routes are intentionally omitted — they're either gated or
// utility surfaces.
const STATIC: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/demo", priority: 0.9, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/blog", priority: 0.8, changeFrequency: "weekly" },
  { path: "/security", priority: 0.7, changeFrequency: "monthly" },
  { path: "/changelog", priority: 0.7, changeFrequency: "weekly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs", priority: 0.5, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/cookies", priority: 0.3, changeFrequency: "yearly" },
  // /status is intentionally excluded — uptime page shouldn't compete
  // for ranking with the marketing surface.
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    ...STATIC.map((s) => ({
      url: `${BASE}${s.path}`,
      lastModified: now,
      changeFrequency: s.changeFrequency,
      priority: s.priority,
    })),
    ...POSTS.map((p) => ({
      url: `${BASE}/blog/${p.slug}`,
      // We don't store per-post updatedAt; treat publish-date string as
      // last-modified for now. If a post is materially edited the
      // changeFrequency hint covers re-crawl cadence.
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
