// A report as one self-contained HTML file.
//
// The third export alongside PDF and Markdown, and the one that keeps the most
// of the document: real typography, real tables, working links, and nothing to
// fetch. A founder can attach it to an email, drop it in a shared drive, or
// open it on a machine that has never heard of Spectral, and it looks the same.
//
// SELF-CONTAINED IS THE WHOLE POINT, so:
//   - the four typefaces are inlined as base64, from the same modules the PDF
//     embeds. No @font-face URL, no CDN, no next/font.
//   - the stylesheet is inlined and written here rather than read from
//     globals.css at runtime. Reading a source file from a bundled Lambda is
//     the exact failure mode the font pipeline was designed away from in 18.3;
//     the honest cost is a second stylesheet, and `report-html-export.test.ts`
//     holds its palette in agreement with DOC_LIGHT the same way the
//     globals.css parity test does.
//
// SCOPE: this exports the DOCUMENT — masthead, narrative, disclaimer. Not the
// widget strip. Those are Recharts components that need a live browser to
// measure their container, so server-rendering them into a static file yields
// empty boxes. An export that quietly omitted its charts would be worse than
// one that never promised them.

import React from "react";
import { ReportPreview } from "@/components/report/ReportPreview";
import { REPORT_DISCLAIMER } from "@/lib/report-disclaimer";
import { DOC_LIGHT, readableAccentOn, DEFAULT_ACCENT } from "@/lib/report-theme";
import { SPECTRAL_REGULAR_B64 } from "@/assets/fonts/generated/Spectral-Regular.base64";
import { SPECTRAL_SEMIBOLD_B64 } from "@/assets/fonts/generated/Spectral-SemiBold.base64";
import { SPECTRAL_ITALIC_B64 } from "@/assets/fonts/generated/Spectral-Italic.base64";
import { PLEX_MONO_REGULAR_B64 } from "@/assets/fonts/generated/IBMPlexMono-Regular.base64";

export interface HtmlExportInput {
  projectName: string;
  /** "Investor Update" | "Grant Report" — from describeReport. */
  kind: string;
  /** "April 2026" | "14 Feb – 31 Jul 2026" — from describeReport. */
  period: string;
  contentMd: string;
  website?: string | null;
  /** Project brand colour. Already validated by `brandingFor`. */
  accent?: string;
}

/**
 * Escape text destined for an HTML *text node or attribute*.
 *
 * The markdown body does NOT come through here — it is rendered by React,
 * which escapes on its own. This is only for the handful of values this module
 * interpolates into the shell by hand, and they are all project-controlled
 * strings (name, website) that a founder can set to anything.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function face(family: string, b64: string, weight: number, style: string): string {
  return (
    `@font-face{font-family:"${family}";` +
    `src:url(data:font/truetype;base64,${b64}) format("truetype");` +
    `font-weight:${weight};font-style:${style};font-display:swap}`
  );
}

const FONT_FACES = [
  face("VBSerif", SPECTRAL_REGULAR_B64, 400, "normal"),
  face("VBSerif", SPECTRAL_SEMIBOLD_B64, 600, "normal"),
  face("VBSerif", SPECTRAL_ITALIC_B64, 400, "italic"),
  face("VBMono", PLEX_MONO_REGULAR_B64, 400, "normal"),
].join("\n");

/**
 * The document stylesheet, mirroring the `.vb-doc*` rules in globals.css.
 *
 * Kept as a template so the palette comes from DOC_LIGHT rather than being
 * retyped — a drifted hex is the failure this is most likely to suffer, and
 * this removes the opportunity for it entirely for colours.
 */
function stylesheet(accentInk: string, accentFill: string): string {
  const D = DOC_LIGHT;
  return `
${FONT_FACES}
*{box-sizing:border-box}
:root{
  --doc-paper:${D.paper};--doc-raised:${D.paperRaised};
  --doc-line:${D.line};--doc-line-strong:${D.lineStrong};
  --doc-ink:${D.ink};--doc-ink-soft:${D.inkSoft};--doc-ink-faint:${D.inkFaint};
  --doc-ok:${D.ok};--doc-warn:${D.warn};--doc-danger:${D.danger};--doc-info:${D.info};
  --doc-accent:${accentFill};--doc-accent-ink:${accentInk};
  --font-spectral:"VBSerif";--font-plex-mono:"VBMono";
}
html,body{margin:0;padding:0;background:${D.paper};color:${D.ink}}
body{padding:0 20px}
.sheet{max-width:820px;margin:0 auto;padding:44px 0 64px}
.masthead{border-bottom:2px solid ${D.ink};padding-bottom:16px;margin-bottom:26px}
.kicker{font-family:var(--font-plex-mono),ui-monospace,monospace;font-size:11px;
  letter-spacing:.09em;text-transform:uppercase;color:${D.inkFaint};margin:0}
.title{font-family:var(--font-spectral),Georgia,serif;font-weight:600;font-size:32px;
  line-height:1.15;letter-spacing:-.01em;margin:8px 0 0;color:${D.ink};text-wrap:balance}
.meta{display:flex;flex-wrap:wrap;gap:14px 40px;margin:22px 0 0}
.meta dt{font-family:var(--font-plex-mono),ui-monospace,monospace;font-size:10px;
  letter-spacing:.08em;text-transform:uppercase;color:${D.inkFaint};margin:0 0 3px}
.meta dd{font-family:var(--font-plex-mono),ui-monospace,monospace;font-size:13px;
  color:${D.inkSoft};margin:0}
.vb-doc-body{font-family:var(--font-spectral),Georgia,serif;font-size:15px;
  line-height:1.62;color:${D.ink};font-variant-numeric:tabular-nums}
.vb-doc-body>*:first-child{margin-top:0}
.vb-doc-h1,.vb-doc-h2,.vb-doc-h3{font-family:var(--font-spectral),Georgia,serif;
  font-weight:600;color:${D.ink};letter-spacing:-.005em;text-wrap:balance}
.vb-doc-h1{font-size:25px;line-height:1.2;margin:30px 0 12px;padding-bottom:7px;
  border-bottom:1px solid ${D.line}}
.vb-doc-h2{font-size:19px;line-height:1.28;margin:26px 0 9px}
.vb-doc-h3{font-size:16px;line-height:1.35;margin:20px 0 7px}
.vb-doc-h4{font-family:var(--font-plex-mono),ui-monospace,monospace;font-size:11px;
  font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:${D.inkFaint};
  margin:22px 0 7px}
.vb-doc-p{margin:0 0 12px}
.vb-doc-ul,.vb-doc-ol{margin:0 0 14px;padding-left:22px}
.vb-doc-ul{list-style:none;padding-left:16px}
.vb-doc-ul li,.vb-doc-ol li{margin:0 0 5px;padding-left:3px}
.vb-doc-ul li{position:relative}
.vb-doc-ul li::before{content:"";position:absolute;left:-12px;top:.62em;width:4px;
  height:4px;border-radius:50%;background:${accentFill}}
.vb-doc-ol li::marker{font-family:var(--font-plex-mono),ui-monospace,monospace;
  font-size:.82em;color:${D.inkFaint}}
.vb-doc-hr{border:none;border-top:1px solid ${D.line};margin:22px 0}
.vb-doc-a{color:${accentInk};text-underline-offset:2px}
.vb-doc-code,.vb-doc-pre{font-family:var(--font-plex-mono),ui-monospace,monospace;
  background:${D.paperRaised};color:${D.inkSoft}}
.vb-doc-code{font-size:.86em;padding:1px 5px;border:1px solid ${D.line};
  border-radius:3px;word-break:break-all}
.vb-doc-pre{font-size:12.5px;line-height:1.45;padding:12px 14px;margin:0 0 14px;
  border-left:2px solid ${D.line};overflow-x:auto}
.vb-doc-pre code{background:none;border:none;padding:0}
.vb-table-scroll{overflow-x:auto}
.vb-doc-tablewrap{margin:0 0 18px}
.vb-doc-table{width:100%;border-collapse:collapse;font-size:13.5px}
.vb-doc-table th{font-family:var(--font-plex-mono),ui-monospace,monospace;font-size:10.5px;
  font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:${D.inkFaint};
  padding:0 10px 6px;border-bottom:1px solid ${D.ink};white-space:nowrap}
.vb-doc-table td{padding:7px 10px;border-bottom:1px solid ${D.line};color:${D.ink};
  vertical-align:top}
.vb-doc-table tbody tr:last-child td{border-bottom:none}
.vb-doc-table td.vb-doc-num{font-family:var(--font-plex-mono),ui-monospace,monospace;
  font-size:12.5px;white-space:nowrap}
.footer{border-top:1px solid ${D.line};margin-top:34px;padding-top:16px;font-size:12px;
  line-height:1.5;color:${D.inkFaint};
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media print{
  @page{margin:18mm 16mm}
  html,body{background:#fff}
  body{padding:0}
  .sheet{max-width:none;padding:0}
  .vb-doc-h1,.vb-doc-h2,.vb-doc-h3,.vb-doc-h4{break-after:avoid-page}
  .vb-doc-table,.vb-doc-pre,.vb-doc-tablewrap{break-inside:avoid-page}
  .vb-doc-table tr{break-inside:avoid-page}
  .vb-doc-table thead{display:table-header-group}
  .vb-table-scroll{overflow:visible}
  .vb-doc-a[href^="http"]::after{content:" (" attr(href) ")";
    font-family:var(--font-plex-mono),monospace;font-size:.78em;word-break:break-all;
    color:${D.inkFaint}}
}`.trim();
}

/**
 * Build the file. No database, no filesystem, no network — everything it needs
 * is either passed in or bundled, which is also what makes it testable.
 *
 * Async only because of the dynamic import below.
 */
export async function buildReportHtml(input: HtmlExportInput): Promise<string> {
  const accentFill =
    input.accent && input.accent.trim() ? input.accent : DEFAULT_ACCENT;
  const accentInk = readableAccentOn(accentFill, DOC_LIGHT.paper);

  // React escapes the markdown body's text for us; the shell values below are
  // escaped by hand because they are interpolated into a string.
  // Dynamic import, for the same reason pdf-generator.ts:5-12 documents for
  // @react-pdf/renderer: Next 16 refuses a STATIC  import
  // anywhere in the app graph ("You're importing a component that imports
  // react-dom/server"). That guard is aimed at accidentally server-rendering
  // inside a page; here the whole product IS a server-rendered string, so the
  // import is deferred to call time rather than the guard worked around.
  const { renderToStaticMarkup } = await import("react-dom/server");

  const body = renderToStaticMarkup(
    React.createElement(ReportPreview, { content: input.contentMd ?? "" })
  );

  const name = escapeHtml(input.projectName);
  const title = `${name} — ${escapeHtml(input.kind)}, ${escapeHtml(input.period)}`;

  const websiteRow = input.website
    ? `<div><dt>Project</dt><dd>${escapeHtml(input.website)}</dd></div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>${stylesheet(accentInk, accentFill)}</style>
</head>
<body>
<div class="sheet">
  <header class="masthead">
    <p class="kicker">${escapeHtml(input.kind)}</p>
    <h1 class="title">${name}</h1>
    <dl class="meta">
      <div><dt>Period</dt><dd>${escapeHtml(input.period)}</dd></div>
      ${websiteRow}
    </dl>
  </header>
  ${body}
  <footer class="footer">
    <p>${escapeHtml(REPORT_DISCLAIMER)}</p>
    <p>Generated by Vault Brief — vaultbrief.io. Confidential.</p>
  </footer>
</div>
</body>
</html>`;
}

/** Mirrors pdf-generator's convention, swapping the extension. */
export function htmlExportFilename(projectSlug: string, periodEnd: string): string {
  return `${projectSlug}-report-${periodEnd}.html`;
}
