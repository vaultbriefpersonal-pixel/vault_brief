import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Native-binary packages can't be bundled by webpack — they have to be
  // resolved at runtime from node_modules. @react-pdf/renderer is in the
  // Next.js 16 default list already; @resvg/resvg-js (used by chart-png.ts
  // for SVG → PNG rasterization in the email pipeline) needs an explicit
  // entry or the build fails with "Module not found: js-binding.js".
  serverExternalPackages: ["@resvg/resvg-js"],
};

// withSentryConfig is the glue that injects sentry.client.config.ts into
// the browser bundle. Without it our sentry.client.config.ts is dead
// code — the env var NEXT_PUBLIC_SENTRY_DSN was correctly set in Vercel
// but nothing ever called Sentry.init in the client. This wrapper also
// upload source maps when SENTRY_AUTH_TOKEN is set (deferred — we ship
// fine without it, just with minified stack traces).
export default withSentryConfig(nextConfig, {
  // CI noise control. Sentry's plugin prints a lot of detail; mute it.
  silent: true,
  // Org + project slugs are picked up from SENTRY_ORG / SENTRY_PROJECT
  // env vars when present; falling back to no-op if absent. Hard-code
  // here so dev builds work without env vars set.
  org: "vault-brief",
  project: "javascript-nextjs",
  // Avoid uploading source maps on builds without an auth token —
  // otherwise the build errors out instead of just shipping minified
  // stack traces. Source-map upload is opt-in via SENTRY_AUTH_TOKEN.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Tunnels Sentry's network calls through this app's own domain to
  // dodge ad-blockers that filter requests to *.sentry.io. Trade-off:
  // a tiny extra hop, but Sentry events from ad-blocker users land.
  tunnelRoute: "/monitoring",
});
