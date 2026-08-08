// The one place in the product that knows markdown.
//
// Before this module there were TWO hand-rolled parsers — ReportPreview's
// string→HTML `render()` and pdf-template's `parseMarkdown` + `blocksFromBody`
// — and they disagreed about the document they were both rendering. Neither
// could render a link. The PDF one silently dropped every line before the
// first heading, printed `# H1` and `#### H4` as literal `#`-prefixed text,
// collapsed `##` and `###` to one visual level, turned an ordered list into a
// single run-on paragraph, and parsed table alignment only to discard it. The
// web one made every SOURCE LINE its own paragraph, so a soft-wrapped
// paragraph rendered as a stack of them. They did not even agree on what a
// paragraph is.
//
// Both now render a typed AST produced here, so a fix lands on both surfaces
// at once and a gap becomes a compile error rather than a silent omission —
// each renderer's block `switch` carries a `never` default arm.
//
// Deliberately hand-rolled and dependency-free. Three reasons: it must behave
// IDENTICALLY in three runtimes (browser, Vercel Lambda, Trigger.dev worker);
// mdast has ~25 node types of which two renderers can honour ~8, so a real
// parser buys indirection rather than coverage; and the input is not arbitrary
// markdown but the narrow grammar `report-sections.ts` prompts the model to
// emit. The honest cost: nested emphasis of the same kind, escaped pipes
// inside table cells, and reference links are unsupported. The degradation
// rule keeps those at "renders as plain text", never "renders wrong".

export type Align = "left" | "right" | "center";

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type DocBlock =
  | { k: "heading"; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { k: "para"; c: Inline[] }
  | { k: "bullets"; items: Inline[][] }
  | { k: "ordered"; start: number; items: Inline[][] }
  | { k: "table"; head: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { k: "rule" }
  | { k: "code"; lang: string | null; v: string };

/**
 * Schemes allowed to become a real link node.
 *
 * `contentMd` is language-model output rendered on an UNAUTHENTICATED public
 * page (`/r/[reportId]`). A `javascript:` URL reaching an href there is the
 * one genuinely dangerous thing this parser could do, so the allowlist is
 * positive and anything else degrades to the link's own label as plain text —
 * the reader still sees the words, just not a clickable trap.
 */
const SAFE_SCHEMES = ["http://", "https://", "mailto:"];

// Matches up to six hashes so `##### x` is recognised at all — `#{1,4}` would
// backtrack looking for whitespace, find a fifth `#`, fail, and silently
// demote the line to prose. Depth is clamped to 4 at construction; the AST
// only carries four heading levels because no renderer distinguishes more.
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const RULE_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE_RE = /^\s*```+\s*(\S+)?\s*$/;

export function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

export function isTableSeparator(line: string): boolean {
  // | --- | :---: | ---: |
  return /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function alignmentsFrom(separator: string): Align[] {
  return splitRow(separator).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

/**
 * Anything that terminates an open paragraph. One predicate so the paragraph
 * rule cannot drift from the dispatch order in `parseReportDoc`.
 */
function startsBlock(line: string, next: string | undefined): boolean {
  if (line.trim() === "") return true;
  if (HEADING_RE.test(line)) return true;
  if (RULE_RE.test(line)) return true;
  if (FENCE_RE.test(line)) return true;
  if (BULLET_RE.test(line)) return true;
  if (ORDERED_RE.test(line)) return true;
  if (isTableRow(line) && next !== undefined && isTableSeparator(next)) return true;
  return false;
}

export function parseReportDoc(markdown: string): DocBlock[] {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: DocBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code — consumed verbatim, no inline pass.
    const fence = line.match(FENCE_RE);
    if (fence) {
      const lang = fence[1] ?? null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence, or EOF — an unterminated fence still yields a block
      out.push({ k: "code", lang, v: body.join("\n") });
      continue;
    }

    // Rule before bullets, so `---` is never read as a `-` list item.
    if (RULE_RE.test(line)) {
      out.push({ k: "rule" });
      i++;
      continue;
    }

    // Table: header row + alignment separator + body rows. Header cells go
    // through the SAME inline pass as body cells — previously they were
    // emitted raw, so `**Total**` in a header printed its asterisks.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const head = splitRow(line).map(parseInline);
      const align = alignmentsFrom(lines[i + 1]);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      out.push({ k: "table", head, align, rows });
      continue;
    }

    // Headings, levels 1..4, PRESERVED. `#### H4` was previously literal text
    // because `"#### x".startsWith("### ")` is false at index 3.
    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = Math.min(4, heading[1].length) as 1 | 2 | 3 | 4;
      out.push({ k: "heading", level, c: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (BULLET_RE.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = lines[i].match(BULLET_RE);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      out.push({ k: "bullets", items });
      continue;
    }

    if (ORDERED_RE.test(line)) {
      const start = Number.parseInt(line.match(ORDERED_RE)![1], 10);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = lines[i].match(ORDERED_RE);
        if (!m) break;
        items.push(parseInline(m[2]));
        i++;
      }
      out.push({ k: "ordered", start, items });
      continue;
    }

    // Paragraph: a run of consecutive non-block lines joined with ONE space.
    // The CommonMark rule, and the one place the two old renderers disagreed
    // outright — the web side emitted a <p> per source line.
    const buf: string[] = [line];
    i++;
    while (i < lines.length && !startsBlock(lines[i], lines[i + 1])) {
      buf.push(lines[i].trim());
      i++;
    }
    out.push({ k: "para", c: parseInline(buf.join(" ")) });
  }

  return out;
}

// ─── inline ────────────────────────────────────────────────────────────────

/**
 * Inline patterns, in precedence order for ties at the same offset.
 *
 * `lead` marks patterns whose group 1 is a boundary character that belongs to
 * the text BEFORE the span, not to the span itself. Emphasis needs it: the
 * neighbour guard has to consume a character to assert what precedes `*`, and
 * a lookbehind would be cleaner but is the kind of thing that quietly breaks
 * on an older Safari. Keeping the capture group costs one offset adjustment
 * and works everywhere.
 */
interface Pattern {
  re: RegExp;
  lead: boolean;
  build: (m: RegExpMatchArray) => Inline | null;
  /** Visible text to fall back to when `build` rejects the match. */
  label: (m: RegExpMatchArray) => string;
}

const PATTERNS: Pattern[] = [
  {
    re: /`([^`\n]+)`/,
    lead: false,
    build: (m) => ({ t: "code", v: m[1] }),
    label: (m) => m[1],
  },
  {
    // The href allows ONE level of balanced parentheses. Report bodies cite
    // Wikipedia and explorer URLs that legitimately contain them, and a
    // paren-blind `[^)\s]*` would stop at the inner `)` and leave the outer
    // one dangling as stray punctuation in the prose.
    re: /\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/,
    lead: false,
    build: (m) => {
      const href = m[2].trim();
      if (!SAFE_SCHEMES.some((s) => href.toLowerCase().startsWith(s))) return null;
      // A bare `[](url)` still needs something readable on the page.
      const label = m[1].trim() === "" ? href : m[1];
      return { t: "link", href, c: parseInline(label) };
    },
    label: (m) => m[1],
  },
  {
    re: /\*\*([^*\n]+?)\*\*/,
    lead: false,
    build: (m) => ({ t: "strong", c: parseInline(m[1]) }),
    label: (m) => m[1],
  },
  {
    // Single `*`, refusing alphanumeric neighbours so a mid-word asterisk and
    // snake_case don't italicise. Preserved from the web renderer, which had
    // this right and the PDF one did not.
    re: /(^|[^A-Za-z0-9_*])\*([^*\n]+?)\*(?![A-Za-z0-9_*])/,
    lead: true,
    build: (m) => ({ t: "em", c: parseInline(m[2]) }),
    label: (m) => m[2],
  },
  {
    re: /(^|[^A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/,
    lead: true,
    build: (m) => ({ t: "em", c: parseInline(m[2]) }),
    label: (m) => m[2],
  },
];

interface Hit {
  at: number;
  m: RegExpMatchArray;
  p: Pattern;
}

function firstHit(src: string): Hit | null {
  let best: Hit | null = null;
  for (const p of PATTERNS) {
    const m = src.match(p.re);
    if (!m || m.index === undefined) continue;
    // Offset past the boundary char so precedence compares like with like.
    const at = m.index + (p.lead ? m[1].length : 0);
    if (best === null || at < best.at) best = { at, m, p };
  }
  return best;
}

/**
 * Parse one line of inline markup into nodes.
 *
 * Scans for the EARLIEST match across all patterns rather than running fixed
 * passes in sequence, so `**bold** and *italic*` and `*italic* and **bold**`
 * parse identically — a sequential-pass design gets the second one wrong.
 * Code wins ties, which is what makes backtick contents opaque to emphasis.
 *
 * No HTML escaping here. The AST holds raw strings; escaping is the renderer's
 * job, and React escapes for free — which is how the web side sheds
 * `dangerouslySetInnerHTML` entirely.
 */
export function parseInline(src: string): Inline[] {
  if (!src) return [];
  const out: Inline[] = [];
  let rest = src;

  while (rest.length > 0) {
    const hit = firstHit(rest);
    if (!hit) {
      out.push({ t: "text", v: rest });
      break;
    }

    const before = rest.slice(0, hit.at);
    if (before) out.push({ t: "text", v: before });

    const consumed = hit.m[0].length - (hit.p.lead ? hit.m[1].length : 0);
    const node = hit.p.build(hit.m);
    if (node) {
      out.push(node);
    } else {
      // Rejected (today: an unsafe link scheme). Emit the human-readable
      // label as plain text — a reader must never silently lose words
      // because a URL was malformed or hostile.
      const label = hit.p.label(hit.m);
      if (label) out.push({ t: "text", v: label });
    }

    rest = rest.slice(hit.at + consumed);
  }

  return mergeAdjacentText(out);
}

function mergeAdjacentText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.t === "text" && prev && prev.t === "text") {
      out[out.length - 1] = { t: "text", v: prev.v + n.v };
    } else {
      out.push(n);
    }
  }
  return out;
}

// ─── derived helpers ───────────────────────────────────────────────────────

export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
        case "code":
          return n.v;
        case "strong":
        case "em":
        case "link":
          return inlineText(n.c);
        default: {
          const exhaustive: never = n;
          return exhaustive;
        }
      }
    })
    .join("");
}

/**
 * Flatten to plain text — for the public page's `og:description`, where markup
 * would surface as literal punctuation in a link unfurl.
 */
export function docPlainText(blocks: DocBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.k) {
      case "heading":
      case "para":
        parts.push(inlineText(b.c));
        break;
      case "bullets":
      case "ordered":
        parts.push(b.items.map(inlineText).join(" "));
        break;
      case "table":
        parts.push(
          [b.head, ...b.rows].map((r) => r.map(inlineText).join(" ")).join(" ")
        );
        break;
      case "code":
        parts.push(b.v);
        break;
      case "rule":
        break;
      default: {
        const exhaustive: never = b;
        void exhaustive;
      }
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Does this cell hold a figure rather than prose?
 *
 * Drives two presentation decisions in both renderers: set it in the mono
 * face with tabular figures, and right-align it when the table's own
 * alignment row didn't say. Models emit alignment markers inconsistently, so
 * a financial table would otherwise come out ragged-left with proportional
 * digits — which is the single clearest visual tell of a document that was
 * generated rather than typeset.
 *
 * Intentionally conservative. A cell qualifies only if, once currency and
 * grouping marks are stripped, what remains is essentially numeric. Prose
 * that merely mentions a number ("up 12% year on year") stays prose, because
 * setting a sentence in mono looks worse than leaving a figure in serif.
 */
export function isNumericCell(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  // Em dash, en dash and hyphen are the conventional "no value" markers, and
  // they belong with the column they sit in.
  if (/^[-–—]$/.test(t)) return true;
  // Hex addresses and tx hashes: not numbers, but mono is exactly right.
  if (/^0x[0-9a-fA-F]{6,}$/.test(t)) return true;
  // Strip currency symbols, grouping separators, sign, percent and the
  // parentheses accountants use for negatives, then require digits only.
  const stripped = t
    .replace(/^[($+-]+/, "")
    .replace(/[)%]+$/, "")
    .replace(/[$€£¥]/g, "")
    .replace(/[,\s]/g, "")
    .replace(/[KMB]$/i, "");
  return stripped !== "" && /^\d+(\.\d+)?$/.test(stripped);
}

/**
 * Relative column widths for a table, summing to 1.
 *
 * Replaces `flex: 1` on every column, which made a 60-character address column
 * exactly as wide as a `%` column and wrapped every wide financial table
 * badly. Width tracks the longest cell per column, clamped at both ends so one
 * runaway column cannot starve the rest: MAX_CHARS caps what a single long
 * address can claim, MIN_SHARE guarantees every column a floor.
 *
 * Pure and exported so the degenerate cases — one column, ten columns, a
 * column of full hex addresses — are testable directly.
 */
export function columnWidths(
  align: Align[],
  head: Inline[][],
  rows: Inline[][][]
): number[] {
  const n = Math.max(
    align.length,
    head.length,
    ...rows.map((r) => r.length),
    1
  );
  const MAX_CHARS = 28;
  const MIN_SHARE = 0.06;

  const widest: number[] = new Array(n).fill(1);
  const measure = (cells: Inline[][]) => {
    for (let c = 0; c < n; c++) {
      const len = cells[c] ? inlineText(cells[c]).length : 0;
      widest[c] = Math.max(widest[c], Math.min(len, MAX_CHARS));
    }
  };
  measure(head);
  for (const r of rows) measure(r);

  const total = widest.reduce((s, w) => s + w, 0);
  const raw = widest.map((w) => w / total);

  // Lift every column to the floor, then reclaim the shortfall from the
  // columns above it, proportionally to how far above they sit.
  const lifted = raw.map((w) => Math.max(w, MIN_SHARE));
  const overflow = lifted.reduce((s, w) => s + w, 0) - 1;
  if (overflow <= 1e-9) return normalize(lifted);

  const surplusTotal = lifted.reduce((s, w) => s + Math.max(0, w - MIN_SHARE), 0);
  if (surplusTotal <= 0) return normalize(lifted);

  return normalize(
    lifted.map((w) => w - overflow * (Math.max(0, w - MIN_SHARE) / surplusTotal))
  );
}

function normalize(widths: number[]): number[] {
  const sum = widths.reduce((s, w) => s + w, 0);
  if (sum <= 0) return widths.map(() => 1 / widths.length);
  return widths.map((w) => w / sum);
}
