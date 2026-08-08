import { describe, it, expect } from "vitest";
// Named import, not default: fontkit 2.x is ESM and exposes `create` as a
// named export. The default import resolves to undefined under vitest.
import { create as createFont } from "fontkit";
import { REPORT_FONT_SOURCES } from "./pdf-fonts";
import {
  PDF_SAFE_EXTRA,
  GLYPH_FALLBACKS,
  sanitizeForPdf,
} from "@/lib/report-theme";

// Decodes the ACTUAL committed base64 and asks the actual font whether it can
// draw each character. That makes this the one test in the stage that can
// falsify a claim about the shipped artifact rather than about our intentions:
// it catches a bad subset, a wrong or corrupted file, a charset edit that
// dropped something the sanitizer still passes through, and a fallback table
// that has gone stale.
//
// It also has history. The planning assumption was that a Latin text face
// carries no arrows or ticks and that `→ ✓ ★` would all need ASCII
// substitutes. Probing the real fonts showed only `★` is missing — the arrows,
// the tick and the maths comparators are all present — which shrank the
// fallback table and kept output the fonts render perfectly well.

type Face = keyof typeof REPORT_FONT_SOURCES;

const FACES = Object.keys(REPORT_FONT_SOURCES) as Face[];

const loaded = new Map<Face, ReturnType<typeof createFont>>();
function font(face: Face) {
  let f = loaded.get(face);
  if (!f) {
    f = createFont(Buffer.from(REPORT_FONT_SOURCES[face], "base64"));
    loaded.set(face, f);
  }
  return f;
}

function has(face: Face, cp: number): boolean {
  return font(face).hasGlyphForCodePoint(cp);
}

describe("the shipped font subsets decode at all", () => {
  it.each(FACES)("%s is valid, non-empty TrueType", (face) => {
    const bytes = Buffer.from(REPORT_FONT_SOURCES[face], "base64");
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(() => font(face)).not.toThrow();
    expect(font(face).numGlyphs).toBeGreaterThan(100);
  });

  // These are full faces, not subsets — see the header of
  // scripts/build-report-fonts.mjs for why subsetting was tried and backed
  // out. The ceiling guards against someone swapping in a variable font or a
  // CJK-bearing face, either of which would balloon both server bundles.
  it.each(FACES)("%s stays within its size budget", (face) => {
    const kb = Buffer.from(REPORT_FONT_SOURCES[face], "base64").length / 1024;
    expect(kb).toBeLessThan(400);
  });
});

describe("glyph coverage — every character the sanitizer permits", () => {
  const ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i);

  it.each(FACES)("%s covers printable ASCII", (face) => {
    const missing = ASCII.filter((cp) => !has(face, cp)).map((cp) =>
      String.fromCodePoint(cp)
    );
    expect(missing).toEqual([]);
  });

  // Accented contributor names are the realistic case here: a report listing
  // "José Muñoz" must not print boxes.
  it.each(FACES)("%s covers the Latin-1 letters used in names", (face) => {
    const sample = "áéíóúàèìòùâêîôûäëïöüãñõçåøœæßšžŠŽÁÉÍÓÚÑÇ";
    const missing = [...sample].filter(
      (ch) => !has(face, ch.codePointAt(0)!)
    );
    expect(missing).toEqual([]);
  });

  // The load-bearing one. PDF_SAFE_EXTRA is what sanitizeForPdf lets through
  // above Latin Extended-A; if the subset charset in
  // scripts/build-report-fonts.mjs ever stops matching it, this fails.
  it.each(FACES)("%s covers every codepoint in PDF_SAFE_EXTRA", (face) => {
    const missing = PDF_SAFE_EXTRA.filter((cp) => !has(face, cp)).map(
      (cp) => `U+${cp.toString(16).toUpperCase()} ${String.fromCodePoint(cp)}`
    );
    expect(missing).toEqual([]);
  });
});

describe("GLYPH_FALLBACKS is not stale", () => {
  // The inverse assertion, and the reason the table can be trusted. Every
  // mapped character must be genuinely undrawable by at least one face —
  // otherwise we are degrading output the fonts could have rendered.
  it("only maps characters at least one shipped face cannot draw", () => {
    for (const [from] of GLYPH_FALLBACKS) {
      const cp = from.codePointAt(0)!;
      const facesWithGlyph = FACES.filter((f) => has(f, cp));
      expect(
        facesWithGlyph.length,
        `${from} (U+${cp.toString(16).toUpperCase()}) is present in all four faces — remove it from GLYPH_FALLBACKS`
      ).toBeLessThan(FACES.length);
    }
  });

  it("maps to replacements the fonts can actually draw", () => {
    for (const [from, to] of GLYPH_FALLBACKS) {
      for (const ch of to) {
        for (const face of FACES) {
          expect(
            has(face, ch.codePointAt(0)!),
            `${from} -> "${to}" but ${face} cannot draw "${ch}"`
          ).toBe(true);
        }
      }
    }
  });

  it("leaves nothing undrawable after sanitizing realistic report prose", () => {
    const prose = [
      "Treasury held $2,413,417 across 4 wallets — up 12% ≈ $258K.",
      "Runway → 2.8 months at the trailing burn of $231,700/mo.",
      "Milestone reconciled ✓; two remain ✗ and one is ★ blocked.",
      "Contributors: José Muñoz, Šimon Novák. Fees ±2%, cover ≥80%.",
      "Sent 🚀 to 0xcC7d34C76A9d08aa0109F7Bae35f29C1CE35355A “as agreed”.",
    ].join("\n");

    for (const ch of sanitizeForPdf(prose)) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x0a || cp === 0x0d || cp === 0x09) continue;
      for (const face of FACES) {
        expect(
          has(face, cp),
          `${face} cannot draw U+${cp.toString(16).toUpperCase()} (${ch}) after sanitizing`
        ).toBe(true);
      }
    }
  });
});
