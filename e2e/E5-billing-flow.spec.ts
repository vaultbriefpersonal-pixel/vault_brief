import { test, expect } from "@playwright/test";

/**
 * E5: No-paywall guard.
 *
 * VaultBrief pivoted to a free "public goods" model — no pricing page,
 * no plan tiers, no trial CTAs. This spec replaces the old billing-flow
 * suite and acts as a regression net: if pricing/paywall surfaces ever
 * reappear, these assertions fail.
 */
test.describe("E5 - No paywall (public goods)", () => {
  test("/pricing is gone (404 or redirect away from a pricing page)", async ({
    page,
  }) => {
    const res = await page.goto("/pricing");
    // Either the route 404s, or it redirects elsewhere. Never a live
    // pricing page. Accept 404 status, or a final URL that isn't /pricing.
    const status = res?.status() ?? 0;
    const url = page.url();
    const looksLikePricing = /\/pricing\/?$/.test(url);
    expect(status === 404 || !looksLikePricing).toBeTruthy();
    // And no plan tiers rendered.
    await expect(page.getByRole("heading", { name: "Seed" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "VC Suite" })).toHaveCount(0);
  });

  test("nav and footer have no Pricing link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /^pricing$/i })).toHaveCount(0);
  });

  test("landing page has no price or trial CTAs", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();
    // The landing page legitimately shows real dollar figures today (demo
    // report KPI tiles, the "Treasury under watch" production stat) —
    // that's product content, not pricing. What must never reappear is a
    // price-per-period pattern like the old "$99/mo" plan cards.
    expect(body).not.toMatch(/\$\d+(\.\d+)?\s*\/\s*(mo|month)\b/i);
    expect(body).not.toMatch(/free trial|14-day|per month|\/mo\b/i);
  });

  test("landing shows a neutral get-started CTA", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /get started/i }).first()
    ).toBeVisible();
  });
});
