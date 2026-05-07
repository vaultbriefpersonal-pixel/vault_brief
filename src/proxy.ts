import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/pricing",
  "/blog",
  "/docs",
  "/about",
  "/demo",
  "/changelog",
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
