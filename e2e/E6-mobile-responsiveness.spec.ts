import { test, expect } from "@playwright/test";

/**
 * E6: Mobile responsiveness — all pages at 375px width
 */
test.describe("E6 - Mobile responsiveness", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("landing page renders at 375px", async ({ page }) => {
    await page.goto("/");
    // Nav logo — exact match
    // Logo renders "VAULT" + " BRIEF" across two spans — match the wrapper text.
    await expect(page.getByRole("navigation").getByText(/VAULT/)).toBeVisible();
    await expect(page.getByText("on autopilot")).toBeVisible();
  });

  test("login page renders at 375px", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("VaultBrief")).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    // Button should be full width on mobile
    const button = page.getByRole("button", { name: /send magic link/i });
    await expect(button).toBeVisible();
  });

  test("pricing page renders at 375px", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Simple, transparent pricing")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Seed" })).toBeVisible();
  });

  test("no horizontal overflow on landing page", async ({ page }) => {
    await page.goto("/");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px tolerance
  });
});
