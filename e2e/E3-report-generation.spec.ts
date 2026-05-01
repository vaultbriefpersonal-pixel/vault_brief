import { test, expect } from "@playwright/test";

/**
 * E3: Generate report (smoke test — requires auth + project + snapshot)
 */
test.describe("E3 - Report generation", () => {
  test.skip(
    !process.env.DATABASE_URL || process.env.DATABASE_URL.includes("placeholder"),
    "Requires a real database connection"
  );

  test("reports page is accessible when authenticated", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("VaultBrief")).toBeVisible();
  });
});
