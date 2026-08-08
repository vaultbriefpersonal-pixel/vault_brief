import { describe, it, expect } from "vitest";
import {
  buildReportHtml,
  htmlExportFilename,
  escapeHtml,
} from "./report-html-export";
import { DOC_LIGHT, DEFAULT_ACCENT, contrastRatio } from "@/lib/report-theme";

const MD = [
  "Lead-in above the first heading.",
  "",
  "# Treasury Brief",
  "",
  "## Summary",
  "",
  "Held **$2,413,417** across 4 wallets.",
  "",
  "| Asset | Value |",
  "| :--- | ---: |",
  "| USDC | $934,909 |",
  "",
  "1. First finding",
  "2. Second finding",
  "",
  "See [Etherscan](https://etherscan.io/address/0xabc).",
  "Rejected: [x](javascript:alert(1)).",
].join("\n");

const base = {
  projectName: "Radworks",
  kind: "Investor Update",
  period: "April 2026",
  contentMd: MD,
};

describe("buildReportHtml", async () => {
  const html = await buildReportHtml(base);

  it("is a complete standalone document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html lang=\"en\">");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
  });

  // The whole point of the format. A file that reaches for a CDN is not an
  // artifact a founder can archive or email.
  it("fetches nothing at open time", () => {
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\/fonts\./i);
    // The only URLs left should be data: URIs and links inside the content.
    expect(html).toContain("data:font/truetype;base64,");
  });

  it("embeds all four faces, in both families", () => {
    const faces = html.match(/@font-face\{/g) ?? [];
    expect(faces).toHaveLength(4);
    expect(html).toContain('font-family:"VBSerif"');
    expect(html).toContain('font-family:"VBMono"');
    expect(html).toContain("font-style:italic");
    expect(html).toContain("font-weight:600");
  });

  it("is large enough to actually contain the fonts", () => {
    // If the base64 modules silently resolved to empty strings, everything
    // above would still pass and the file would render in Times New Roman.
    expect(html.length).toBeGreaterThan(1_000_000);
  });

  it("renders the full block vocabulary from the shared parser", () => {
    expect(html).toContain('class="vb-doc-h1"');
    expect(html).toContain('class="vb-doc-h2"');
    expect(html).toContain('class="vb-doc-table"');
    expect(html).toContain('class="vb-doc-ol"');
    expect(html).toContain("vb-doc-num"); // a figure cell, set in mono
    expect(html).toContain("Lead-in above the first heading.");
  });

  // Same rule as every other surface: only http/https/mailto become links.
  it("keeps an unsafe scheme out of the href", () => {
    expect(html).toContain('href="https://etherscan.io/address/0xabc"');
    expect(html).not.toContain("javascript:alert");
  });

  it("carries the platform disclaimer", () => {
    expect(html).toContain("informational purposes only");
  });

  it("is marked noindex, in case it is ever served rather than downloaded", () => {
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });

  describe("palette parity with DOC_LIGHT", () => {
    // This stylesheet is a second copy by necessity — it must be inlined, and
    // reading globals.css from a bundled Lambda is the failure mode the font
    // pipeline was designed away from. A drifted hex is the likeliest defect,
    // so it is pinned here exactly as globals.css is pinned in its own test.
    it("uses the document palette, not retyped approximations", () => {
      for (const token of ["paper", "ink", "inkSoft", "inkFaint", "line"] as const) {
        expect(html.toLowerCase(), token).toContain(DOC_LIGHT[token].toLowerCase());
      }
    });
  });

  describe("accent handling", () => {
    it("keeps the raw brand colour for fills and a readable one for links", async () => {
      const branded = await buildReportHtml({ ...base, accent: "#00e87b" });
      // Fill: the bullet dot keeps the brand.
      expect(branded).toContain("background:#00e87b");
      // Text: darkened until it clears AA on paper.
      const linkColour = branded.match(/\.vb-doc-a\{color:(#[0-9a-f]{6})/)?.[1];
      expect(linkColour).toBeTruthy();
      expect(linkColour).not.toBe("#00e87b");
      expect(contrastRatio(linkColour!, DOC_LIGHT.paper)).toBeGreaterThanOrEqual(4.5);
    });

    it("falls back to the single default when no accent is given", async () => {
      expect(await buildReportHtml(base)).toContain(DEFAULT_ACCENT.toLowerCase());
    });
  });

  describe("shell escaping", () => {
    // The markdown body is escaped by React. These values are interpolated
    // into a string by hand, and a project name is founder-controlled.
    it("escapes the project name, kind and period", async () => {
      const nasty = await buildReportHtml({
        ...base,
        projectName: '</title><script>alert(1)</script>',
        website: '" onload="alert(1)',
      });
      expect(nasty).not.toContain("<script>alert(1)</script>");
      expect(nasty).not.toContain('onload="alert(1)');
      expect(nasty).toContain("&lt;script&gt;");
    });
  });

  it("omits the website row entirely when there is none", async () => {
    expect(await buildReportHtml(base)).not.toContain("<dt>Project</dt>");
    expect(await buildReportHtml({ ...base, website: "vaultbrief.io" })).toContain(
      "<dt>Project</dt>"
    );
  });

  it("survives empty content without throwing", async () => {
    await expect(buildReportHtml({ ...base, contentMd: "" })).resolves.toBeTypeOf("string");
  });

  it("carries the print rules that matter, since the file is printable too", () => {
    expect(html).toContain("display:table-header-group");
    expect(html).toContain("break-inside:avoid-page");
    expect(html).toContain("@page{margin:18mm 16mm}");
  });
});

describe("escapeHtml", () => {
  it("escapes all five dangerous characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("escapes the ampersand first, so entities are not double-broken", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Radworks 2026 — $2.4M")).toBe("Radworks 2026 — $2.4M");
  });
});

describe("htmlExportFilename", () => {
  it("mirrors the PDF convention with an .html extension", () => {
    expect(htmlExportFilename("index-coop", "2026-04-30")).toBe(
      "index-coop-report-2026-04-30.html"
    );
  });
});
