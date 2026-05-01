import { test, expect } from "@playwright/test";

/**
 * E1: Full signup flow
 * Register → magic link sent → check login page state
 */
test.describe("E1 - Signup flow", () => {
  test("shows magic link sent confirmation after email submit", async ({
    page,
  }) => {
    await page.goto("/login");

    // Page loads correctly
    await expect(page.getByText("VaultBrief")).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();

    // Fill in email and submit
    await page.fill('input[type="email"]', "test@example.com");
    await page.click('button[type="submit"]');

    // Should show "sent" confirmation (not redirect — no real email in tests)
    await expect(page.getByText("Magic link sent")).toBeVisible({ timeout: 5000 });
  });

  test("Google OAuth button is visible", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Continue with Google")).toBeVisible();
  });

  test("unauthenticated user redirected from /projects to /login", async ({
    page,
  }) => {
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/register redirects to /login", async ({ page }) => {
    await page.goto("/register");
    await expect(page).toHaveURL(/\/login/);
  });
});
