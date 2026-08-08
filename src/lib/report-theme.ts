// The report document's palette and the colour logic that keeps it legible.
//
// Two consumers that cannot share a stylesheet: the web surfaces read these
// through the `.vb-doc` CSS-variable scope in globals.css, and the PDF reads
// them directly — @react-pdf's StyleSheet has no access to CSS custom
// properties, so the values must exist as TypeScript constants or they would
// have to be duplicated by hand and drift.
//
// Values are lifted verbatim from the treasury brief the founder approved.
// The ink ramp clears AA on paper (#1C2024 ≈ 13.9:1, #565B57 ≈ 6.4:1); the
// faint grey is ≈3.2:1 and is therefore decorative-only — rules, eyebrows,
// disabled captions — never body text.
//
// This module owns LOGIC, not just constants, for one reason: the default
// project accent (#00e87b) is ≈1.5:1 on #EDEEEA. Painted as text on paper it
// is invisible. `readableAccentOn` is what lets a project keep its brand
// colour for fills while its links and rules stay readable.

export const DOC_LIGHT = {
  paper: "#EDEEEA",
  paperRaised: "#F7F7F4",
  line: "#D8D9D2",
  lineStrong: "#B9BBB3",
  ink: "#1C2024",
  inkSoft: "#565B57",
  // Darkened from the reference brief's #8A8D87, which measured 2.89:1 on
  // paper — below even the 3:1 large-text floor. It is a TEXT token (table
  // headers, masthead labels, eyebrows), so it has to clear AA; `line` and
  // `lineStrong` below are the decorative non-text greys.
  inkFaint: "#686A65",
  ok: "#3F6B4F",
  okSoft: "#E7EFE8",
  warn: "#8A5D1F",
  warnSoft: "#F3EAD9",
  danger: "#9C3B2E",
  dangerSoft: "#F5E5E1",
  info: "#1F4B5F",
  infoSoft: "#E4EBEC",
  track: "rgba(28, 32, 36, 0.08)",
} as const;

export type DocColorToken = keyof typeof DOC_LIGHT;

/**
 * The single default accent.
 *
 * Replaces three conflicting ones for the same field: `#6366F1` in the project
 * settings form and the email layout, `#00e87b` on both web report pages. A
 * founder who never touched the picker got green on the web and indigo in the
 * email for the same report.
 */
export const DEFAULT_ACCENT = "#1F4B5F";

/** Font family names registered with @react-pdf. Kept here so pdf-template
 *  never needs to import the font module or the `Font` object itself. */
export const PDF_SERIF = "VBSerif";
export const PDF_MONO = "VBMono";

/** CSS custom-property name for each palette token. The `.vb-doc` scope in
 *  globals.css must define exactly these; a test asserts the key sets match,
 *  which is as close to CSS↔TS typechecking as is achievable here. */
export const DOC_CSS_VARS: Record<DocColorToken, string> = {
  paper: "--doc-paper",
  paperRaised: "--doc-raised",
  line: "--doc-line",
  lineStrong: "--doc-line-strong",
  ink: "--doc-ink",
  inkSoft: "--doc-ink-soft",
  inkFaint: "--doc-ink-faint",
  ok: "--doc-ok",
  okSoft: "--doc-ok-soft",
  warn: "--doc-warn",
  warnSoft: "--doc-warn-soft",
  danger: "--doc-danger",
  dangerSoft: "--doc-danger-soft",
  info: "--doc-info",
  infoSoft: "--doc-info-soft",
  track: "--doc-track",
};

// ─── colour maths ──────────────────────────────────────────────────────────

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function toRgb(hex: string): Rgb | null {
  if (!isHexColor(hex)) return null;
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** WCAG 2.1 relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio, 1..21. Returns 1 for unparseable input — the safe
 * direction, since callers treat a low ratio as "needs darkening".
 */
export function contrastRatio(a: string, b: string): number {
  const ca = toRgb(a);
  const cb = toRgb(b);
  if (!ca || !cb) return 1;
  const la = luminance(ca);
  const lb = luminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Darken (or lighten) a brand accent until it is readable as TEXT on `bg`.
 *
 * Walks the colour toward the far end of the lightness range in small steps,
 * preserving hue, and stops at the first step clearing `min`. Falls back to
 * DEFAULT_ACCENT for unparseable input, and to plain ink if even black cannot
 * clear the threshold (only reachable on a near-black background).
 *
 * Only ever applied to text-role usage — links, section rules, headings.
 * Fills keep the raw accent, so a project's brand stays visibly present on
 * bars, dots and the header border. That asymmetry is deliberate: a founder
 * who set `#00e87b` should still recognise their report.
 */
export function readableAccentOn(
  accent: string,
  bg: string,
  min = 4.5
): string {
  if (!isHexColor(accent)) return readableAccentOn(DEFAULT_ACCENT, bg, min);
  if (contrastRatio(accent, bg) >= min) return accent.trim().toLowerCase();

  const rgb = toRgb(accent)!;
  const bgRgb = toRgb(bg);
  // On an unreadable background, darkening is the better guess: report paper
  // is light in every configuration this product ships.
  const towardBlack = bgRgb ? luminance(bgRgb) > 0.18 : true;

  const STEPS = 24;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const scaled: Rgb = towardBlack
      ? { r: rgb.r * (1 - t), g: rgb.g * (1 - t), b: rgb.b * (1 - t) }
      : {
          r: rgb.r + (255 - rgb.r) * t,
          g: rgb.g + (255 - rgb.g) * t,
          b: rgb.b + (255 - rgb.b) * t,
        };
    const candidate = toHex(scaled);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }

  return towardBlack ? DOC_LIGHT.ink : DOC_LIGHT.paper;
}

// ─── PDF glyph safety ──────────────────────────────────────────────────────

/**
 * Characters the report fonts cannot draw, and what to draw instead.
 *
 * Registering a real typeface does NOT make these safe — Spectral and IBM Plex
 * Mono are Latin text faces, so arrows, ticks and stars are as absent from
 * them as they were from Helvetica. What changes is that the set is now
 * *verifiable*: `pdf-fonts.test.ts` asserts every key here is genuinely
 * missing from the shipped subset, so this table cannot quietly go stale.
 *
 * Replaces a blind `U+1F300–U+1FAFF` strip that covered pictographs only and
 * let `→` and `✓` — squarely in the range a model actually emits — through to
 * a font that could not encode them.
 */
export const GLYPH_FALLBACKS: ReadonlyArray<readonly [string, string]> = [
  ["→", "->"],
  ["←", "<-"],
  ["↑", "^"],
  ["↓", "v"],
  ["⇒", "=>"],
  ["✓", "+"],
  ["✔", "+"],
  ["✗", "x"],
  ["✘", "x"],
  ["★", "*"],
  ["☆", "*"],
  ["▲", "^"],
  ["▼", "v"],
  ["●", "*"],
  ["■", "*"],
  ["≥", ">="],
  ["≤", "<="],
  ["≠", "!="],
];

/**
 * Everything the embedded subset can draw, as an inverted class.
 *
 * Written with \u escapes rather than literal glyphs on purpose: a character
 * class full of dashes, curly quotes and accented letters is invisible to
 * review, survives editors and diffs poorly, and is exactly the kind of source
 * line that silently mutates when a file is re-encoded.
 *
 * Ranges: tab/LF/CR, printable ASCII, Latin-1 Supplement and Latin Extended-A
 * (accented contributor names), plus the individual General Punctuation marks
 * the subset carries — en/em dash, curly quotes, bullet, ellipsis, euro.
 */
const PDF_SAFE_STRIP_RE =
  /[^\t\n\r\u0020-\u007E\u00A0-\u017F\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/gu;

/**
 * Make a string safe to draw with the embedded PDF fonts.
 *
 * Applies the fallback table, then strips anything still outside the covered
 * set — emoji included — rather than emitting a codepoint the font cannot
 * resolve, which renders as a blank box in the investor's PDF. Whitespace is
 * normalised afterwards so a stripped pictograph does not leave a double space
 * mid-sentence.
 */
export function sanitizeForPdf(input: string): string {
  let out = input;
  for (const [from, to] of GLYPH_FALLBACKS) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  out = out.replace(PDF_SAFE_STRIP_RE, "");
  return out.replace(/[ \t]{2,}/g, " ");
}
