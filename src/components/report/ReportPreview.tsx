"use client";

interface ReportPreviewProps {
  content: string;
}

/**
 * Lightweight markdown renderer for the editor preview pane.
 *
 * Built in-house so we don't ship a 50KB markdown library to the
 * dashboard for one preview pane. Supports the subset the LLM emits:
 *
 *   • Headers (#, ##, ###)
 *   • Tables — header row + alignment separator + body rows wrapped
 *     in a single <table>. Without proper grouping the rows collapse
 *     to inline text in the browser ("AssetBalance% of Total:--..." —
 *     reported issue).
 *   • Bullet lists wrapped in <ul>
 *   • Inline **bold**, *italic*, `code`
 *   • Horizontal rules (---)
 *   • Plain paragraphs
 *
 * Output stays close to what pdf-template.tsx renders so the preview
 * matches the eventual investor PDF.
 */
export function ReportPreview({ content }: ReportPreviewProps) {
  if (!content) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 14,
          color: "var(--vb-dim)",
        }}
      >
        No content yet
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "24px 28px",
        fontSize: 14,
        maxWidth: "100%",
        fontFamily: "var(--font-inter), Inter, sans-serif",
      }}
      dangerouslySetInnerHTML={{ __html: render(content) }}
    />
  );
}

// ─── parser ────────────────────────────────────────────────────────────

function render(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Tables: header row, then `:---|---|:---:` separator, then body
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(renderTable(header, rows));
      continue;
    }

    // Bullet lists — group consecutive bullets into one <ul>
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        `<ul style="margin:8px 0 12px;padding:0 0 0 22px;color:#a8a8a8">${items
          .map(
            (it) =>
              `<li style="margin:4px 0;line-height:1.6">${inline(it)}</li>`
          )
          .join("")}</ul>`
      );
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      out.push(
        `<h3 style="font-family:var(--font-space-grotesk),'Space Grotesk',sans-serif;font-size:16px;font-weight:600;color:#f0f0f0;margin:24px 0 8px;letter-spacing:-0.01em">${inline(line.slice(4))}</h3>`
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(
        `<h2 style="font-family:var(--font-space-grotesk),'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:#f0f0f0;margin:32px 0 12px;letter-spacing:-0.02em">${inline(line.slice(3))}</h2>`
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      out.push(
        `<h1 style="font-family:var(--font-space-grotesk),'Space Grotesk',sans-serif;font-size:26px;font-weight:700;color:#f0f0f0;margin:0 0 18px;letter-spacing:-0.03em">${inline(line.slice(2))}</h1>`
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      out.push(
        `<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:20px 0"/>`
      );
      i++;
      continue;
    }

    // Blank line → small spacer
    if (line.trim() === "") {
      out.push(`<div style="height:8px"></div>`);
      i++;
      continue;
    }

    // Plain paragraph — inline-format
    out.push(
      `<p style="color:#a8a8a8;line-height:1.7;margin:0 0 8px">${inline(line)}</p>`
    );
    i++;
  }

  return out.join("");
}

// ─── helpers ───────────────────────────────────────────────────────────

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  // matches |---|---| or | :--- | :---: | ---: |
  return /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);
}

function splitRow(line: string): string[] {
  // Strip leading/trailing pipe, split, trim each cell.
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function renderTable(header: string[], rows: string[][]): string {
  const th = header
    .map(
      (h) =>
        `<th style="text-align:left;padding:10px 12px;font-size:12px;font-weight:600;color:#bdbdbd;border-bottom:1px solid rgba(255,255,255,0.12);text-transform:uppercase;letter-spacing:0.04em">${inline(h)}</th>`
    )
    .join("");

  const tbody = rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (c) =>
              `<td style="padding:10px 12px;color:#d4d4d4;border-bottom:1px solid rgba(255,255,255,0.06);font-variant-numeric:tabular-nums">${inline(c)}</td>`
          )
          .join("")}</tr>`
    )
    .join("");

  return `<table style="width:100%;border-collapse:collapse;margin:12px 0 16px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden"><thead><tr>${th}</tr></thead><tbody>${tbody}</tbody></table>`;
}

/**
 * Inline formatting. Order matters:
 *   1) escape raw HTML so user-content can't inject markup
 *   2) code spans (so ** inside backticks doesn't bold)
 *   3) bold (**...**)
 *   4) italic (*...* or _..._)
 */
function inline(s: string): string {
  let out = escapeHtml(s);
  // Inline code first — protect content from later bold/italic passes.
  out = out.replace(
    /`([^`]+)`/g,
    `<code style="font-family:var(--font-geist-mono),monospace;background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;font-size:0.9em;color:#e4e4e4">$1</code>`
  );
  // Bold (greedy match for ** ... **). Disallow line breaks inside.
  out = out.replace(
    /\*\*([^*\n]+?)\*\*/g,
    `<strong style="color:#f0f0f0;font-weight:600">$1</strong>`
  );
  // Italic — single * or _, but skip cases adjacent to alphanumerics
  // (e.g. snake_case in code-like words shouldn't italicise).
  out = out.replace(
    /(^|[^A-Za-z0-9_*])\*([^*\n]+?)\*(?=[^A-Za-z0-9_*]|$)/g,
    `$1<em style="color:#d4d4d4">$2</em>`
  );
  out = out.replace(
    /(^|[^A-Za-z0-9_])_([^_\n]+?)_(?=[^A-Za-z0-9_]|$)/g,
    `$1<em style="color:#d4d4d4">$2</em>`
  );
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
