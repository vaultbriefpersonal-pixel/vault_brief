import { test, expect, type BrowserContext } from "@playwright/test";

/**
 * E12 — onboarding wizard walkthrough.
 *
 * Drives `/projects/new` through its four steps as an authenticated
 * user: project basics → wallet → optional sources → review. Captures
 * a screenshot at each step + asserts step-gating behaviour
 * (Continue button disabled until required fields are filled).
 *
 * Doesn't actually submit the form — the test user is on a free plan
 * which already owns one project (ENS Test), so a real submission
 * would 403 with FORBIDDEN ("Your plan allows up to 1 project(s)").
 * The submit-blocked behaviour is itself worth asserting: the wizard
 * should let the founder fill it in cleanly and only fail at the
 * tRPC mutation layer with a clear plan-upgrade message.
 *
 * Skipped when SESSION_TOKEN env var isn't set, same gate as E9.
 */

const SESSION = process.env.SESSION_TOKEN;

async function injectAuth(context: BrowserContext) {
  if (!SESSION) return;
  await context.addCookies([
    {
      name: "__Secure-authjs.session-token",
      value: SESSION,
      domain: "vaultbrief.io",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("E12 - onboarding wizard", () => {
  test("walk through all 4 steps + capture screenshots", async ({
    page,
    context,
  }) => {
    test.skip(!SESSION, "SESSION_TOKEN env var not set");
    await injectAuth(context);

    await page.goto("/projects/new", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    // Step 1 — Project basics
    await expect(
      page.getByRole("heading", { name: /Project basics/i })
    ).toBeVisible();
    await page.screenshot({
      path: "tmp-screenshots/E12-step-1-basics.png",
      fullPage: true,
    });
    // Continue should be disabled until a name is typed (canAdvance()
    // gates step 0 on `form.name.trim().length > 0`).
    const continueBtn = page.getByRole("button", { name: /Continue/i });
    await expect(continueBtn).toBeDisabled();
    await page.getByPlaceholder("My Web3 Project").fill("E2E Walkthrough");
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    // Step 2 — Treasury wallet
    await expect(
      page.getByRole("heading", { name: /Treasury wallet/i })
    ).toBeVisible();
    await page.screenshot({
      path: "tmp-screenshots/E12-step-2-wallet.png",
      fullPage: true,
    });
    // Continue gated on at least one non-empty wallet address.
    await expect(continueBtn).toBeDisabled();
    await page
      .getByPlaceholder("0x… or Solana base58")
      .fill("0xFe89cc7aBB2C4183683ab71653C4cdc9B02D44b7");
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    // Step 3 — Optional data sources
    await expect(
      page.getByRole("heading", { name: /Optional data sources/i })
    ).toBeVisible();
    await page.screenshot({
      path: "tmp-screenshots/E12-step-3-optional.png",
      fullPage: true,
    });
    // All fields optional → Continue should be enabled out of the box.
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    // Step 4 — Review
    await expect(
      page.getByRole("heading", { name: /Generate report/i })
    ).toBeVisible();
    await page.screenshot({
      path: "tmp-screenshots/E12-step-4-review.png",
      fullPage: true,
    });
    // Review screen shows the summary rows; the submit button reads
    // "Generate Investor Report" once we're on step 3.
    await expect(
      page.getByRole("button", { name: /Generate Investor Report/i })
    ).toBeVisible();
  });
});
