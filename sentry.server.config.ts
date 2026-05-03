import * as Sentry from "@sentry/nextjs";

// Server runtime init. No-op when SENTRY_DSN is unset, so dev/preview without
// a Sentry account stay clean. Add SENTRY_DSN env var when you create the
// project in Sentry — no code change needed.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    enabled: true,
  });
}
