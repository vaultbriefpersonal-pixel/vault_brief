// Minimal ambient types for `fontkit`.
//
// fontkit ships no bundled types and there is no maintained @types package for
// v2. It reaches us transitively through @react-pdf/renderer, and the only
// place we import it directly is pdf-fonts.test.ts, which asks the shipped
// font subsets which codepoints they can actually draw.
//
// Deliberately narrow: it declares the three members that test uses rather
// than `declare module "fontkit"` with an implicit `any`, so a typo in a
// member name is still a compile error. Widen it when something else needs
// more, not pre-emptively.
declare module "fontkit" {
  export interface FontkitFont {
    /** The single fact this codebase asks a font for. */
    hasGlyphForCodePoint(codePoint: number): boolean;
    readonly numGlyphs: number;
    readonly familyName: string;
    readonly subfamilyName: string;
  }

  /** Parse an in-memory font. Throws on a malformed or truncated buffer. */
  export function create(buffer: Buffer | Uint8Array): FontkitFont;
}
