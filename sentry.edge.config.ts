import * as Sentry from "@sentry/nextjs";

// Edge runtime (proxy.ts, middleware). No-op without SENTRY_DSN.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.05,
    environment: process.env.VERCEL_ENV ?? "development",
  });
}
