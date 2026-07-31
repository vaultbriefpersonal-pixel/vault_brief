import { describe, it, expect } from "vitest";
import { upsertFounderNoteSection } from "./report-markdown";

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
