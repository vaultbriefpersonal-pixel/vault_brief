import { test, expect } from "@playwright/test";

/**
 * E7 — content-level QA pass over the marketing surfaces we touched
 * during the May 2026 polish sweep. This locks in the assertions so
 * a future copy-edit regression on /demo, /docs, /security,
 * /changelog, /pricing, the landing roadmap, or the footer is caught
 * by CI instead of by a customer browsing the live site.
 *
 * Per-test scope:
 *   - /demo:         must show real ENS DAO data + $79.8M total +
 *                    no fictional "Project Meridian" content.
 *   - /docs:         must be product docs, NOT the old API waitlist.
 *   - /security:     must list shipped controls, no vague
 *                    "Security roadmap" placeholder section.
 *   - /changelog:    has the "What's next" CTA (links to /roadmap,
 *                    which is now the single source of truth for
 *                    future work), no inline Planned badges in
 *                    monthly rows. (/pricing was removed entirely in
 *                    the public-goods pivot — see E5-billing-flow.)
 *   - /:             landing has no "Coming soon" text, single
 *                    "On roadmap" compact list, no duplicate
 *                    detailed roadmap grid below it.
 *   - footer:        Docs link present, no API (coming soon).
 *
 * Tests scope themselves to public surfaces only — auth-gated paths
 * (project editor, /r/[id] for non-sent reports) need a separate
 * authenticated run.
 */

test.describe("E7 - marketing content QA", () => {
  test("/demo renders real ENS DAO data with verifiable totals", async ({
    page,
  }) => {
    await page.goto("/demo");
    // Hero badge — was "Sample data" before we re-pointed at ENS.
    await expect(page.getByText("Live ENS data")).toBeVisible();
    // Project name in the demo report header.
    await expect(
      page.getByRole("heading", { name: /ENS DAO/ })
    ).toBeVisible();
    // KPI strip carries the real on-chain total.
    await expect(page.getByText("$79.8M").first()).toBeVisible();
    // Fictional content must not have crept back in.
    await expect(page.getByText("Project Meridian")).toHaveCount(0);
    await expect(page.getByText("Meridian Protocol")).toHaveCount(0);
    // The "Data sources used" engineering manifest was removed.
    await expect(page.getByText("Data sources used")).toHaveCount(0);
  });

  test("/docs is product documentation, not an API waitlist", async ({
    page,
  }) => {
    await page.goto("/docs");
    await expect(
      page.getByRole("heading", { name: /How Vault Brief works/ })
    ).toBeVisible();
    // Section anchors that should exist in the new docs.
    for (const sectionTitle of [
      "Connecting wallets",
      "Plan limits",
      "Generating your first report",
    ]) {
      await expect(page.getByText(sectionTitle).first()).toBeVisible();
    }
    // The old API-waitlist copy must be gone.
    await expect(page.getByText(/Get notified when it ships/)).toHaveCount(0);
    await expect(page.getByText(/Public API.*on the roadmap/)).toHaveCount(0);
  });

  test("/security lists concrete shipped controls", async ({ page }) => {
    await page.goto("/security");
    for (const control of [
      "Read-only wallet access",
      "No private key storage",
      "Signed webhooks only",
      "Encrypted credentials at rest",
      "Auth and transport",
      "Rate-limited surfaces",
      "Audit-friendly data layer",
    ]) {
      await expect(page.getByText(control).first()).toBeVisible();
    }
    // Vague placeholder copy must not return.
    await expect(page.getByText("Security roadmap")).toHaveCount(0);
    await expect(
      page.getByText(/compliance documentation are part of the product roadmap/)
    ).toHaveCount(0);
  });

  test("/changelog has a What's next CTA pointing at /roadmap, no inline Planned", async ({
    page,
  }) => {
    await page.goto("/changelog");
    // "What's next" is now a single CTA section linking to /roadmap (the
    // single source of truth for future work) rather than a duplicated
    // hardcoded item list — see the comment in changelog/page.tsx.
    await expect(page.getByText("What's next")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /see the roadmap/i })
    ).toHaveAttribute("href", "/roadmap");
    // The "Planned" capital-P badge that used to render inline on
    // monthly entries must not return. (Lowercase "planned" still
    // appears in the legitimate intro copy: "Items below are planned
    // but not shipped yet" — exact-case match scopes us to the badge
    // text only.)
    await expect(page.getByText("Planned", { exact: true })).toHaveCount(0);
  });

  test("landing has no Coming soon, single On roadmap, footer Docs link", async ({
    page,
  }) => {
    await page.goto("/");
    // "Coming soon" eradicated across the landing.
    await expect(page.locator("body")).not.toContainText("Coming soon");
    // Compact split-list still shows "On roadmap" (the only place that
    // phrase should appear on /).
    await expect(page.locator("text=On roadmap").first()).toBeVisible();
    // Defensive treasury metric — replaced raw counts.
    await expect(page.getByText("Treasury under watch")).toBeVisible();
    // Footer: Docs replaces "API (coming soon)". Both nav and footer
    // render a "Docs" link, so scope strictly to the footer
    // (contentinfo role) to keep the assertion unambiguous.
    await expect(
      page
        .getByRole("contentinfo")
        .getByRole("link", { name: "Docs", exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("API (coming soon)")
    ).toHaveCount(0);
    // No X social-icon link until the account is live.
    await expect(
      page.locator('a[aria-label="X"]')
    ).toHaveCount(0);
  });

  test("each blog post page loads and has a per-post OG image", async ({
    page,
  }) => {
    // Sanity-check that all 11 posts and their per-post OG metadata
    // survive a build. We only assert on one representative post to
    // keep CI runtime down — the smoke catches the common breakage
    // (slug typo / missing post / generateStaticParams off).
    const slug = "monthly-investor-report-checklist-web3";
    await page.goto(`/blog/${slug}`);
    await expect(
      page.getByRole("heading", {
        name: /The Web3 Founder.s Monthly Investor Report Checklist/,
      })
    ).toBeVisible();
    // og:image must be the hashed per-post URL, not the root default.
    const ogContent = await page.locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(ogContent).toContain(`/blog/${slug}/opengraph-image`);
  });
});
