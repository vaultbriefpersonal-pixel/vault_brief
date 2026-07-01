import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/blog",
  "/docs",
  "/about",
  "/demo",
  "/changelog",
  "/roadmap",
  "/security",
  "/status",
  "/privacy",
  "/terms",
  "/cookies",
  "/api/auth",
  // Webhooks (Stripe, Resend) authenticate via signed payloads, not session.
  "/api/webhooks",
  // Public health endpoint — used by /status page and external uptime monitors.
  "/api/health",
  // Marketing chat widget — anonymous visitors. Rate-limited per IP via
  // chatLimiter. Forcing auth here would defeat the whole point.
  "/api/chat",
  // Public API waitlist — single-shot email capture from /docs.
  "/api/waitlist",
  // Public investor report view (`/r/<reportId>`). Investors arrive from
  // a Resend email and don't have accounts; status='sent' gate inside
  // the page protects drafts. Without this allowlist they'd be bounced
  // to /login and stuck.
  "/r",
  // Next.js conventional metadata routes — sitemap, robots, default
  // opengraph and twitter images at the app root. These get crawled by
  // search engines and social-media unfurlers before auth, so they
  // must be public. Per-route opengraph-image files under /blog/[slug]
  // etc. already pass via their parent prefix.
  "/sitemap.xml",
  "/robots.txt",
  "/opengraph-image",
  "/twitter-image",
  // Sentry tunnel route — `withSentryConfig({ tunnelRoute: "/monitoring" })`
  // in next.config.ts generates this server-side proxy so client-side
  // Sentry events sneak past ad-blockers that filter *.sentry.io.
  // Anonymous browsers POST here on every captured event; gating it
  // behind auth would silently drop all visitor errors.
  "/monitoring",
];

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (!isPublic && !req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
