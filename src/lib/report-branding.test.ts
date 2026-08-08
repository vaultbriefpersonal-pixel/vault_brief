import { describe, it, expect } from "vitest";
import { brandingFor } from "./report-branding";
import { DEFAULT_ACCENT, isHexColor } from "./report-theme";

describe("brandingFor", () => {
  it("reads a well-formed customBranding object", () => {
    expect(
      brandingFor({
        customBranding: { primaryColor: "#1F4B5F", logoUrl: "https://cdn.io/l.png" },
      })
    ).toEqual({ primaryColor: "#1f4b5f", logoUrl: "https://cdn.io/l.png" });
  });

  // The whole reason this module exists: three call sites disagreed about the
  // default, so an unbranded project rendered green on the web and indigo in
  // email for the same report.
  it("returns ONE default for a project with no branding", () => {
    for (const project of [
      {},
      { customBranding: null },
      { customBranding: undefined },
      { customBranding: {} },
    ]) {
      expect(brandingFor(project).primaryColor).toBe(DEFAULT_ACCENT);
    }
    expect(brandingFor(null).primaryColor).toBe(DEFAULT_ACCENT);
    expect(brandingFor(undefined).primaryColor).toBe(DEFAULT_ACCENT);
  });

  // `primaryColor` was validated as a bare z.string() until this stage, so
  // rows already in the database may hold anything at all. Whatever comes
  // back is interpolated straight into a CSS property and a PDF style.
  it("never returns a colour that could break a render", () => {
    for (const bad of [
      "red",
      "rgb(0,0,0)",
      "",
      "   ",
      "#ggg",
      "#12345",
      "}; body { display: none }",
      "javascript:alert(1)",
      42,
      true,
      null,
      {},
      [],
    ]) {
      const out = brandingFor({ customBranding: { primaryColor: bad } });
      expect(isHexColor(out.primaryColor), String(bad)).toBe(true);
      expect(out.primaryColor).toBe(DEFAULT_ACCENT);
    }
  });

  it("accepts 3-digit hex and normalises case", () => {
    expect(brandingFor({ customBranding: { primaryColor: "#ABC" } }).primaryColor).toBe("#abc");
  });

  it("survives customBranding being a non-object", () => {
    for (const junk of ["a string", 7, true, []]) {
      const out = brandingFor({ customBranding: junk });
      expect(out.primaryColor).toBe(DEFAULT_ACCENT);
    }
  });

  describe("logo precedence", () => {
    it("prefers customBranding.logoUrl over the legacy column", () => {
      expect(
        brandingFor({
          customBranding: { logoUrl: "https://cdn.io/new.png" },
          logoUrl: "https://cdn.io/legacy.png",
        }).logoUrl
      ).toBe("https://cdn.io/new.png");
    });

    it("falls back to the legacy column when the JSONB has no logo", () => {
      expect(
        brandingFor({ customBranding: {}, logoUrl: "https://cdn.io/legacy.png" }).logoUrl
      ).toBe("https://cdn.io/legacy.png");
    });

    it("returns null rather than an empty string when there is no logo", () => {
      for (const project of [
        {},
        { logoUrl: "" },
        { logoUrl: "   " },
        { logoUrl: null },
        { customBranding: { logoUrl: "" }, logoUrl: null },
      ]) {
        expect(brandingFor(project).logoUrl).toBeNull();
      }
    });

    it("trims surrounding whitespace", () => {
      expect(brandingFor({ logoUrl: "  https://cdn.io/l.png  " }).logoUrl).toBe(
        "https://cdn.io/l.png"
      );
    });
  });
});
