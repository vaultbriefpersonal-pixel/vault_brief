import { task } from "@trigger.dev/sdk/v3";
import React from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { PDF_SERIF, PDF_MONO } from "@/lib/report-theme";
import { registerReportFonts } from "@/server/services/pdf-fonts";

/**
 * Proves the report fonts load in the TRIGGER WORKER, not just the Lambda.
 *
 * WHY THIS EXISTS. PDFs render in two runtimes: the Vercel Lambda behind
 * `/api/reports/[id]/pdf`, and this worker, via `auto-generate-reports` ->
 * `renderAndStorePDF`. Stage 18.3 shipped the faces as committed base64 TS
 * modules specifically so the worker's own bundler could not lose them the way
 * a filesystem path would — but "the build succeeded" is not the same claim as
 * "the bytes decode and pdfkit embeds them", and the failure mode is silent:
 * `auto-generate-reports` swallows a PDF error and emails the founder anyway.
 *
 * The obvious way to test that path is to run `auto-generate-reports`. It does
 * not work: that job skips any project whose latest snapshot already has a
 * report, and on 2026-08-09 that was all 8 of them, so it returns
 * `generated: 0` without ever reaching the renderer. Making it eligible means
 * deleting a real report or manufacturing a snapshot — production damage in
 * exchange for a test.
 *
 * So this task exercises the same two calls the real path makes —
 * `registerReportFonts()` then `renderToBuffer` — against a throwaway document
 * that uses BOTH families. It reads nothing, writes nothing, and sends
 * nothing; the only output is its return value.
 *
 * Run it from the Trigger dashboard after any deploy that touches fonts,
 * `pdf-generator.ts`, or the build config.
 *
 * A PASS means every family in `expected` also appears in `embedded`. Helvetica
 * turning up is the exact regression this guards: it is what pdfkit falls back
 * to when a registered family cannot be resolved, and it is what every report
 * rendered before Stage 18.3.
 */
export const verifyReportFontsJob = task({
  id: "verify-report-fonts",
  run: async () => {
    await registerReportFonts();

    // Same dynamic import as pdf-generator.ts: @react-pdf/renderer is ESM-only
    // and a static require resolves to an empty module under Next 16's
    // serverExternalPackages. Kept identical so this tests the real path.
    const { renderToBuffer, Document, Page, Text, View } = await import(
      "@react-pdf/renderer"
    );

    // Both families must actually be USED — pdfkit only embeds a face it draws
    // glyphs with, so a document that merely declares them would pass while a
    // broken font sat unnoticed.
    const doc = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4" },
        React.createElement(
          View,
          null,
          React.createElement(
            Text,
            { style: { fontFamily: PDF_SERIF, fontWeight: 400 } },
            "Serif regular 0123456789"
          ),
          React.createElement(
            Text,
            { style: { fontFamily: PDF_SERIF, fontWeight: 600 } },
            "Serif semibold 0123456789"
          ),
          React.createElement(
            Text,
            { style: { fontFamily: PDF_MONO } },
            "Mono 0x1C2024 $834.3K"
          )
        )
      )
    );

    const buffer = await renderToBuffer(
      doc as React.ReactElement<DocumentProps>
    );

    // latin1 keeps byte offsets intact; font names are ASCII inside the object
    // graph. Subset tags look like `ABCDEF+Spectral-Regular`.
    const text = buffer.toString("latin1");
    const embedded = [
      ...new Set(
        (text.match(/\/BaseFont\s*\/[A-Za-z0-9+,\-]+/g) ?? []).map((m) =>
          m.split("/").pop()
        )
      ),
    ];

    // NOT `PDF_SERIF`/`PDF_MONO`. Those are the aliases we register the
    // families under (`VBSerif`/`VBMono`); pdfkit embeds each face under the
    // PostScript name baked into the font file, prefixed with a random subset
    // tag — `OGJNQQ+Spectral-Regular`. Asserting on the alias would look
    // rigorous and fail on a perfectly good PDF.
    const expected = ["Spectral", "IBMPlexMono"];
    const missing = expected.filter(
      (face) => !embedded.some((name) => name?.includes(face))
    );
    const fellBackToHelvetica = embedded.some((n) => n?.includes("Helvetica"));

    const result = {
      runtime: "trigger-worker",
      passed: missing.length === 0 && !fellBackToHelvetica,
      expected,
      embedded,
      missing,
      fellBackToHelvetica,
      bytes: buffer.length,
    };

    console.log("verify-report-fonts:", JSON.stringify(result, null, 2));
    return result;
  },
});
