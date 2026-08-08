// Renders a PDF end-to-end and asserts the embedded fonts actually made it in.
//
// The only thing that exercises pdf-template.tsx + pdf-fonts.ts for real.
// `npm run test` cannot: vitest's `include` is ["src/**/*.test.ts"], so .tsx
// is never collected, and a component test would not prove that @react-pdf
// can decode the base64 and embed the subset anyway.
//
// Deliberately NOT in CI — it renders a real document and is slow. Run it
// after any change to the template, the charts, or the font pipeline.
//
//   node --import tsx scripts/smoke-pdf.mjs
//
// No DB needed: it builds the template props directly rather than going
// through generatePDF, so it runs anywhere.

import { writeFileSync, mkdirSync } from "node:fs";
import zlib from "node:zlib";
import { join } from "node:path";
import React from "react";

const OUT_DIR = join(process.cwd(), "tmp-screenshots");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`✓ ${label}`);
  } else {
    failed++;
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Exercises the paths that have historically broken: symbols the old
// sanitizer mangled, an address that must not be hyphenated, a table, a
// bulleted list, and inline emphasis.
//
// The leading paragraph is deliberate — it sits ABOVE the first heading,
// which the old parser silently discarded. So are the `#` and `####` levels,
// which used to print their own hashes, the ordered list, which collapsed
// into a run-on paragraph, and the link, which printed its own brackets.
const MARKDOWN = `An opening line that sits above the first heading.

# Radworks Treasury

## Executive Summary

The treasury held **$2,413,417** across 4 wallets — a rise of 12% ≈ $258K.
Runway → 2.8 months at the trailing burn of $231,700/mo. Reconciled ✓.

### Treasury Composition

| Asset | Value | Share |
| :--- | ---: | :---: |
| USDC | $934,909 | 39% |
| RAD | $1,478,508 | 61% |

### Notes

- Contributors paid: José Muñoz, Šimon Novák
- Cover ≥ 80%, drift ≤ 2%, fees ±5%
- Primary Safe \`0xcC7d34C76A9d08aa0109F7Bae35f29C1CE35355A\`
- Emoji 🚀 and a star ★ must not leave boxes

#### Data Quality

1. Garden/App Safe ownership rests on a transfer relationship alone.
2. Wintermute transfer purpose is not evidenced publicly.
3. RAD lock status could not be determined.

Source: [Etherscan](https://etherscan.io/address/0xcC7d34C76A9d08aa0109F7Bae35f29C1CE35355A).
A rejected scheme must degrade to text: [click](javascript:alert(1)).

---

*Prepared independently.*
`;

const { VaultBriefPDF } = await import(
  "../src/server/services/pdf-template.tsx"
);
const { registerReportFonts } = await import(
  "../src/server/services/pdf-fonts.ts"
);
const { renderToBuffer } = await import("@react-pdf/renderer");

await registerReportFonts();
check("registerReportFonts() resolves", true);

const element = React.createElement(VaultBriefPDF, {
  projectName: "Smoke Test Treasury",
  logoUrl: null,
  website: "vaultbrief.io",
  period: "August 2026",
  contentMd: MARKDOWN,
  kind: "investor",
  primaryColor: "#00e87b",
  snapshot: null,
  trendSnapshots: [],
  compositionSlices: [
    { label: "Stablecoins", value: 934909 },
    { label: "Own token", value: 1478508 },
  ],
});

const buffer = Buffer.from(await renderToBuffer(element));

check("produces a non-trivial buffer", buffer.length > 20_000, `${buffer.length} bytes`);
check("starts with the %PDF- magic bytes", buffer.subarray(0, 5).toString() === "%PDF-");
check(
  "ends with an EOF marker",
  buffer.subarray(-1024).toString("latin1").includes("%%EOF")
);

// The point of the whole stage: is the document actually SET in the report
// faces, or did registration silently fail and react-pdf fall back to base-14?
//
// Checking for the absence of a /Helvetica resource is the obvious test and
// it is the wrong one. react-pdf emits `/F1 <size> Tf` for an empty text run
// (the header's two-line block produces one) and then ends the run without
// drawing anything, so a bare /Helvetica resource is declared in every
// document no matter what. Verified by decompressing the content streams:
// the Tf is immediately followed by ET, with no Tj/TJ between them.
//
// So parse the content streams instead and count text-showing operators
// against whichever font is selected at the time. That measures the property
// anyone actually cares about — what the reader sees — and it is strictly
// stronger than a grep.
const usage = fontUsage(buffer);
const drawnWith = Object.keys(usage);

check("draws text at all", drawnWith.length > 0, "no text-showing operators found");
check(
  "draws body text in Spectral",
  drawnWith.some((f) => /Spectral/.test(f)),
  `fonts used: ${drawnWith.join(", ")}`
);
check(
  "draws tabular/label text in IBM Plex Mono",
  drawnWith.some((f) => /Plex/.test(f)),
  `fonts used: ${drawnWith.join(", ")}`
);
check(
  "draws NOTHING in a base-14 fallback face",
  !drawnWith.some((f) => /^(Helvetica|Courier|Times|Symbol|ZapfDingbats)/.test(f)),
  `base-14 draws text: ${drawnWith.filter((f) => /^(Helvetica|Courier|Times)/.test(f)).join(", ")}`
);
// Subset prefixes (ABCDEF+Name) are pdfkit's signature for an embedded,
// subsetted font. Their absence would mean the face was referenced by name
// but never embedded — the failure mode that produces boxes on a machine
// without the font installed.
check(
  "every drawn face is embedded and subsetted",
  drawnWith.every((f) => /^[A-Z]{6}\+/.test(f)),
  `not subsetted: ${drawnWith.filter((f) => !/^[A-Z]{6}\+/.test(f)).join(", ")}`
);

console.log("\nGlyph-drawing operations per font:");
for (const [face, n] of Object.entries(usage)) {
  console.log(`   ${String(n).padStart(5)}  ${face}`);
}

/**
 * Which fonts actually draw glyphs, and how many text-showing operations
 * each performs.
 *
 * Resolves `/F1`-style resource names to their real BaseFont via the object
 * table, then walks each decompressed content stream in order, tracking the
 * selected font across `Tf` and counting every `Tj`/`TJ` that follows.
 */
function fontUsage(pdf) {
  const s = pdf.toString("latin1");

  const objects = {};
  for (const m of s.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
    objects[m[1]] = m[2];
  }

  const baseFontOf = {};
  for (const [id, body] of Object.entries(objects)) {
    const bf = body.match(/\/BaseFont\s*\/([A-Za-z0-9+\-,._]+)/);
    if (bf) baseFontOf[id] = bf[1];
  }

  const resourceToFace = {};
  for (const body of Object.values(objects)) {
    const dict = body.match(/\/Font\s*<<([^>]*)>>/);
    if (!dict) continue;
    for (const m of dict[1].matchAll(/\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g)) {
      if (baseFontOf[m[2]]) resourceToFace["/" + m[1]] = baseFontOf[m[2]];
    }
  }

  const used = {};
  const streamStart = /stream\r?\n/g;
  let m;
  while ((m = streamStart.exec(s)) !== null) {
    const from = m.index + m[0].length;
    const to = s.indexOf("endstream", from);
    if (to < 0) continue;

    let content;
    try {
      content = zlib.inflateSync(pdf.subarray(from, to)).toString("latin1");
    } catch {
      continue; // not a Flate stream (an image, or already plain)
    }

    const events = [];
    for (const t of content.matchAll(/(\/[A-Za-z0-9]+)\s+[\d.]+\s+Tf/g)) {
      events.push({ at: t.index, font: t[1] });
    }
    for (const t of content.matchAll(/\)\s*Tj|\]\s*TJ/g)) {
      events.push({ at: t.index, show: true });
    }
    events.sort((a, b) => a.at - b.at);

    let current = null;
    for (const e of events) {
      if (e.font) current = e.font;
      else if (current) {
        const face = resourceToFace[current] ?? current;
        used[face] = (used[face] ?? 0) + 1;
      }
    }
  }

  return used;
}

// ── the overflow regression ────────────────────────────────────────────────
//
// Every section used to render inside `<View wrap={false}>`, so a section
// taller than one page could not break and simply ran off the bottom — the
// content was gone from the document, silently. The orphan guard now lives on
// headings (`minPresenceAhead`) and `wrap={false}` only on individual table
// rows, so a long section must paginate.
//
// Asserted by page count rather than by eye: one heading followed by far more
// prose than fits on a page has to produce several pages.
// Calibrated against a control rather than a magic page count, because a
// fixed threshold is both brittle and — as this very check proved on its
// first run — too weak: with the bug reintroduced, 120 paragraphs rendered
// as TWO pages, which still satisfied "more than one page" while most of the
// document had silently fallen off the bottom.
//
// The control has the SAME paragraphs, only split across many short sections.
// Those paginate correctly under either implementation, so it measures how
// many pages the content genuinely needs. One tall section must then come out
// at a comparable length; if it collapses to a fraction of the control, the
// difference is content that never made it onto a page.
const PARAS = Array.from(
  { length: 120 },
  (_, i) =>
    `Paragraph ${i + 1}. The treasury position is restated here at length so ` +
    `that the section cannot possibly fit within a single A4 page at 10pt.`
);

const ONE_SECTION = ["## A section far taller than one page", "", ...PARAS.flatMap((p) => [p, ""])].join("\n");
const MANY_SECTIONS = PARAS.flatMap((p, i) =>
  i % 10 === 0 ? [`## Section ${i / 10 + 1}`, "", p, ""] : [p, ""]
).join("\n");

async function pageCountOf(contentMd) {
  const b = Buffer.from(
    await renderToBuffer(
      React.createElement(VaultBriefPDF, {
        projectName: "Overflow Test",
        logoUrl: null,
        website: null,
        period: "August 2026",
        contentMd,
        kind: "investor",
        primaryColor: "#00e87b",
        snapshot: null,
        trendSnapshots: [],
        compositionSlices: [],
      })
    )
  );
  return {
    buffer: b,
    pages: (b.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length,
  };
}

const oneSection = await pageCountOf(ONE_SECTION);
const control = await pageCountOf(MANY_SECTIONS);

// Two independent floors, because each catches a different shape of the
// failure. The RATIO catches a regression that clips only the tall section,
// leaving the control intact. The ABSOLUTE floor catches one that clips
// everything — which is what happened when this was checked by reintroducing
// the old wrap={false}: BOTH fixtures collapsed to 2 pages, so the ratio alone
// still passed while most of the document had fallen off the bottom.
const MIN_PAGES = 4; // 120 paragraphs at ~2 lines each cannot fit in fewer
check(
  "a section taller than a page breaks instead of dropping content",
  oneSection.pages >= control.pages * 0.7 && oneSection.pages >= MIN_PAGES,
  `one tall section: ${oneSection.pages} pages; control: ${control.pages}; floor: ${MIN_PAGES}`
);
console.log(
  `   (one tall section: ${oneSection.pages} pages · control: ${control.pages} pages)`
);

const longBuffer = oneSection.buffer;

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, "smoke-report.pdf");
writeFileSync(out, buffer);
writeFileSync(join(OUT_DIR, "smoke-report-long.pdf"), longBuffer);
console.log(`\nWrote ${out} (${(buffer.length / 1024).toFixed(0)} KB) — open it and look at it.`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
