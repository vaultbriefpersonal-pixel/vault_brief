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

import { REPORT_DISCLAIMER } from "@/lib/report-disclaimer";

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

/**
 * Pull one section's body out of a generated report.
 *
 * Tolerant of the heading shapes the model actually emits: `##` through
 * `####`, and any trailing text on the heading line, so a plain
 * `### Key Takeaways` and an instruction-echoing `### Key Takeaways (Q1 2026)`
 * both match. Returns null when the heading is absent — never an empty
 * string, so a caller can tell "section missing" from "section present but
 * blank".
 *
 * This is the ONE extractor. There were two: `validateReportContent`'s, which
 * accepted a trailing parenthetical but only `###`, and a second one inlined
 * in `createReportRecord` which accepted neither. The second is why a report
 * whose model wrote `## Executive Summary` silently stored a NULL summary.
 *
 * No markdown parser: the document is generated by this codebase in a fixed
 * heading shape, and the same lightweight regex inspection is used throughout.
 */
export function extractMarkdownSection(
  markdown: string,
  headingPattern: string
): string | null {
  const re = new RegExp(
    `#{2,4}\\s*${headingPattern}[^\\n]*\\n+([\\s\\S]+?)(?=\\n#{2,4}\\s|$)`,
    "i"
  );
  const match = markdown.match(re);
  return match ? match[1].trim() : null;
}

/**
 * The one-paragraph summary stored on `reports.executive_summary`.
 *
 * DERIVED, not authored — it is the report's own Executive Summary section,
 * lifted out of the markdown. That makes it a cache, and it has to be
 * refreshed every time `content_md` changes or it starts describing a
 * document that no longer exists.
 *
 * It used to be computed in exactly one place (the INSERT in
 * `createReportRecord`) and never again, so `regenerate` and the editor's save
 * both left it stale. The visible symptom was a reports-list preview quoting
 * $162.8K beside a report saying $792.3K — but the column is also the body of
 * `sendReportEmail`, so a regenerated-then-sent report mailed investors the
 * pre-regeneration figures. Every writer of `content_md` must call this.
 */
export function deriveExecutiveSummary(markdown: string): string | null {
  return extractMarkdownSection(markdown ?? "", "Executive Summary");
}

/**
 * Match tag-shaped substrings so they can be escaped rather than stripped:
 * an optional leading `/` (closing tags), then a letter, then any run of
 * non-`<`/`>`/newline characters up to the closing `>`. The leading-letter
 * requirement is deliberate: it is what keeps this from matching inequality
 * prose like "burn rate <5%" or "grew >10%" — a digit or `%` right after
 * `<`/`>` never satisfies `[a-zA-Z]`, so real financial language is never
 * touched. It only fires on things that actually look like `<div>`,
 * `</span>`, etc.
 */
const HTML_TAG_RE = /<\/?[a-zA-Z][^<>\n]*>/g;

/**
 * Normalize a report's raw `contentMd` for export off-platform (clipboard
 * copy, `.md` file download) — a fourth surface alongside the three that
 * already render `REPORT_DISCLAIMER` (PDF, the public `/r/[reportId]` page,
 * the investor email footer). Without this, an exported report carrying
 * real treasury figures would ship with no disclaimer at all, unlike every
 * other output.
 *
 * In order:
 * 1. Escape (never strip) HTML-tag-shaped substrings, turning their `<`/`>`
 *    into `&lt;`/`&gt;`. The system prompt never forbids HTML and nothing
 *    upstream sanitizes `contentMd`, so this is cheap defensive
 *    neutralization, not a response to an observed problem. Escaping over
 *    stripping means a false positive is visible-but-lossless rather than a
 *    silent hole in a report headed for a governance forum.
 * 2. Append `REPORT_DISCLAIMER` verbatim — no heading, no markdown emphasis
 *    — behind a blank line, a `---` rule, and a blank line, matching how
 *    the other three surfaces render it (unstyled small print, the `---`
 *    standing in for the font-size cue they use instead).
 * 3. Run the existing `normalize()` helper over the fully-assembled string
 *    as the final step, so nothing upstream can leave stray blank lines or
 *    a missing/duplicate trailing newline.
 *
 * NOT idempotent under re-application: running this on its own output would
 * double-append the disclaimer. This is a documented property, not a bug —
 * every real call site passes raw `contentMd`, which never contains the
 * disclaimer to begin with.
 */
export function normalizeForExport(markdown: string): string {
  const escaped = markdown.replace(HTML_TAG_RE, (tag) =>
    tag.replace(/^</, "&lt;").replace(/>$/, "&gt;")
  );
  const withDisclaimer = `${escaped}\n\n---\n\n${REPORT_DISCLAIMER}`;
  return normalize(withDisclaimer);
}
