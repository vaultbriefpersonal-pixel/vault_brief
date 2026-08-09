import { test, expect } from "@playwright/test";

/**
 * E14 — the report document surface.
 *
 * Stage 18 turned the report into a light paper document while the rest of the
 * product stayed dark. Three things need watching, and none of them can be
 * caught by a unit test:
 *
 *   1. the document actually renders as paper, in the report typefaces
 *   2. the `.vb-doc` token scope does NOT leak into the dark app
 *   3. print emulation produces something worth handing to someone
 *
 * DB-gated exactly like E9-E13: these need a sent report in the real database,
 * which does not exist when DATABASE_URL is the placeholder.
 */

const SENT_REPORT_ID = "a8fe84fe-a9d3-4cb8-97a8-c180e468c056"; // ENS DAO, status=sent

const needsDb = () =>
  !process.env.DATABASE_URL || process.env.DATABASE_URL.includes("placeholder");

/** WCAG relative luminance, so "is this light or dark" is measured, not eyeballed. */
const LUMINANCE = `(rgb) => {
  const [r, g, b] = rgb.match(/\\d+/g).map(Number).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}`;

test.describe("report document", () => {
  test.skip(needsDb(), "Requires a sent report in a real database");

  test("E14a renders as paper, in the document typefaces", async ({ page }) => {
    await page.goto(`/r/${SENT_REPORT_ID}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    const doc = page.locator(".vb-doc-body").first();
    await expect(doc).toBeVisible();

    const style = await doc.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        background: cs.backgroundColor,
        color: cs.color,
        font: cs.fontFamily,
      };
    });

    // Light ground, dark ink — the inverse of the dashboard.
    const bgLum = await page.evaluate(
      ([rgb, fn]) => eval(`(${fn})`)(rgb),
      [style.background, LUMINANCE] as const
    );
    const fgLum = await page.evaluate(
      ([rgb, fn]) => eval(`(${fn})`)(rgb),
      [style.color, LUMINANCE] as const
    );
    expect(bgLum).toBeGreaterThan(0.6);
    expect(fgLum).toBeLessThan(0.1);

    // The report faces, not the app's.
    expect(style.font).toContain("Spectral");

    await page.screenshot({
      path: "tmp-screenshots/E14a-report-document.png",
      fullPage: true,
    });
  });

  test("E14b prints without clipping wide tables or losing table headers", async ({
    page,
  }) => {
    await page.goto(`/r/${SENT_REPORT_ID}`, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);

    const wrap = page.locator(".vb-doc .vb-table-scroll").first();
    if (await wrap.count()) {
      const printed = await wrap.evaluate((el) => ({
        overflow: getComputedStyle(el).overflowX,
        childMinWidth: getComputedStyle(el.firstElementChild!).minWidth,
        theadDisplay: el.querySelector("thead")
          ? getComputedStyle(el.querySelector("thead")!).display
          : null,
      }));
      // The 600px scroll floor would clip the right-hand columns off the sheet.
      expect(printed.overflow).toBe("visible");
      expect(printed.childMinWidth).toBe("0px");
      // Repeats the header on every page a long table spans.
      if (printed.theadDisplay) expect(printed.theadDisplay).toBe("table-header-group");
    }

    await page.screenshot({
      path: "tmp-screenshots/E14b-report-print.png",
      fullPage: true,
    });
  });

  test("E14c external links print their destination", async ({ page }) => {
    await page.goto(`/r/${SENT_REPORT_ID}`, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });

    const link = page.locator('.vb-doc-a[href^="http"]').first();
    if (await link.count()) {
      const after = await link.evaluate(
        (el) => getComputedStyle(el, "::after").content
      );
      // A link is useless on paper unless the URL is printed beside it.
      expect(after).toContain("http");
    }
  });
});

/**
 * The other half of the bargain. Stage 18.7 replaced inline colours in
 * ReportWidgets — a component the DASHBOARD also renders — with tokens. That
 * is only safe if the dark surface is untouched, so this asserts the scope
 * does not leak and the dashboard stays dark.
 *
 * Uses a public marketing page rather than an authed one so it runs without a
 * session; the property under test (does `.vb-doc` leak) is global.
 */
test("E14d the document theme does not leak into the dark app", async ({ page }) => {
  await page.goto("/grants", { waitUntil: "domcontentloaded" });

  const state = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);

    // Read a token as a COLOR, not as a string. getPropertyValue hands back the
    // custom property verbatim, and the production CSS minifier rewrites
    // `rgba(255, 255, 255, 0.06)` to the equivalent `#ffffff0f` — so asserting
    // on the raw text passes in dev and fails on a real build. Painting the
    // token onto a probe element makes the browser normalize any spelling to
    // `rgb()`/`rgba()`, which is the same in both.
    const probe = document.createElement("div");
    probe.style.backgroundColor = root.getPropertyValue("--doc-track").trim();
    document.body.appendChild(probe);
    const docTrack = getComputedStyle(probe).backgroundColor;
    probe.remove();

    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      vbBg: root.getPropertyValue("--vb-bg").trim(),
      docOk: root.getPropertyValue("--doc-ok").trim(),
      docTrack,
      radiusCard: root.getPropertyValue("--doc-radius-card").trim(),
      docScopes: document.querySelectorAll(".vb-doc").length,
    };
  });

  expect(state.docScopes).toBe(0);
  expect(state.vbBg).toBe("#0a0a0a");
  // The --doc-* tokens must resolve to their DASHBOARD values here. If a
  // report-side edit changed these, the widget strip would silently restyle
  // on the founder's own screens.
  expect(state.docOk).toBe("#00e87b");

  // The dark track is translucent WHITE; the paper one is translucent ink
  // (rgba(28, 32, 36, 0.08)). The channels are what distinguish them, so assert
  // those exactly and give alpha a tolerance — minification rounds 0.06 to
  // 0x0f/255 (0.0588), a difference no eye and no leak could tell apart.
  const track = state.docTrack.match(/[\d.]+/g)?.map(Number) ?? [];
  expect(track.slice(0, 3)).toEqual([255, 255, 255]);
  expect(track[3]).toBeCloseTo(0.06, 2);

  expect(state.radiusCard).toBe("12px");
});
