import { test } from "@playwright/test";

/**
 * E9 — capture the authenticated editor + projects surfaces.
 *
 * Reads the prod session token from SESSION_TOKEN env var and
 * injects it into the Playwright context so we can drive the
 * dashboard / editor pages without going through the magic-link flow.
 * Skips when SESSION_TOKEN isn't set so the suite stays green for
 * unauthenticated CI runs.
 *
 * Artifacts land in `tmp-screenshots/E9-*.png`.
 */

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

test.describe("E9 - authed report widget capture", () => {
  test("editor view with widgets", async ({ page, context }) => {
    test.skip(!SESSION, "SESSION_TOKEN env var not set");
    await injectAuth(context);
    await page.goto(`/projects/${PROJECT_ID}/reports/${REPORT_ID}`, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: "tmp-screenshots/E9-editor.png",
      fullPage: true,
    });
  });

  test("projects list", async ({ page, context }) => {
    test.skip(!SESSION, "SESSION_TOKEN env var not set");
    await injectAuth(context);
    await page.goto("/projects", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    await page.screenshot({
      path: "tmp-screenshots/E9-projects.png",
      fullPage: true,
    });
  });
});
