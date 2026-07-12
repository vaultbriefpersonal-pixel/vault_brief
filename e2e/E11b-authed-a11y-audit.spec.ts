import { test, expect } from "@playwright/test";

/**
 * E11b — accessibility audit for AUTHENTICATED surfaces.
 *
 * E11 only covers public marketing pages — the report editor
 * (ReportWidgets + ReportEngagements) sits behind auth and was never
 * audited. This spec reuses two existing patterns rather than inventing
 * new ones:
 *
 *   - Auth: E9's SESSION_TOKEN cookie-injection (real NextAuth session
 *     cookie set directly on the browser context), not a magic-link
 *     round-trip. Same env vars, same known ENS Test project/report IDs.
 *   - Audit: E11's axe-core-from-CDN + critical-only-fail approach.
 *
 * Skips entirely when SESSION_TOKEN isn't set, so the suite stays green
 * in CI / local runs without prod secrets — same convention as E9.
 */

interface AxeViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  description: string;
  help: string;
  nodes: { target: string[]; html: string }[];
}

interface AxeResult {
  violations: AxeViolation[];
}

const SESSION = process.env.SESSION_TOKEN;
const CSRF = process.env.SESSION_CSRF;
const PROJECT_ID = "28a3d9b2-c926-4c73-b410-a5e5f7d80655";
const REPORT_ID = "2f93091b-89b9-4dfc-a411-7d8a867f09c4";

async function injectAuth(context: import("@playwright/test").BrowserContext) {
  if (!SESSION) return;
  await context.addCookies([
    {
      name: "__Secure-authjs.session-token",
      value: SESSION,
      domain: "vaultbrief.io",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    ...(CSRF
      ? [
          {
            name: "__Host-authjs.csrf-token",
            value: CSRF,
            domain: "vaultbrief.io",
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "Lax" as const,
          },
        ]
      : []),
  ]);
}

const AUTHED_ROUTES = [
  `/projects/${PROJECT_ID}/reports/${REPORT_ID}`, // editor: ReportWidgets + ReportEngagements
  "/projects",
];

for (const path of AUTHED_ROUTES) {
  test(`E11b authed a11y audit: ${path}`, async ({ page, context }) => {
    test.skip(!SESSION, "SESSION_TOKEN env var not set");
    await injectAuth(context);
    await page.goto(path, { waitUntil: "networkidle" });
    await page.addScriptTag({
      url: "https://cdn.jsdelivr.net/npm/axe-core@4.10.0/axe.min.js",
    });
    const results = (await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: () => Promise<AxeResult> } }).axe;
      return axe.run();
    })) as AxeResult;

    const critical = results.violations.filter((v) => v.impact === "critical");
    const serious = results.violations.filter((v) => v.impact === "serious");

    if (results.violations.length > 0) {
      console.log(`\n--- a11y violations on ${path} (authed) ---`);
      for (const v of results.violations) {
        console.log(
          `  [${v.impact ?? "n/a"}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})`
        );
        for (const n of v.nodes.slice(0, 2)) {
          console.log(`    target: ${n.target.join(" ")}`);
        }
      }
    }

    // Same bar as E11: fail hard only on critical, log serious for review.
    expect(
      critical,
      `Critical a11y violations on ${path}:\n${critical
        .map((v) => `  ${v.id}: ${v.help}`)
        .join("\n")}`
    ).toHaveLength(0);

    test.info().attachments.push({
      name: `axe-authed-${path.replace(/\//g, "_") || "root"}.json`,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify(
          {
            path,
            counts: {
              total: results.violations.length,
              critical: critical.length,
              serious: serious.length,
            },
            violations: results.violations,
          },
          null,
          2
        )
      ),
    });
  });
}
