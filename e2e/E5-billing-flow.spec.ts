import { test, expect } from "@playwright/test";

/**
 * E5: Billing flow
 */
test.describe("E5 - Billing flow (public pages)", () => {
  test("pricing page shows all 3 paid plans", async ({ page }) => {
    await page.goto("/pricing");

    // Seed / Growth / Custom — the "Free Demo" pseudo-tier was demoted
    // from a pricing card to a CTA banner because it isn't a usage plan
    // (signup grants a 14-day full-access trial automatically). The demo
    // CTA still lives on the page and is asserted below.
    await expect(page.getByRole("heading", { name: "Seed" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Growth" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Custom" })).toBeVisible();
    await expect(page.getByText("$99", { exact: true })).toBeVisible();
    await expect(page.getByText("$299", { exact: true })).toBeVisible();
    // Demo CTA banner sits above the cards.
    await expect(
      page.getByRole("link", { name: /sample report.*demo/i })
    ).toBeVisible();
  });

  test("pricing page has CTA links to sign up", async ({ page }) => {
    await page.goto("/pricing");
    // Card CTAs now read "Start 14-day trial" or "Contact us". The
    // older "Start Free Trial" still appears in the marketing nav.
    const ctaLinks = page.getByRole("link", {
      name: /start 14-day trial|start free trial|contact us/i,
    });
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
