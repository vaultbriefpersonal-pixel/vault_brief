import type { MetadataRoute } from "next";

// Canonical host (apex). Mirrors the sitemap.
const BASE = "https://vaultbrief.io";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Block: every auth-gated surface + the magic-link callback +
        // the public report viewer (/r/<id> — those carry investor
        // content that shouldn't surface in search; the page itself
        // already sets `robots: { index: false, follow: false }`,
        // but adding the disallow is belt-and-braces).
        disallow: [
          "/api/",
          "/projects/",
          "/projects/new",
          "/billing",
          "/settings",
          "/notifications",
          "/r/",
          "/login",
          "/register",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
