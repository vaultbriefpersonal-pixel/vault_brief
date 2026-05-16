import { test } from "@playwright/test";

/**
 * E8 — visual capture pass. Snapshots the marketing surfaces we
 * touched in May 2026 so future reviewers can eyeball the rendered
 * state without booting their own browser. Screenshots land in
 * `tmp-screenshots/` (gitignored).
 *
 * Not a regression-detection spec — failures here just mean a page
 * didn't load. The screenshots themselves are the artifact.
 */

const ROUTES: Array<{ slug: string; path: string }> = [
  { slug: "landing", path: "/" },
  { slug: "demo", path: "/demo" },
  { slug: "docs", path: "/docs" },
  { slug: "security", path: "/security" },
  { slug: "changelog", path: "/changelog" },
  { slug: "pricing", path: "/pricing" },
  { slug: "about", path: "/about" },
  { slug: "blog-index", path: "/blog" },
  { slug: "blog-post-new", path: "/blog/monthly-investor-report-checklist-web3" },
];

test.describe("E8 - visual capture", () => {
  for (const r of ROUTES) {
    test(`screenshot ${r.slug}`, async ({ page }) => {
      await page.goto(r.path, { waitUntil: "networkidle" });
      // Wait for fonts so screenshots don't capture FOUT.
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `tmp-screenshots/${r.slug}.png`,
        fullPage: true,
      });
    });
  }
});
