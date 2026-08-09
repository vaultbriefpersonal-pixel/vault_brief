import { describe, it, expect } from "vitest";
import {
  REPORT_PDF_TEMPLATE_VERSION,
  reportPdfBlobPath,
  isCurrentTemplateBlob,
} from "./report-pdf-version";

const HOST = "https://od2fkgzuablbiifu.public.blob.vercel-storage.com";
const ID = "146251f2-8804-4635-8a71-6a2488a700fa";
const FILE = "index-coop-report-2026-07-31.pdf";

describe("reportPdfBlobPath", () => {
  it("puts the version between the report id and the filename", () => {
    expect(reportPdfBlobPath(ID, FILE)).toBe(
      `reports/${ID}/${REPORT_PDF_TEMPLATE_VERSION}/${FILE}`
    );
  });

  it("round-trips: what it writes, the staleness check calls current", () => {
    // The property that actually matters. These two must never drift — a
    // builder the checker rejects would re-render on every single request.
    expect(isCurrentTemplateBlob(`${HOST}/${reportPdfBlobPath(ID, FILE)}`)).toBe(
      true
    );
  });
});

describe("isCurrentTemplateBlob", () => {
  it("rejects the unversioned legacy path", () => {
    // The real shape of every blob written before this module existed, and the
    // exact case that let 6 reports serve Helvetica PDFs after Stage 18.
    expect(isCurrentTemplateBlob(`${HOST}/reports/${ID}/${FILE}`)).toBe(false);
  });

  it("rejects a superseded version", () => {
    expect(isCurrentTemplateBlob(`${HOST}/reports/${ID}/v1/${FILE}`)).toBe(false);
  });

  it("rejects null and empty, rather than treating absence as current", () => {
    expect(isCurrentTemplateBlob(null)).toBe(false);
    expect(isCurrentTemplateBlob(undefined)).toBe(false);
    expect(isCurrentTemplateBlob("")).toBe(false);
  });

  it("rejects a string that is not a URL", () => {
    expect(isCurrentTemplateBlob("not a url")).toBe(false);
    expect(isCurrentTemplateBlob(`reports/${ID}/v2/${FILE}`)).toBe(false);
  });

  it("does not accept the version token appearing elsewhere in the path", () => {
    // A filename carrying the token must not pass...
    expect(
      isCurrentTemplateBlob(`${HOST}/reports/${ID}/report-v2.pdf`)
    ).toBe(false);
    // ...nor a project slug that happens to contain it...
    expect(
      isCurrentTemplateBlob(`${HOST}/reports/${ID}/protocol-v2-report.pdf`)
    ).toBe(false);
    // ...nor a malformed path where the version sits where the id belongs.
    expect(isCurrentTemplateBlob(`${HOST}/reports/v2/${FILE}`)).toBe(false);
  });

  it("rejects a path with extra nesting", () => {
    expect(
      isCurrentTemplateBlob(`${HOST}/archive/reports/${ID}/v2/${FILE}`)
    ).toBe(false);
  });

  it("rejects a correctly-versioned path under the wrong root", () => {
    expect(isCurrentTemplateBlob(`${HOST}/exports/${ID}/v2/${FILE}`)).toBe(
      false
    );
  });

  it("ignores query strings and host, which vary and carry no meaning here", () => {
    expect(
      isCurrentTemplateBlob(`${HOST}/reports/${ID}/v2/${FILE}?download=1`)
    ).toBe(true);
    expect(
      isCurrentTemplateBlob(`https://example.test/reports/${ID}/v2/${FILE}`)
    ).toBe(true);
  });
});
