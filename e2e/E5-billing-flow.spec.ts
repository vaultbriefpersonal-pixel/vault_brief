import { test, expect } from "@playwright/test";

/**
 * E5: Billing flow
 */
test.describe("E5 - Billing flow (public pages)", () => {
  test("pricing page shows all 4 plans", async ({ page }) => {
    await page.goto("/pricing");

    // Free Demo / Seed / Growth / Custom — VC Suite was renamed to Custom
    // when we softened enterprise claims for the early-beta positioning.
    await expect(page.getByRole("heading", { name: "Free Demo" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Seed" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Growth" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Custom" })).toBeVisible();
    await expect(page.getByText("$99", { exact: true })).toBeVisible();
    await expect(page.getByText("$299", { exact: true })).toBeVisible();
  });

  test("pricing page has CTA links to sign up", async ({ page }) => {
    await page.goto("/pricing");
    const ctaLinks = page.getByRole("link", { name: /start free trial|contact us/i });
    await expect(ctaLinks.first()).toBeVisible();
  });

  test("pricing page shows feature list items", async ({ page }) => {
    await page.goto("/pricing");
    // Seed-tier feature: "Up to 5 treasury wallets". Growth: "Up to 5 GitHub repos".
    await expect(
      page.getByText("Up to 5 treasury wallets").first()
    ).toBeVisible();
    await expect(page.getByText("Up to 5 GitHub repos")).toBeVisible();
    // "API access" appears in both the comparison table (as Roadmap) and
    // the Custom card. At least one needs to be visible.
    await expect(page.getByText(/API access/).first()).toBeVisible();
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
