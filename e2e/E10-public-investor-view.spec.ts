import { test, expect } from "@playwright/test";

/**
 * E10 — screenshot the public investor surface at /r/[reportId].
 *
 * Runs unauthenticated (that's the whole point of the investor link)
 * and assumes the linked report has been flipped to status='sent' so
 * the public route doesn't 404 it.
 *
 * The ENS Test report ID is hard-coded here because there's currently
 * only one user-visible "sent" report on prod. When this becomes
 * untrue, swap to a query-driven fixture.
 */

const REPORT_ID = "2f93091b-89b9-4dfc-a411-7d8a867f09c4";

test("E10 public /r/ view of a sent report", async ({ page }) => {
  // Skip on CI / dev where DATABASE_URL is the .env.example placeholder
  // — the test report doesn't exist in that DB and /r/ would 404.
  // Same gate the DB-dependent E1-E5 specs use.
  test.skip(
    !process.env.DATABASE_URL || process.env.DATABASE_URL.includes("placeholder"),
    "Requires prod DB with the ENS Test sent report"
  );
  await page.goto(`/r/${REPORT_ID}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  // Sanity: the project header should render and we should see the
  // ENS-anchored treasury total inside the widget strip.
  await expect(page.getByText(/ENS Test|ENS DAO/).first()).toBeVisible();
  await expect(page.getByText(/\$79\.8M/).first()).toBeVisible();
  await page.screenshot({
    path: "tmp-screenshots/E10-investor-view.png",
    fullPage: true,
  });
});
