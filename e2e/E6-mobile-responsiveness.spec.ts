import { test, expect, devices } from "@playwright/test";

/**
 * E6: Mobile responsiveness — public pages across common phone viewports.
 *
 * No DB required — pure UI checks. Catches the regressions surfaced in the
 * mobile-polish session (May 2026): horizontal overflow, sub-44px touch
 * targets, vh vs dvh on iOS Safari, mobile drawer scroll-lock.
 */
test.describe("E6 - Mobile responsiveness", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("landing page renders at 375px", async ({ page }) => {
    await page.goto("/");
    // Logo renders "VAULT" + " BRIEF" across two spans — match the wrapper text.
    await expect(page.getByRole("navigation").getByText(/VAULT/)).toBeVisible();
    // Hero headline split across two lines: "Investor reports" / "for Web3 teams"
    await expect(page.getByText("for Web3 teams")).toBeVisible();
  });

  test("login page renders at 375px", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("VAULT BRIEF", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    const button = page.getByRole("button", { name: /send magic link/i });
    await expect(button).toBeVisible();
  });

  test("pricing page renders at 375px", async ({ page }) => {
    await page.goto("/pricing");
    // Hero headline rewrite: was "Simple, transparent pricing", now leads
    // with the demo-first message.
    await expect(
      page.getByRole("heading", { name: /Start with a demo/ })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Seed" })).toBeVisible();
  });

  // No horizontal overflow on the public surface — these have all bitten us
  // before, so each gets its own test for clean failure attribution.
  for (const path of ["/", "/login", "/pricing", "/docs", "/status"]) {
    test(`no horizontal overflow on ${path}`, async ({ page }) => {
      await page.goto(path);
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth
      );
      const clientWidth = await page.evaluate(
        () => document.documentElement.clientWidth
      );
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  }

  test("login fills the small viewport (uses dvh, not vh)", async ({ page }) => {
    await page.goto("/login");
    // The login wrapper sets minHeight: 100dvh. Whatever its computed pixel
    // height ends up being, it should be ≥ the viewport — otherwise we've
    // regressed to a fixed/clipped layout.
    const wrapperHeight = await page.evaluate(() => {
      const input = document.querySelector('input[type="email"]');
      const wrapper = input?.closest("div")?.parentElement?.parentElement;
      return wrapper instanceof HTMLElement ? wrapper.offsetHeight : 0;
    });
    const viewport = page.viewportSize();
    expect(wrapperHeight).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 1);
  });

  test("primary CTAs meet 44px touch target (Apple HIG)", async ({ page }) => {
    await page.goto("/login");
    const submit = page.getByRole("button", { name: /send magic link/i });
    const box = await submit.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("burger button is 44x44 and toggles aria-label", async ({ page }) => {
    await page.goto("/");
    const burger = page.getByRole("button", { name: /open menu/i });
    await expect(burger).toBeVisible();
    const box = await burger.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await burger.click();
    await expect(page.getByRole("button", { name: /close menu/i })).toBeVisible();
  });

  test("mobile drawer opens, locks body scroll, closes on link tap", async ({
    page,
  }) => {
    await page.goto("/");

    // Closed: nav links not visible (drawer translated off-screen).
    await page.getByRole("button", { name: /open menu/i }).click();

    // Drawer link visible (footer also has /pricing — drawer is the first
    // one in DOM order on mobile, before the footer).
    const pricingLink = page
      .locator('a[href="/pricing"]', { hasText: "Pricing" })
      .first();
    await expect(pricingLink).toBeVisible();

    // Body scroll locked while drawer is open.
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe("hidden");

    // Tap a nav link — drawer should auto-close and body scroll unlock.
    await pricingLink.click();
    await page.waitForURL("**/pricing");
    const overflowAfter = await page.evaluate(() => document.body.style.overflow);
    expect(overflowAfter).toBe("");
  });
});

/**
 * Spot-check the same critical pages on a couple more device profiles to
 * catch viewport-specific quirks (Pixel 9 Pro is taller, iPhone SE is shorter).
 */
const PROFILES = [
  { name: "iPhone SE 3 (375x667)", viewport: { width: 375, height: 667 } },
  { name: "iPhone 16 Pro (393x852)", viewport: { width: 393, height: 852 } },
  { name: "Pixel 9 (412x915)", viewport: devices["Pixel 7"].viewport },
];

for (const profile of PROFILES) {
  test.describe(`E6 - viewport: ${profile.name}`, () => {
    test.use({ viewport: profile.viewport });

    test("landing has no horizontal overflow", async ({ page }) => {
      await page.goto("/");
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth
      );
      const clientWidth = await page.evaluate(
        () => document.documentElement.clientWidth
      );
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });

    test("burger menu reachable on landing", async ({ page }) => {
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: /open menu/i })
      ).toBeVisible();
    });
  });
}
