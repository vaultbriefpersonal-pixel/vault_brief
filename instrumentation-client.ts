/**
 * Next.js client-side instrumentation hook (Sentry v10 + Next.js 15+).
 *
 * Replaces the older `sentry.client.config.ts` convention — Sentry's
 * webpack plugin no longer auto-imports that file in v10. This file
 * is the canonical entry point Next.js loads on the browser before
 * any app code, so Sentry sees errors that happen during hydration
 * too.
 *
 * No-op when NEXT_PUBLIC_SENTRY_DSN is unset (dev / preview without a
 * Sentry project).
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // Sampling: 5% of transactions for perf monitoring; 100% of
    // errors (default). Adjust upward once we have real volume signal.
    tracesSampleRate: 0.05,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    // Surface init in console so we can verify wiring without an
    // actual error to trip — flips to a quiet "Sentry initialized"
    // log line on every page load with a configured DSN.
    debug: false,
  });
}

// onRouterTransitionStart is the v10 hook Sentry expects from this
// file for client-side navigation tracing. Re-exporting here so
// Next.js wires it to its app-router navigation events automatically.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
