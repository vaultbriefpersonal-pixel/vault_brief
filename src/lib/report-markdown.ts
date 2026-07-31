// Verbatim insertion of a founder's own words into a generated report — the
// one thing in this product NOT run through an LLM. See P1.1 in the plan:
// `reports.founder_notes` was written by ReportEditor.tsx from day one and
// read by nothing (B7) — a private-notes field with no publish path. This
// module IS that path, and it is a deliberate, stated user action (a
// button), never automatic: retroactively injecting notes written under a UI
// that reads like a private scratchpad into a report that may have ALREADY
// BEEN SENT to investors would be a privacy incident, not a bug fix.
//
// Line-based, not character-offset regex: splitting on "\n" and comparing
// whole lines makes "find the next top-level heading" trivial and exact,
// where a single regex spanning arbitrary content is easy to get
// byte-almost-right and wrong at the edges.
//
// KNOWN LIMITATION, accepted: notes are inserted VERBATIM, so if a founder's
// own note text happens to contain a line starting with "## ", a later
// upsert call will misread that as document structure when looking for
// where the section ends. Narrow edge case, and "verbatim, never processed"
// is the whole point of this module — not worth a markdown parser to close.

const FOUNDER_NOTE_HEADING = "## Founder's note";

/** Collapse runs of 3+ newlines to exactly one blank line, and normalise the
 * document to have no leading/trailing blank lines and end in exactly one
 * trailing newline. Applied to every mutating return path so two calls with
 * the same inputs are byte-identical (idempotency), regardless of whether
 * the section was appended or replaced.
 *
 * NOTE: the original draft used `.trimEnd()` here (trailing-only). That left
 * a document built up from an empty string (no prior content) with a
 * leading "\n\n" ahead of the inserted heading, because appending to `[""]`
 * (the split of an empty string) produces leading blank-line elements that
 * only a leading trim removes. Switched to `.trim()` — it only strips
 * whitespace/newlines from the very start and end of the whole document, so
 * it can never eat real content, and it closes that edge case. */
function normalize(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim() + "\n";
}

/**
 * Locate an existing `## Founder's note` section: the index of its heading
 * line, and the index of the line where the NEXT top-level (`## `) heading
 * begins (or the total line count, if it's the last section). Returns null
 * when no line is exactly `## Founder's note`.
 */
function findFounderNoteSection(
  lines: string[]
): { headingIndex: number; nextHeadingIndex: number } | null {
  const headingIndex = lines.findIndex((line) => line.trim() === FOUNDER_NOTE_HEADING);
  if (headingIndex === -1) return null;

  let nextHeadingIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      nextHeadingIndex = i;
      break;
    }
  }
  return { headingIndex, nextHeadingIndex };
}

/**
 * Insert, replace, or remove the report's `## Founder's note` section.
 *
 * - Blank/whitespace-only `notes` REMOVES the section if present, and is a
 *   literal no-op (returns `markdown` unchanged) if absent — an emptied
 *   textarea un-publishes the note rather than publishing an empty heading.
 * - Otherwise: replaces the section in place if one already exists
 *   (every other line before and after it is left untouched), or appends a
 *   new one to the end of the document if none exists yet.
 * - `notes` is inserted VERBATIM — never reformatted, never LLM-processed.
 * - Idempotent: `upsertFounderNoteSection(upsertFounderNoteSection(md, n), n)
 *   === upsertFounderNoteSection(md, n)`.
 */
export function upsertFounderNoteSection(markdown: string, notes: string): string {
  const trimmedNotes = notes.trim();
  const lines = markdown.split("\n");
  const existing = findFounderNoteSection(lines);

  if (!trimmedNotes) {
    if (!existing) return markdown;
    const before = lines.slice(0, existing.headingIndex);
    const after = lines.slice(existing.nextHeadingIndex);
    return normalize([...before, ...after].join("\n"));
  }

  const section = [FOUNDER_NOTE_HEADING, "", trimmedNotes];

  if (existing) {
    const before = lines.slice(0, existing.headingIndex);
    const after = lines.slice(existing.nextHeadingIndex);
    return normalize([...before, ...section, ...after].join("\n"));
  }

  return normalize([...lines, "", ...section].join("\n"));
}
