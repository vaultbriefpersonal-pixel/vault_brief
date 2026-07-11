import { test, expect } from "@playwright/test";

/**
 * E11 — accessibility audit via axe-core loaded from CDN at runtime.
 *
 * We can't `npm install @axe-core/playwright` from the dev machine
 * (corporate TLS MITM blocks npm registry), so this spec pulls
 * axe-core off jsDelivr inside the Playwright browser context and
 * runs `axe.run()` from there.
 *
 * Reports violations grouped by `impact` (critical / serious /
 * moderate / minor). Doesn't fail on minor issues — those are
 * informational only. Fails the spec if any `critical` violation
 * shows up so the suite stays green for typical churn but catches a
 * regression like "we shipped an unlabelled form input."
 */

interface AxeViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  description: string;
  help: string;
  nodes: { target: string[]; html: string }[];
}

interface AxeResult {
  violations: AxeViolation[];
}

// Public, unauthenticated routes. `/pricing` was removed in the
// public-goods pivot (it now redirects), so it's dropped here; `/roadmap`
// and `/changelog` are recent additions worth covering. The authenticated
// surfaces (report editor + investor-engagement panel) need a logged-in
// Playwright fixture and are audited separately — not by this public spec.
const ROUTES = [
  "/",
  "/demo",
  "/docs",
  "/security",
  "/blog",
  "/login",
  "/roadmap",
  "/changelog",
];

for (const path of ROUTES) {
  test(`E11 a11y audit: ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.addScriptTag({
      url: "https://cdn.jsdelivr.net/npm/axe-core@4.10.0/axe.min.js",
    });
    const results = (await page.evaluate(async () => {
      // axe.run mounts on `window.axe`. Cast to unknown then to a
      // narrow signature to keep this spec free of @types/axe-core.
      const axe = (window as unknown as { axe: { run: () => Promise<AxeResult> } }).axe;
      return axe.run();
    })) as AxeResult;

    const critical = results.violations.filter((v) => v.impact === "critical");
    const serious = results.violations.filter((v) => v.impact === "serious");

    if (results.violations.length > 0) {
      // Print a compact summary so reviewers can fix without re-running.
      console.log(`\n--- a11y violations on ${path} ---`);
      for (const v of results.violations) {
        console.log(
          `  [${v.impact ?? "n/a"}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})`
        );
        for (const n of v.nodes.slice(0, 2)) {
          console.log(`    target: ${n.target.join(" ")}`);
        }
      }
    }

    // Hard fail only on `critical` issues — those are real blockers
    // (e.g. an empty <button>, an <img> with no accessible name in a
    // CTA). `serious` is surfaced as a console log so the team sees
    // it without breaking CI on day-1 baseline.
    expect(
      critical,
      `Critical a11y violations on ${path}:\n${critical
        .map((v) => `  ${v.id}: ${v.help}`)
        .join("\n")}`
    ).toHaveLength(0);

    // Stash full result as a test attachment for later review.
    test.info().attachments.push({
      name: `axe-${path.replace(/\//g, "_") || "root"}.json`,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify(
          {
            path,
            counts: {
              total: results.violations.length,
              critical: critical.length,
              serious: serious.length,
            },
            violations: results.violations,
          },
          null,
          2
        )
      ),
    });
  });
}
