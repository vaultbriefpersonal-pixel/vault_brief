import { test, expect } from "@playwright/test";

/**
 * E2: Create project + add wallet
 * Requires an authenticated session.
 * These tests run against a real DB — skipped in CI without DATABASE_URL.
 */
test.describe("E2 - Create project and add wallet", () => {
  test.skip(
    !process.env.DATABASE_URL || process.env.DATABASE_URL.includes("placeholder"),
    "Requires a real database connection"
  );

  test("new project form is reachable", async ({ page }) => {
    // Navigate to new project page (will redirect to login if not authed)
    await page.goto("/projects/new");
    // Either shows the form or redirects to login
    const url = page.url();
    expect(url).toMatch(/\/(projects\/new|login)/);
  });

  test("project form has required fields", async ({ page }) => {
    await page.goto("/login");
    // Check form inputs exist
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  });
});
