/**
 * Next.js instrumentation hook — runs once per runtime at startup.
 *
 * Loads the Sentry SDK on the right runtime: server (Node), or edge
 * (middleware / proxy.ts). The client-side Sentry init lives in
 * sentry.client.config.ts and is wired through `withSentryConfig` in
 * next.config.ts — that path doesn't go through this file.
 *
 * Without this file the sentry.{server,edge}.config.ts files are dead
 * code: Next.js never auto-imports them. The product shipped with
 * SENTRY_DSN env vars correctly set but zero error capture for ~2
 * weeks because nothing called Sentry.init.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Forward server-side throws (Server Actions, RSC errors, route handler
// crashes) into Sentry. @sentry/nextjs v10 renamed the hook to
// `captureRequestError`. Next.js expects this exact export name from
// `instrumentation.ts` — don't rename.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
