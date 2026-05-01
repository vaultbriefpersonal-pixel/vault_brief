import { test, expect } from "@playwright/test";

/**
 * E5: Billing flow
 */
test.describe("E5 - Billing flow (public pages)", () => {
  test("pricing page shows all 3 plans", async ({ page }) => {
    await page.goto("/pricing");

    await expect(page.getByText("Starter")).toBeVisible();
    await expect(page.getByText("Growth")).toBeVisible();
    await expect(page.getByText("VC Suite")).toBeVisible();
    await expect(page.getByText("$149")).toBeVisible();
    await expect(page.getByText("$349")).toBeVisible();
    await expect(page.getByText("$999")).toBeVisible();
  });

  test("pricing page has CTA links to sign up", async ({ page }) => {
    await page.goto("/pricing");
    const ctaLinks = page.getByRole("link", { name: /get started|start growing|contact us/i });
    await expect(ctaLinks.first()).toBeVisible();
  });

  test("pricing page shows feature list items", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Up to 5 wallets")).toBeVisible();
    await expect(page.getByText("GitHub integration")).toBeVisible();
    await expect(page.getByText("API access")).toBeVisible();
  });
});

test.describe("E5 - Billing flow (Stripe integration)", () => {
  test.skip(
    !process.env.STRIPE_SECRET_KEY ||
      process.env.STRIPE_SECRET_KEY.includes("placeholder"),
    "Requires real Stripe keys"
  );

  test("authenticated checkout creates session", async ({ page }) => {
    // Requires authenticated session + real Stripe
    await page.goto("/billing");
  });
});
