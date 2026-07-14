import { type Page } from "@playwright/test";

export const TEST_EMAIL = "e2e-test@vaultbrief.dev";
export const TEST_PROJECT_NAME = `E2E Project ${Date.now()}`;
export const TEST_WALLET = "0x742d35Cc6634C0532925a3b8D4C9C14b1234567";

export async function loginAs(page: Page, email = TEST_EMAIL) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.click('button[type="submit"]');
  // In tests, we mock the magic link — check for "sent" state
  await page.waitForSelector("text=Magic link sent");
}
