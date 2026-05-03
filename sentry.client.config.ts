import * as Sentry from "@sentry/nextjs";

// Browser runtime init. NEXT_PUBLIC_SENTRY_DSN must be exposed to the client
// (separate var from server-only SENTRY_DSN). No-op when unset.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.05,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  });
}
