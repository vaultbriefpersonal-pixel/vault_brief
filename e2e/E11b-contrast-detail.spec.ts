import { test } from "@playwright/test";

/**
 * Ad-hoc — list every color-contrast violation on `/` with full
 * node detail (target selector + computed fg/bg colors + ratio +
 * outerHTML). Throwaway diagnostic, gitignored once we're done.
 */

interface ContrastViolation {
  target: string[];
  html: string;
  failureSummary: string;
  any: { data?: { fgColor?: string; bgColor?: string; contrastRatio?: number } }[];
}

test.describe("E11b - contrast diagnostic", () => {
  test("dump contrast violations on /", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.addScriptTag({
    url: "https://cdn.jsdelivr.net/npm/axe-core@4.10.0/axe.min.js",
  });
  const data = (await page.evaluate(async () => {
    const axe = (window as unknown as {
      axe: { run: (ctx: unknown, opts: unknown) => Promise<{
        violations: { id: string; nodes: ContrastViolation[] }[];
      }> };
    }).axe;
    const res = await axe.run(document, {
      runOnly: { type: "rule", values: ["color-contrast"] },
    });
    return res.violations[0]?.nodes ?? [];
  })) as ContrastViolation[];

  console.log(`\n=== ${data.length} color-contrast nodes on / ===`);
  for (const [i, n] of data.entries()) {
    const d = n.any[0]?.data ?? {};
    console.log(
      `\n#${i + 1}  target: ${n.target.join(" ")}\n` +
        `     fg=${d.fgColor ?? "?"}  bg=${d.bgColor ?? "?"}  ratio=${d.contrastRatio ?? "?"}\n` +
        `     html: ${n.html.slice(0, 240)}`
    );
  }
});
});
