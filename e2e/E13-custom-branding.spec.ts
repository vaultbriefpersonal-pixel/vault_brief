import { test, expect } from "@playwright/test";

/**
 * E13 — custom branding e2e capture.
 *
 * Confirms the project.customBranding.primaryColor accent flows
 * through to `<ReportWidgets>` (KPI strip net-flow tile, expense
 * BarRow bars, GitHub activity tile numbers) and the page header
 * border on the public investor view.
 *
 * Doesn't mutate state itself — assumes ENS Test
 * (28a3d9b2-c926-4c73-b410-a5e5f7d80655) has been temporarily
 * branded amber via the curl one-liner that wraps this run. The
 * outer harness resets to null afterwards.
 */

const REPORT_ID = "2f93091b-89b9-4dfc-a411-7d8a867f09c4";

test("E13 branded /r/ view", async ({ page }) => {
  await page.goto(`/r/${REPORT_ID}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  // Sanity: still renders the ENS DAO total.
  await expect(page.getByText(/\$79\.8M/).first()).toBeVisible();
  await page.screenshot({
    path: "tmp-screenshots/E13-branded-investor-view.png",
    fullPage: true,
  });
});
