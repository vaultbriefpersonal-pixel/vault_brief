import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import {
  TreasuryPie,
  ChainSplit,
  TrendBars,
  GitHubSparkline,
} from "./pdf-charts";
import type { TreasurySnapshot } from "@/server/db/schema";
import { REPORT_DISCLAIMER } from "@/lib/report-disclaimer";

interface PDFTemplateProps {
  projectName: string;
  logoUrl?: string | null;
  website?: string | null;
  period: string;
  content: ParsedReportContent;
  primaryColor?: string;
  /** Latest snapshot — drives the chain split + trend charts. */
  snapshot?: TreasurySnapshot | null;
  /** Oldest → newest, up to 6 entries. Drives the trend bars + sparkline. */
  trendSnapshots?: TreasurySnapshot[];
  /**
   * Composition donut slices, already derived by the caller from the
   * snapshot's per-token `balances_detail` through the shared classifier in
   * treasury-composition.ts. Passed in rather than computed here because this
   * template must not carry data policy: it used to read the four frozen
   * snapshot columns directly, which is how the donut came to read "Other
   * 100.0%" on a treasury the report's own prose described correctly.
   * See pdf-generator.ts for the derivation and the full account.
   */
  compositionSlices?: { label: string; value: number }[];
}

interface ParsedReportContent {
  sections: Array<{ heading: string; body: string }>;
  rawMarkdown: string;
}

const NAVY = "#1B2A4A";
const BODY = "#374151";
const LIGHT_GRAY = "#F3F4F6";
const MID_GRAY = "#9CA3AF";
const ACCENT = "#6366F1";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    paddingTop: 72,
    paddingBottom: 72,
    paddingHorizontal: 72,
    fontSize: 10,
    color: BODY,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  logo: {
    maxHeight: 28,
    maxWidth: 80,
    objectFit: "contain",
  },
  projectName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
  },
  headerRight: {
    fontSize: 9,
    color: MID_GRAY,
    textAlign: "right",
  },
  h1: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginTop: 16,
    marginBottom: 6,
  },
  h2: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginTop: 12,
    marginBottom: 4,
  },
  paragraph: {
    fontSize: 10,
    color: BODY,
    lineHeight: 1.5,
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 3,
    paddingLeft: 6,
  },
  // Use a styled View as the bullet dot — Helvetica's standard encoding
  // doesn't carry "•" reliably (extracted as � in some readers) and we
  // don't want to ship a custom font just for one glyph.
  bulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: ACCENT,
    marginTop: 5,
    marginRight: 6,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    color: BODY,
    lineHeight: 1.45,
  },
  // Tables: a flex grid. Each cell gets a 1px right/bottom border to draw
  // the grid; table-edge cells skip the outer side via cellLast / cellBottom.
  table: {
    marginVertical: 6,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: LIGHT_GRAY,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: LIGHT_GRAY,
  },
  th: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    backgroundColor: LIGHT_GRAY,
    borderRightWidth: 1,
    borderColor: "#E5E7EB",
  },
  td: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
    fontSize: 9,
    color: BODY,
    borderRightWidth: 1,
    borderColor: LIGHT_GRAY,
  },
  footer: {
    position: "absolute",
    bottom: 36,
    left: 72,
    right: 72,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: MID_GRAY,
    borderTopWidth: 1,
    borderTopColor: LIGHT_GRAY,
    paddingTop: 6,
  },
  // Rendered once at the end of the document content — NOT `fixed`, unlike
  // `footer` above, which repeats on every page and has no room to spare.
  disclaimer: {
    fontSize: 8,
    color: MID_GRAY,
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: LIGHT_GRAY,
  },
});

export function parseMarkdown(markdown: string): ParsedReportContent {
  const sections: Array<{ heading: string; body: string }> = [];
  const lines = markdown.split("\n");
  let currentHeading = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    if (line.startsWith("### ") || line.startsWith("## ")) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
      }
      currentHeading = line.replace(/^#+\s+/, "");
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  if (currentHeading) {
    sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
  }

  return { sections, rawMarkdown: markdown };
}

// ─── Inline rendering ──────────────────────────────────────────────────────
// React-PDF doesn't read Markdown; we have to walk the bold/italic/code
// markers ourselves and emit nested <Text> with the appropriate fontFamily.
// Order matters — bold before italic so `**foo**` doesn't get parsed as italic.

const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_RE = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
const CODE_RE = /`([^`]+)`/g;

function renderInline(text: string, key: number): React.ReactNode {
  // Strip stray emoji / unknown glyphs that resolve to � in Helvetica. The
  // LLM occasionally emits them in bullet markers; safer to drop than
  // render a broken square. (The ASCII subset is fine.)
  text = text.replace(/[\u{1F300}-\u{1FAFF}]/gu, "");

  // Tokenize. Each token is either plain or a styled span.
  type Tok = { kind: "plain" | "bold" | "italic" | "code"; text: string };
  const tokens: Tok[] = [{ kind: "plain", text }];

  function splitOn(re: RegExp, kind: Tok["kind"]) {
    const next: Tok[] = [];
    for (const tok of tokens) {
      if (tok.kind !== "plain") {
        next.push(tok);
        continue;
      }
      let last = 0;
      let m: RegExpExecArray | null;
      const localRe = new RegExp(re.source, re.flags);
      while ((m = localRe.exec(tok.text)) !== null) {
        if (m.index > last) {
          next.push({ kind: "plain", text: tok.text.slice(last, m.index) });
        }
        next.push({ kind, text: m[1] });
        last = m.index + m[0].length;
      }
      if (last < tok.text.length) {
        next.push({ kind: "plain", text: tok.text.slice(last) });
      }
    }
    tokens.splice(0, tokens.length, ...next);
  }

  splitOn(BOLD_RE, "bold");
  splitOn(ITALIC_RE, "italic");
  splitOn(CODE_RE, "code");

  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "bold") {
          return (
            <Text key={`${key}-${i}`} style={{ fontFamily: "Helvetica-Bold" }}>
              {t.text}
            </Text>
          );
        }
        if (t.kind === "italic") {
          return (
            <Text key={`${key}-${i}`} style={{ fontFamily: "Helvetica-Oblique" }}>
              {t.text}
            </Text>
          );
        }
        if (t.kind === "code") {
          return (
            <Text
              key={`${key}-${i}`}
              style={{
                fontFamily: "Courier",
                backgroundColor: LIGHT_GRAY,
                fontSize: 9,
              }}
            >
              {t.text}
            </Text>
          );
        }
        return <Text key={`${key}-${i}`}>{t.text}</Text>;
      })}
    </>
  );
}

// ─── Block parsing ─────────────────────────────────────────────────────────
// Given a section body (the lines between two headings), group consecutive
// lines into block types so React-PDF can render them with appropriate
// components. Tables and bullet lists must contain their consecutive rows.

type Block =
  | { kind: "para"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] };

function isTableRow(s: string): boolean {
  // Markdown table row: "| ... |" with at least one pipe inside.
  const t = s.trim();
  return t.startsWith("|") && t.endsWith("|") && t.split("|").length >= 3;
}

function isTableSeparator(s: string): boolean {
  // "| :--- | :--- |" — separator rows we never render.
  return /^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(s.trim());
}

function splitTableRow(s: string): string[] {
  return s
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isBullet(s: string): boolean {
  // - foo  |  • foo  |  * foo
  return /^[\s]*[-•*]\s+/.test(s);
}

function stripBullet(s: string): string {
  return s.replace(/^[\s]*[-•*]\s+/, "");
}

function blocksFromBody(body: string): Block[] {
  const lines = body.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // Table: header row followed by separator, then more rows
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSeparator(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // Inline-table-on-one-line edge case: LLM sometimes runs a whole table
    // through with literal " | " separators inside one paragraph. Treat as
    // paragraph in that case — don't try to recover.
    if (isTableRow(line) && !(i + 1 < lines.length && isTableSeparator(lines[i + 1]))) {
      // Single-row "table" — render as a 1-row table with no header
      const cells = splitTableRow(line);
      // If this is clearly "header | header | header" without separator,
      // probably a header (we can't tell), fall back to paragraph.
      blocks.push({ kind: "para", text: cells.join("  ·  ") });
      i++;
      continue;
    }

    // Bullet list: collect consecutive bullet lines
    if (isBullet(line)) {
      const items: string[] = [stripBullet(line)];
      i++;
      while (i < lines.length && isBullet(lines[i])) {
        items.push(stripBullet(lines[i]));
        i++;
      }
      blocks.push({ kind: "bullets", items });
      continue;
    }

    // Paragraph: collect until blank line, table, or bullet list
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableRow(lines[i]) &&
      !isBullet(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "para", text: paraLines.join(" ") });
  }
  return blocks;
}

// ─── Document component ───────────────────────────────────────────────────

export function VaultBriefPDF({
  projectName,
  logoUrl,
  website,
  period,
  content,
  primaryColor = NAVY,
  snapshot,
  trendSnapshots = [],
  compositionSlices: compositionSlicesProp = [],
}: PDFTemplateProps) {
  // The accent palette flows through three places: project name (header),
  // bullet dots, and the footer link. Compute once for consistency.
  const accent = primaryColor || ACCENT;

  // Derive chart inputs once. All chart components null-out internally
  // when the data isn't sufficient (e.g. fewer than 2 trend points), so
  // we can pass them unconditionally.
  // Zero-value slices are dropped, and that stays deliberate: a bucket the
  // treasury holds nothing in should not render a 0% wedge with a legend entry,
  // because a wedge is a claim that there is something there. The slices
  // themselves now arrive already derived from per-token balances (see the prop
  // doc above) — the ONLY thing this line still decides is what to draw.
  const compositionSlices = compositionSlicesProp.filter((s) => s.value > 0);
  const chainEntries = snapshot?.balancesByChain
    ? Object.entries(snapshot.balancesByChain as Record<string, number>).map(
        ([chain, value]) => ({ chain, value: Number(value) })
      )
    : [];
  const trendBars = trendSnapshots.map((s) => ({
    date: typeof s.snapshotDate === "string" ? s.snapshotDate : String(s.snapshotDate),
    value: Number(s.totalBalanceUsd ?? 0),
  }));
  const ghSpark = trendSnapshots.map((s) => Number(s.githubCommitsCount ?? 0));

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Header — logo left of project name when available, period at right */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logoUrl ? (
              // `Image` here is @react-pdf/renderer's PDF-layout primitive,
              // not an HTML <img> — its props have no `alt` (see
              // BaseImageProps in the package's type defs). jsx-a11y can't
              // tell the two apart, hence the disable.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoUrl} style={styles.logo} />
            ) : null}
            <Text style={[styles.projectName, { color: accent }]}>
              {projectName}
            </Text>
          </View>
          <Text style={styles.headerRight}>
            Monthly Investor Report{"\n"}
            {period}
          </Text>
        </View>

        {/* Charts — rendered above the body so they anchor the visual
            opening of the report. Each component null-checks its own data
            so single-month / single-chain projects still render cleanly. */}
        {compositionSlices.length > 0 && (
          <View
            wrap={false}
            style={{
              marginBottom: 12,
              padding: 10,
              borderWidth: 1,
              borderColor: LIGHT_GRAY,
              borderRadius: 6,
            }}
          >
            <Text style={[styles.h2, { marginTop: 0 }]}>Treasury composition</Text>
            <TreasuryPie data={compositionSlices} accent={accent} />
          </View>
        )}
        {chainEntries.length >= 2 && (
          <View wrap={false} style={{ marginBottom: 12 }}>
            <Text style={styles.h2}>Treasury by chain</Text>
            <ChainSplit data={chainEntries} />
          </View>
        )}
        {trendBars.length >= 2 && (
          <View wrap={false} style={{ marginBottom: 12 }}>
            <Text style={styles.h2}>Treasury over time</Text>
            <TrendBars data={trendBars} accent={accent} yLabel="USD" />
          </View>
        )}
        {ghSpark.length >= 2 && ghSpark.some((n) => n > 0) && (
          <View
            wrap={false}
            style={{ marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <Text style={[styles.h2, { marginTop: 0 }]}>GitHub activity</Text>
            <GitHubSparkline data={ghSpark} accent={accent} />
          </View>
        )}

        {/* Content */}
        {content.sections.map((section, i) => {
          const blocks = blocksFromBody(section.body);
          return (
            <View key={i} wrap={false}>
              <Text style={styles.h1}>{section.heading}</Text>
              {blocks.map((b, j) => {
                if (b.kind === "para") {
                  return (
                    <Text key={j} style={styles.paragraph}>
                      {renderInline(b.text, j)}
                    </Text>
                  );
                }
                if (b.kind === "bullets") {
                  return (
                    <View key={j}>
                      {b.items.map((item, k) => (
                        <View key={k} style={styles.bulletRow}>
                          <View
                            style={[styles.bulletDot, { backgroundColor: accent }]}
                          />
                          <Text style={styles.bulletText}>
                            {renderInline(item, k)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                }
                if (b.kind === "table") {
                  return (
                    <View key={j} style={styles.table}>
                      <View style={styles.tr}>
                        {b.headers.map((h, k) => (
                          <Text key={k} style={styles.th}>
                            {h}
                          </Text>
                        ))}
                      </View>
                      {b.rows.map((row, k) => (
                        <View key={k} style={styles.tr}>
                          {row.map((cell, m) => (
                            <Text key={m} style={styles.td}>
                              {renderInline(cell, m)}
                            </Text>
                          ))}
                        </View>
                      ))}
                    </View>
                  );
                }
                return null;
              })}
            </View>
          );
        })}

        {/* Platform disclaimer — rendered once, at the end of the document
            content, not per-page like the footer below. The LLM is
            instructed (report-sections.ts's Rules block) never to write its
            own, so this is the only disclaimer that reaches the PDF. */}
        <Text style={styles.disclaimer}>{REPORT_DISCLAIMER}</Text>

        {/* Footer — left: project website (if present) → falls back to brand
            attribution. Right: page N of M. Both shrink to fit on each page. */}
        <View style={styles.footer} fixed>
          <Text>
            {website ? `${website} · ` : ""}Generated by Vault Brief
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
