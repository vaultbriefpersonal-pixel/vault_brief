// Registers the report typefaces with @react-pdf, once per process.
//
// Until this module existed there was no `Font.register` call anywhere in the
// repo and no font file outside node_modules, so every PDF the product has
// ever produced was set in base-14 Helvetica and Courier. That is the single
// largest reason the output read as a printout rather than a document — and
// it is also why pdf-template.tsx:118 drew list bullets as a coloured <View>
// dot, its comment noting that "Helvetica's standard encoding doesn't carry
// `•` reliably ... and we don't want to ship a custom font just for one
// glyph."
//
// WHY THE FONTS ARE BASE64 MODULES AND NOT FILES ON DISK.
//
// The PDF renders in TWO runtimes. The Vercel Lambda serves
// /api/reports/[reportId]/pdf and the two tRPC procedures; the Trigger.dev
// worker runs auto-generate-reports.ts, which is reachable because
// trigger.config.ts declares `dirs: ["./src/server/jobs"]`. Next's
// `outputFileTracingIncludes` has no effect on the Trigger build — it has its
// own bundler and its own `additionalFiles` extension, which is exactly why
// that config already needs `build.external` for resvg.
//
// So a filesystem approach is two mechanisms, each able to fail silently, and
// the one most likely to break is the unattended cron path where the error is
// swallowed and the founder just never gets a report. A bundled module cannot
// fail that way: if the import resolved, the bytes are present. Payload is the
// only cost, and pdfkit subsets again on embed, so the PDFs themselves are
// unaffected either way.
//
// WHY `Font` COMES FROM A DYNAMIC IMPORT.
//
// pdf-generator.ts:5-12 documents that @react-pdf/renderer sits in Next 16's
// default `serverExternalPackages` and that a static require of it returns an
// empty module. pdf-template.tsx's static import of the primitives happens to
// work, so the hazard is interop-shaped and not fully characterised. Taking
// `Font` from the same dynamic import that already yields `renderToBuffer`
// keeps this module on the one path known to be safe.

import { SPECTRAL_REGULAR_B64 } from "@/assets/fonts/generated/Spectral-Regular.base64";
import { SPECTRAL_SEMIBOLD_B64 } from "@/assets/fonts/generated/Spectral-SemiBold.base64";
import { SPECTRAL_ITALIC_B64 } from "@/assets/fonts/generated/Spectral-Italic.base64";
import { PLEX_MONO_REGULAR_B64 } from "@/assets/fonts/generated/IBMPlexMono-Regular.base64";
import { PDF_SERIF, PDF_MONO } from "@/lib/report-theme";

/**
 * @react-pdf's `isDataUrl` check requires BOTH a `,` and the literal
 * `;base64` in the header before it will decode. A bare `data:font/ttf,...`
 * silently falls through to its URL branch and then to `fontkit.open`, which
 * treats the string as a filesystem path.
 */
function dataUri(b64: string): string {
  return `data:font/truetype;base64,${b64}`;
}

/** Exported so the coverage test can decode exactly what ships. */
export const REPORT_FONT_SOURCES = {
  serifRegular: SPECTRAL_REGULAR_B64,
  serifSemibold: SPECTRAL_SEMIBOLD_B64,
  serifItalic: SPECTRAL_ITALIC_B64,
  monoRegular: PLEX_MONO_REGULAR_B64,
} as const;

let registered = false;

/**
 * Idempotent. Call immediately before rendering; @react-pdf's own FontStore
 * tolerates re-registration, so the guard is a cheap short-circuit rather than
 * a correctness requirement.
 */
export async function registerReportFonts(): Promise<void> {
  if (registered) return;

  const { Font } = await import("@react-pdf/renderer");

  Font.register({
    family: PDF_SERIF,
    fonts: [
      { src: dataUri(SPECTRAL_REGULAR_B64), fontWeight: 400 },
      { src: dataUri(SPECTRAL_SEMIBOLD_B64), fontWeight: 600 },
      {
        src: dataUri(SPECTRAL_ITALIC_B64),
        fontWeight: 400,
        fontStyle: "italic",
      },
    ],
  });

  Font.register({
    family: PDF_MONO,
    fonts: [{ src: dataUri(PLEX_MONO_REGULAR_B64), fontWeight: 400 }],
  });

  // Disable hyphenation entirely.
  //
  // With base-14 fonts react-pdf's default hyphenation rarely showed; with a
  // real serif at 10pt in a narrow measure it starts breaking words — and the
  // words in this document include wallet addresses and transaction hashes.
  // A hyphen inserted mid-address is not a cosmetic problem, it makes the
  // figure wrong to anyone who copies it.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}

/** Test seam — lets a test assert the guard without a second real register. */
export function __resetReportFontsForTest(): void {
  registered = false;
}
