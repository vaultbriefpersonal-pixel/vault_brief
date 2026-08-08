import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOC_LIGHT,
  DOC_CSS_VARS,
  DEFAULT_ACCENT,
  contrastRatio,
  isHexColor,
  readableAccentOn,
  sanitizeForPdf,
  GLYPH_FALLBACKS,
} from "./report-theme";

const AA = 4.5;
const AA_LARGE = 3;

describe("DOC_LIGHT — the palette is legible on paper", () => {
  // These are the pairs that actually carry words. If one regresses, the
  // report becomes unreadable for exactly the readers who need it most.
  it("clears AA for every ink used as body text", () => {
    expect(contrastRatio(DOC_LIGHT.ink, DOC_LIGHT.paper)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(DOC_LIGHT.inkSoft, DOC_LIGHT.paper)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(DOC_LIGHT.ink, DOC_LIGHT.paperRaised)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(DOC_LIGHT.inkSoft, DOC_LIGHT.paperRaised)).toBeGreaterThanOrEqual(AA);
  });

  // Stages 12-17 exist to surface uncertainty. A light ground weakens amber
  // and red, so these were chosen darker and more saturated than a naive
  // inversion would give — an unreadable warning is a silenced warning.
  it("clears AA for every semantic status colour, on both paper tones", () => {
    for (const tone of ["ok", "warn", "danger", "info"] as const) {
      for (const bg of [DOC_LIGHT.paper, DOC_LIGHT.paperRaised] as const) {
        expect(contrastRatio(DOC_LIGHT[tone], bg), `${tone} on ${bg}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it("clears AA for each status colour on its own soft background", () => {
    const pairs = [
      [DOC_LIGHT.ok, DOC_LIGHT.okSoft],
      [DOC_LIGHT.warn, DOC_LIGHT.warnSoft],
      [DOC_LIGHT.danger, DOC_LIGHT.dangerSoft],
      [DOC_LIGHT.info, DOC_LIGHT.infoSoft],
    ] as const;
    for (const [fg, bg] of pairs) {
      expect(contrastRatio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA);
    }
  });

  // inkFaint carries small text — table headers, masthead labels, eyebrows —
  // so it must clear AA like any other ink. The reference brief's #8A8D87
  // measured 2.89:1 here, below even the 3:1 large-text floor; this test is
  // what stops that value creeping back in for looking nicer.
  it("clears AA for inkFaint, which labels are set in", () => {
    expect(contrastRatio(DOC_LIGHT.inkFaint, DOC_LIGHT.paper)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(DOC_LIGHT.inkFaint, DOC_LIGHT.paperRaised)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio("#8A8D87", DOC_LIGHT.paper)).toBeLessThan(AA_LARGE);
  });

  it("keeps the three inks visually separable, not just individually legible", () => {
    const onPaper = (c: string) => contrastRatio(c, DOC_LIGHT.paper);
    expect(onPaper(DOC_LIGHT.ink)).toBeGreaterThan(onPaper(DOC_LIGHT.inkSoft));
    expect(onPaper(DOC_LIGHT.inkSoft)).toBeGreaterThan(onPaper(DOC_LIGHT.inkFaint));
  });

  // Rules and hairlines carry no text, so they are exempt from AA — but they
  // must still be visible against the paper they sit on.
  it("keeps the decorative lines visible without pretending they are text", () => {
    expect(contrastRatio(DOC_LIGHT.line, DOC_LIGHT.paper)).toBeGreaterThan(1.05);
    expect(contrastRatio(DOC_LIGHT.lineStrong, DOC_LIGHT.paper)).toBeGreaterThan(
      contrastRatio(DOC_LIGHT.line, DOC_LIGHT.paper)
    );
  });

  it("has a CSS variable name for every colour token, and no extras", () => {
    expect(Object.keys(DOC_CSS_VARS).sort()).toEqual(Object.keys(DOC_LIGHT).sort());
    for (const name of Object.values(DOC_CSS_VARS)) {
      expect(name).toMatch(/^--doc-[a-z-]+$/);
    }
  });
});

// The palette exists twice by necessity — as TS constants (the PDF's
// StyleSheet cannot read CSS custom properties) and as the `.vb-doc` scope in
// globals.css. Nothing in the type system can hold those in agreement, so
// this reads the actual stylesheet and compares. Cheap, and it runs in CI,
// which a browser-only check would not.
describe("globals.css ↔ DOC_LIGHT parity", () => {
  const css = readFileSync(
    join(process.cwd(), "src/app/globals.css"),
    "utf8"
  );

  const vbDocBlock = (): string => {
    const start = css.indexOf(".vb-doc {");
    expect(start, "`.vb-doc` scope missing from globals.css").toBeGreaterThan(-1);
    const end = css.indexOf("\n}", start);
    return css.slice(start, end);
  };

  const declared = (block: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      out.set(m[1], m[2].trim().toLowerCase());
    }
    return out;
  };

  it("defines every document token in the .vb-doc scope", () => {
    const vars = declared(vbDocBlock());
    for (const [token, cssName] of Object.entries(DOC_CSS_VARS)) {
      expect(vars.has(cssName), `${cssName} (${token}) missing from .vb-doc`).toBe(true);
    }
  });

  it("uses the same value in CSS as in TypeScript for every token", () => {
    const vars = declared(vbDocBlock());
    for (const [token, cssName] of Object.entries(DOC_CSS_VARS)) {
      const expected = DOC_LIGHT[token as keyof typeof DOC_LIGHT]
        .toLowerCase()
        .replace(/\s+/g, " ");
      const actual = (vars.get(cssName) ?? "").replace(/\s+/g, " ");
      expect(actual, `${cssName} drifted from DOC_LIGHT.${token}`).toBe(expected);
    }
  });

  // The alias block is what re-themes ReportWidgets with no per-component
  // edits. If --vb-bg stopped pointing at the RAISED tone, every tile would
  // render as a hole punched in the page — see the depth-inversion note.
  it("keeps the --vb-* compatibility aliases, with depth inverted", () => {
    const vars = declared(vbDocBlock());
    expect(vars.get("--vb-bg")).toBe("var(--doc-raised)");
    expect(vars.get("--vb-card")).toBe("var(--doc-raised)");
    expect(vars.get("--vb-alt")).toBe("var(--doc-paper)");
    expect(vars.get("--vb-text")).toBe("var(--doc-ink)");
    expect(vars.get("--vb-muted")).toBe("var(--doc-ink-soft)");
    expect(vars.get("--vb-dim")).toBe("var(--doc-ink-faint)");
    expect(vars.get("--vb-border")).toBe("var(--doc-line)");
  });

  // Dark values must exist too, or a report component referencing a --doc-*
  // token would resolve to nothing on the dashboard.
  it("also defines the document tokens at :root, so the dashboard is unaffected", () => {
    const rootStart = css.indexOf(":root {");
    const rootBlock = css.slice(rootStart, css.indexOf("\n}", rootStart));
    const vars = declared(rootBlock);
    for (const cssName of Object.values(DOC_CSS_VARS)) {
      expect(vars.has(cssName), `${cssName} missing from :root`).toBe(true);
    }
    for (const extra of ["--doc-series-2", "--doc-series-3", "--doc-accent", "--doc-accent-ink"]) {
      expect(vars.has(extra), `${extra} missing from :root`).toBe(true);
    }
  });
});

describe("contrastRatio", () => {
  it("returns 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#1C2024", "#1C2024")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#00e87b", "#EDEEEA")).toBeCloseTo(
      contrastRatio("#EDEEEA", "#00e87b"),
      6
    );
  });

  it("expands 3-digit hex", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 1);
  });

  // Callers treat a low ratio as "needs darkening", so unparseable input must
  // fail toward doing something rather than toward silently passing.
  it("returns 1 for unparseable input", () => {
    expect(contrastRatio("not-a-color", "#ffffff")).toBe(1);
    expect(contrastRatio("#ffffff", "rgb(0,0,0)")).toBe(1);
  });
});

describe("isHexColor", () => {
  it("accepts 3- and 6-digit hex, with surrounding whitespace", () => {
    for (const v of ["#fff", "#FFF", "#00e87b", "#00E87B", "  #1C2024  "]) {
      expect(isHexColor(v), v).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const v of [
      "00e87b",
      "#gggggg",
      "#1234",
      "#12345",
      "rgb(0,0,0)",
      "",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isHexColor(v), String(v)).toBe(false);
    }
  });
});

describe("readableAccentOn", () => {
  // The reason this module owns logic and not just constants. The product's
  // own default accent is ~1.5:1 on paper — invisible as text.
  it("rescues the product's own accent, which is unreadable on paper untouched", () => {
    expect(contrastRatio("#00e87b", DOC_LIGHT.paper)).toBeLessThan(2);
    const fixed = readableAccentOn("#00e87b", DOC_LIGHT.paper);
    expect(contrastRatio(fixed, DOC_LIGHT.paper)).toBeGreaterThanOrEqual(AA);
  });

  it("clears the threshold for a spread of real brand colours", () => {
    for (const accent of [
      "#00e87b",
      "#6366F1",
      "#f59e0b",
      "#ffffff",
      "#fefefe",
      "#e5e5e5",
      "#1F4B5F",
      "#ff0000",
    ]) {
      const fixed = readableAccentOn(accent, DOC_LIGHT.paper);
      expect(
        contrastRatio(fixed, DOC_LIGHT.paper),
        `${accent} -> ${fixed}`
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it("leaves an already-readable accent untouched", () => {
    expect(readableAccentOn(DEFAULT_ACCENT, DOC_LIGHT.paper)).toBe(
      DEFAULT_ACCENT.toLowerCase()
    );
  });

  it("preserves hue while darkening — green stays green", () => {
    const fixed = readableAccentOn("#00e87b", DOC_LIGHT.paper);
    const r = parseInt(fixed.slice(1, 3), 16);
    const g = parseInt(fixed.slice(3, 5), 16);
    const b = parseInt(fixed.slice(5, 7), 16);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("falls back to the default accent for unparseable input", () => {
    for (const junk of ["", "not-a-color", "rgb(1,2,3)"]) {
      const out = readableAccentOn(junk, DOC_LIGHT.paper);
      expect(contrastRatio(out, DOC_LIGHT.paper)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("lightens instead of darkening when the background is dark", () => {
    const fixed = readableAccentOn("#1F4B5F", "#0a0a0a");
    expect(contrastRatio(fixed, "#0a0a0a")).toBeGreaterThanOrEqual(AA);
  });

  it("honours a custom minimum", () => {
    const strict = readableAccentOn("#00e87b", DOC_LIGHT.paper, 7);
    expect(contrastRatio(strict, DOC_LIGHT.paper)).toBeGreaterThanOrEqual(7);
  });
});

describe("sanitizeForPdf", () => {
  it("maps every fallback glyph to an ASCII stand-in", () => {
    for (const [from, to] of GLYPH_FALLBACKS) {
      expect(sanitizeForPdf(`a${from}b`), from).toBe(`a${to}b`);
    }
  });

  // The old strip covered pictographs only, so these reached a font that
  // could not encode them and printed as blank boxes.
  it("converts the arrows and ticks the old pictograph-only strip let through", () => {
    expect(sanitizeForPdf("spend -> up")).toBe("spend -> up");
    expect(sanitizeForPdf("runway → 4 months")).toBe("runway -> 4 months");
    expect(sanitizeForPdf("done ✓")).toBe("done +");
  });

  it("drops emoji rather than emitting an unresolvable codepoint", () => {
    expect(sanitizeForPdf("great \u{1F680} news")).toBe("great news");
    expect(sanitizeForPdf("\u{1F4B0}")).toBe("");
  });

  it("keeps accented Latin so contributor names survive", () => {
    expect(sanitizeForPdf("José Muñoz")).toBe("José Muñoz");
    expect(sanitizeForPdf("Škoda")).toBe("Škoda");
  });

  it("keeps the typographic punctuation the subset carries", () => {
    const s = "‘a’ “b” – — • … €5";
    expect(sanitizeForPdf(s)).toBe(s);
  });

  it("leaves ordinary financial prose byte-identical", () => {
    const s = "Total: $1,234.56 (61%) across 4 wallets [see note].";
    expect(sanitizeForPdf(s)).toBe(s);
  });

  it("does not leave a double space where a glyph was removed", () => {
    expect(sanitizeForPdf("a \u{1F680} b")).toBe("a b");
  });

  it("preserves newlines and tabs", () => {
    expect(sanitizeForPdf("a\nb\tc")).toBe("a\nb\tc");
  });

  it("handles an empty string", () => {
    expect(sanitizeForPdf("")).toBe("");
  });
});
