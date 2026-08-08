import { describe, it, expect } from "vitest";
import {
  upsertFounderNoteSection,
  normalizeForExport,
  extractMarkdownSection,
  deriveExecutiveSummary,
} from "./report-markdown";
import { REPORT_DISCLAIMER } from "./report-disclaimer";

/**
 * `reports.founder_notes` (B7) was written by ReportEditor.tsx from day one
 * and read by nothing — a private scratchpad with no publish path. This
 * module is the explicit, one-click publish path a founder triggers on
 * purpose, and it must be exact: it edits a document that may already have
 * been sent to investors, so "close enough" markdown surgery isn't good
 * enough. These tests lock the four properties the plan calls out —
 * idempotent, replaces in place, removes cleanly, preserves everything else
 * byte-for-byte — plus the edge cases that a line-based approach can get
 * subtly wrong (empty doc, whitespace-only notes, internal blank lines).
 */

const DOC_WITH_SECTIONS =
  "# Title\n\n## Current Treasury\n\nSome text.\n\n## Looking Ahead\n\nMore text.\n";

describe("upsertFounderNoteSection — idempotency", () => {
  it("gives the same string on a second call with the same inputs, appending fresh", () => {
    const once = upsertFounderNoteSection(DOC_WITH_SECTIONS, "Runway is tight this month.");
    const twice = upsertFounderNoteSection(once, "Runway is tight this month.");
    expect(twice).toBe(once);
  });

  it("stays idempotent when the notes contain internal blank lines", () => {
    const notes = "Paragraph one.\n\nParagraph two.";
    const once = upsertFounderNoteSection(DOC_WITH_SECTIONS, notes);
    const twice = upsertFounderNoteSection(once, notes);
    expect(twice).toBe(once);
  });

  it("removing twice in a row is also a no-op the second time", () => {
    const withNote = upsertFounderNoteSection(DOC_WITH_SECTIONS, "temp note");
    const removedOnce = upsertFounderNoteSection(withNote, "");
    const removedTwice = upsertFounderNoteSection(removedOnce, "");
    expect(removedTwice).toBe(removedOnce);
  });
});

describe("upsertFounderNoteSection — replace in place", () => {
  it("replaces the body without duplicating the heading", () => {
    const withOld = upsertFounderNoteSection(DOC_WITH_SECTIONS, "Old note text.");
    const withNew = upsertFounderNoteSection(withOld, "New note text.");

    const headingCount = (withNew.match(/^## Founder's note$/gm) ?? []).length;
    expect(headingCount).toBe(1);
    expect(withNew).toContain("New note text.");
    expect(withNew).not.toContain("Old note text.");
  });

  it("history doesn't leak through — replacing equals a single call with the final notes from the ORIGINAL doc", () => {
    const viaReplace = upsertFounderNoteSection(
      upsertFounderNoteSection(DOC_WITH_SECTIONS, "Old note text."),
      "New note text."
    );
    const direct = upsertFounderNoteSection(DOC_WITH_SECTIONS, "New note text.");
    expect(viaReplace).toBe(direct);
  });
});

describe("upsertFounderNoteSection — removal on empty notes", () => {
  it("removes an existing section down to nothing when notes are emptied", () => {
    const withNote = upsertFounderNoteSection(DOC_WITH_SECTIONS, "Some context for investors.");
    expect(withNote).toContain("## Founder's note");

    const removed = upsertFounderNoteSection(withNote, "");
    expect(removed).not.toContain("## Founder's note");
    expect(removed).not.toContain("Some context for investors.");
    // Modulo whitespace-normalization, we're back to the original document.
    expect(removed).toBe(DOC_WITH_SECTIONS);
  });

  it("is a literal no-op — returns the exact same string instance's value — when there is no section to remove", () => {
    expect(upsertFounderNoteSection(DOC_WITH_SECTIONS, "")).toBe(DOC_WITH_SECTIONS);
    expect(upsertFounderNoteSection(DOC_WITH_SECTIONS, "   \n  ")).toBe(DOC_WITH_SECTIONS);
  });
});

describe("upsertFounderNoteSection — preserves surrounding headings", () => {
  it("appends at the end, leaving every existing heading and body byte-unchanged, when no section exists yet", () => {
    const result = upsertFounderNoteSection(DOC_WITH_SECTIONS, "A fresh note.");

    expect(result).toContain("## Current Treasury\n\nSome text.");
    expect(result).toContain("## Looking Ahead\n\nMore text.");
    // The new section must land after both existing sections, not between them.
    const treasuryIdx = result.indexOf("## Current Treasury");
    const aheadIdx = result.indexOf("## Looking Ahead");
    const founderIdx = result.indexOf("## Founder's note");
    expect(treasuryIdx).toBeLessThan(aheadIdx);
    expect(aheadIdx).toBeLessThan(founderIdx);
    expect(result).toContain("## Founder's note\n\nA fresh note.\n");
  });

  it("replaces exactly in place when a section already exists, leaving surrounding sections untouched", () => {
    const withNote = upsertFounderNoteSection(DOC_WITH_SECTIONS, "First note.");
    const founderIdxBefore = withNote.indexOf("## Founder's note");
    // Section currently sits after "Looking Ahead" (it was appended). Replace it.
    const updated = upsertFounderNoteSection(withNote, "Second note.");

    expect(updated).toContain("## Current Treasury\n\nSome text.");
    expect(updated).toContain("## Looking Ahead\n\nMore text.");
    expect(updated.indexOf("## Founder's note")).toBe(founderIdxBefore);
    expect(updated).toContain("## Founder's note\n\nSecond note.\n");
  });
});

describe("upsertFounderNoteSection — edge cases", () => {
  it("inserts cleanly into an empty document with no stray leading blank lines", () => {
    const result = upsertFounderNoteSection("", "First words in the report.");
    expect(result).toBe("## Founder's note\n\nFirst words in the report.\n");
  });

  it("trims leading/trailing whitespace off the notes before inserting", () => {
    const result = upsertFounderNoteSection(DOC_WITH_SECTIONS, "  \n  Padded note.  \n\n  ");
    expect(result).toContain("## Founder's note\n\nPadded note.\n");
    expect(result).not.toMatch(/Founder's note\n\n\s+Padded/);
  });

  it("keeps exactly one internal blank line in multi-paragraph notes — normalize must not eat it", () => {
    const notes = "First paragraph.\n\nSecond paragraph.";
    const result = upsertFounderNoteSection(DOC_WITH_SECTIONS, notes);

    // The section body must contain the two paragraphs separated by exactly
    // one blank line (two consecutive "\n\n", not collapsed, not expanded).
    expect(result).toContain(
      "## Founder's note\n\nFirst paragraph.\n\nSecond paragraph.\n"
    );
    // And normalize's 3+-newline collapse must not have fired anywhere near it.
    expect(result).not.toMatch(/First paragraph\.\n{3,}Second paragraph\./);
  });
});

/**
 * `normalizeForExport` is the fourth surface `REPORT_DISCLAIMER` reaches
 * (after PDF, the public report page, and the investor email footer) — a
 * founder copying or downloading a report shouldn't get real treasury
 * figures with no disclaimer, unlike every other output. The negative case
 * (inequality prose passing through untouched) is the most important test
 * here: it's the whole justification for requiring a leading letter in the
 * HTML-tag regex rather than matching any bare `<`/`>`.
 */
describe("normalizeForExport — disclaimer", () => {
  it("appends the disclaimer exactly once, verbatim, behind exactly one '---'", () => {
    const result = normalizeForExport("# Report\n\nSome body text.");

    const disclaimerCount = result.split(REPORT_DISCLAIMER).length - 1;
    expect(disclaimerCount).toBe(1);

    const hrCount = (result.match(/^---$/gm) ?? []).length;
    expect(hrCount).toBe(1);

    expect(result).toContain(`---\n\n${REPORT_DISCLAIMER}`);
  });
});

describe("normalizeForExport — whitespace determinism", () => {
  it("collapses irregular whitespace and ends in exactly one trailing newline, even after the disclaimer append", () => {
    const messy = "# Report\n\n\n\nBody line one.\n\n\n\nBody line two.   \n";
    const result = normalizeForExport(messy);

    expect(result).not.toMatch(/\n{3,}/);
    expect(result.endsWith("\n")).toBe(true);
    expect(result.endsWith("\n\n")).toBe(false);
    expect(result).toContain("Body line one.\n\nBody line two.");
  });
});

describe("normalizeForExport — HTML-tag escaping", () => {
  it("escapes an HTML-tag-shaped fixture without stripping its content", () => {
    const result = normalizeForExport('<div class="x">hello</div>');

    expect(result).toContain('&lt;div class="x"&gt;hello&lt;/div&gt;');
    expect(result).not.toContain("<div");
    expect(result).not.toContain("</div>");
  });

  it("leaves realistic inequality prose completely unchanged — the negative case that justifies the leading-letter regex", () => {
    const prose =
      "burn rate decreased by <5% while revenue grew >10% quarter over quarter.";
    const result = normalizeForExport(prose);

    expect(result).toContain(prose);
    expect(result).not.toContain("&lt;");
    expect(result).not.toContain("&gt;");
  });
});

describe("normalizeForExport — end to end", () => {
  it("assembles a realistic multi-section report with a stray HTML-like fragment and irregular whitespace in one shot", () => {
    const raw =
      "# Q2 Treasury Report\n\n" +
      "## Current Treasury\n\n" +
      "Runway is healthy; burn rate is <5% of treasury per month.\n\n\n\n" +
      "## Notes\n\n" +
      "Copied from a spreadsheet: <tr><td>legacy</td></tr>   \n" +
      "## Looking Ahead\n\n" +
      "Growth is expected to exceed >10% next quarter.\n";

    const result = normalizeForExport(raw);

    expect(result).toBe(
      "# Q2 Treasury Report\n\n" +
        "## Current Treasury\n\n" +
        "Runway is healthy; burn rate is <5% of treasury per month.\n\n" +
        "## Notes\n\n" +
        "Copied from a spreadsheet: &lt;tr&gt;&lt;td&gt;legacy&lt;/td&gt;&lt;/tr&gt;\n" +
        "## Looking Ahead\n\n" +
        "Growth is expected to exceed >10% next quarter.\n\n" +
        "---\n\n" +
        `${REPORT_DISCLAIMER}\n`
    );
  });
});

describe("extractMarkdownSection", () => {
  const DOC = [
    "## Executive Summary",
    "",
    "The treasury held $792.3K.",
    "Net flow was -$113.0K.",
    "",
    "### Key Takeaways",
    "",
    "- One",
  ].join("\n");

  it("pulls a section body and stops at the next heading", () => {
    expect(extractMarkdownSection(DOC, "Executive Summary")).toBe(
      "The treasury held $792.3K.\nNet flow was -$113.0K."
    );
  });

  // The two extractors this replaced disagreed on exactly these two points,
  // and each disagreement silently produced a NULL summary in production.
  it("accepts ## through ####, not just ###", () => {
    for (const hashes of ["##", "###", "####"]) {
      expect(
        extractMarkdownSection(`${hashes} Executive Summary\n\nBody.`, "Executive Summary")
      ).toBe("Body.");
    }
  });

  it("tolerates trailing text on the heading line", () => {
    expect(
      extractMarkdownSection("### Executive Summary (Q1 2026)\n\nBody.", "Executive Summary")
    ).toBe("Body.");
  });

  it("is case-insensitive", () => {
    expect(extractMarkdownSection("### EXECUTIVE SUMMARY\n\nBody.", "Executive Summary")).toBe(
      "Body."
    );
  });

  // null, never "" — a caller has to be able to tell "section missing" from
  // "section present but empty".
  it("returns null when the heading is absent", () => {
    expect(extractMarkdownSection("### Other\n\nBody.", "Executive Summary")).toBeNull();
    expect(extractMarkdownSection("", "Executive Summary")).toBeNull();
  });

  it("reads the last section when nothing follows it", () => {
    expect(extractMarkdownSection("### Executive Summary\n\nFinal words.", "Executive Summary")).toBe(
      "Final words."
    );
  });
});

describe("deriveExecutiveSummary", () => {
  it("lifts the Executive Summary out of a report", () => {
    expect(
      deriveExecutiveSummary("### Executive Summary\n\nHeld $2.4M.\n\n### Key Takeaways\n\n- x")
    ).toBe("Held $2.4M.");
  });

  it("returns null rather than throwing on empty or absent input", () => {
    expect(deriveExecutiveSummary("")).toBeNull();
    expect(deriveExecutiveSummary("## Treasury Overview\n\nNo summary here.")).toBeNull();
  });

  // The regression this whole change exists for: the stored summary must
  // track the markdown, or the reports list and the investor email both
  // describe a document that no longer exists.
  it("yields a DIFFERENT summary once the markdown is regenerated", () => {
    const before = "### Executive Summary\n\nTreasury stands at $162.8K.";
    const after = "### Executive Summary\n\nTreasury stands at $792.3K.";
    expect(deriveExecutiveSummary(before)).not.toBe(deriveExecutiveSummary(after));
    expect(deriveExecutiveSummary(after)).toContain("$792.3K");
  });
});
