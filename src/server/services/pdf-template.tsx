import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  Link,
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
import {
  parseReportDoc,
  columnWidths,
  isNumericCell,
  inlineText,
  type DocBlock,
  type Inline,
  type Align,
} from "@/lib/report-doc";
// Family NAMES and palette only — registration lives in pdf-fonts.ts, which
// pdf-generator.ts awaits before rendering. Keeping the `Font` object out of
// this module avoids a second static import of @react-pdf/renderer, which
// pdf-generator.ts:5-12 documents as unreliable under serverExternalPackages.
import {
  PDF_SERIF,
  PDF_MONO,
  DOC_LIGHT,
  DEFAULT_ACCENT,
  readableAccentOn,
  sanitizeForPdf,
} from "@/lib/report-theme";

interface PDFTemplateProps {
  projectName: string;
  logoUrl?: string | null;
  website?: string | null;
  /** Human-readable period label, e.g. "April 2026". */
  period: string;
  /**
   * The report body, as markdown. Parsed here through the SHARED parser so
   * the PDF and the web page cannot disagree about the same document — they
   * did, for a long time, in ways nobody could see side by side.
   */
  contentMd: string;
  /** What kind of report this is; sets the masthead kicker. */
  kind?: "investor" | "grant";
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

// ─── Type scale ────────────────────────────────────────────────────────────
// Points, not pixels. A4 minus 128pt of horizontal padding leaves 467pt of
// measure, which at 10pt Spectral is ~85 characters — wide for a reading
// column, but this is a reference document that people scan for figures more
// than they read start to finish, and narrowing it would push every table
// into a scroll.

const T = {
  kicker: 8,
  title: 20,
  meta: 9,
  h1: 15,
  h2: 12.5,
  h3: 11,
  h4: 8.5,
  body: 10,
  small: 9,
  tiny: 8,
} as const;

const styles = StyleSheet.create({
  page: {
    fontFamily: PDF_SERIF,
    fontSize: T.body,
    color: DOC_LIGHT.ink,
    backgroundColor: DOC_LIGHT.paper,
    paddingTop: 64,
    paddingBottom: 72,
    paddingHorizontal: 64,
    lineHeight: 1.55,
  },

  // ── masthead ──
  masthead: {
    marginBottom: 26,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: DOC_LIGHT.ink,
  },
  mastheadTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  kicker: {
    fontFamily: PDF_MONO,
    fontSize: T.kicker,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: DOC_LIGHT.inkFaint,
  },
  title: {
    fontFamily: PDF_SERIF,
    fontWeight: 600,
    fontSize: T.title,
    color: DOC_LIGHT.ink,
    marginTop: 6,
    lineHeight: 1.15,
  },
  logo: { maxHeight: 30, maxWidth: 96, objectFit: "contain" },
  metaRow: { flexDirection: "row", gap: 28, marginTop: 12 },
  metaLabel: {
    fontFamily: PDF_MONO,
    fontSize: 7.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: DOC_LIGHT.inkFaint,
    marginBottom: 2,
  },
  metaValue: {
    fontFamily: PDF_MONO,
    fontSize: T.meta,
    color: DOC_LIGHT.inkSoft,
  },

  // ── headings ──
  // Four distinct levels. Previously `##` and `###` both rendered through the
  // same style, so a document's structure was invisible, and `#`/`####` were
  // not recognised at all and printed their own hashes.
  h1: {
    fontFamily: PDF_SERIF,
    fontWeight: 600,
    fontSize: T.h1,
    color: DOC_LIGHT.ink,
    marginTop: 20,
    marginBottom: 8,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: DOC_LIGHT.line,
  },
  h2: {
    fontFamily: PDF_SERIF,
    fontWeight: 600,
    fontSize: T.h2,
    color: DOC_LIGHT.ink,
    marginTop: 16,
    marginBottom: 5,
  },
  h3: {
    fontFamily: PDF_SERIF,
    fontWeight: 600,
    fontSize: T.h3,
    color: DOC_LIGHT.ink,
    marginTop: 12,
    marginBottom: 4,
  },
  h4: {
    fontFamily: PDF_MONO,
    fontSize: T.h4,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: DOC_LIGHT.inkFaint,
    marginTop: 12,
    marginBottom: 4,
  },

  // ── body ──
  paragraph: {
    fontFamily: PDF_SERIF,
    fontSize: T.body,
    color: DOC_LIGHT.ink,
    marginBottom: 7,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
    paddingLeft: 4,
  },
  // A styled View, not a "•" character.
  //
  // Originally a workaround: Helvetica's standard encoding didn't carry the
  // bullet reliably, and shipping a font for one glyph wasn't worth it. Both
  // halves of that are obsolete — the faces are embedded and pdf-fonts.test.ts
  // verifies U+2022 is in all of them. Kept as a design choice: a small dot in
  // the project's accent carries brand where a typographic bullet doesn't, and
  // it survives any future change of typeface.
  bulletDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 1.75,
    marginTop: 6,
    marginRight: 8,
  },
  // Ordered lists were not a block kind at all before, so `1. 2. 3.` collapsed
  // into one run-on paragraph. Mono numerals in a fixed right-aligned gutter
  // keep the text edge straight past item 9.
  ordinal: {
    fontFamily: PDF_MONO,
    fontSize: T.small,
    color: DOC_LIGHT.inkFaint,
    width: 20,
    marginRight: 6,
    textAlign: "right",
  },
  listText: {
    flex: 1,
    fontFamily: PDF_SERIF,
    fontSize: T.body,
    color: DOC_LIGHT.ink,
  },
  rule: {
    borderBottomWidth: 1,
    borderBottomColor: DOC_LIGHT.line,
    marginVertical: 12,
  },
  codeBlock: {
    fontFamily: PDF_MONO,
    fontSize: T.tiny,
    color: DOC_LIGHT.inkSoft,
    backgroundColor: DOC_LIGHT.paperRaised,
    borderLeftWidth: 2,
    borderLeftColor: DOC_LIGHT.line,
    padding: 8,
    marginBottom: 8,
    lineHeight: 1.4,
  },

  // ── tables ──
  // Hairline rows rather than a boxed grid: a ruled table reads as a financial
  // statement, a boxed one reads as a spreadsheet screenshot.
  table: { marginTop: 4, marginBottom: 12 },
  tHeadRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: DOC_LIGHT.ink,
    paddingBottom: 4,
  },
  tRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: DOC_LIGHT.line,
    paddingVertical: 4,
  },
  th: {
    fontFamily: PDF_MONO,
    fontSize: 7.5,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: DOC_LIGHT.inkFaint,
    paddingHorizontal: 5,
  },
  td: {
    fontFamily: PDF_SERIF,
    fontSize: T.small,
    color: DOC_LIGHT.ink,
    paddingHorizontal: 5,
  },
  tdNum: {
    fontFamily: PDF_MONO,
    fontSize: T.small,
    color: DOC_LIGHT.ink,
    paddingHorizontal: 5,
  },

  // ── chart cards ──
  card: {
    marginBottom: 14,
    padding: 12,
    backgroundColor: DOC_LIGHT.paperRaised,
    borderWidth: 1,
    borderColor: DOC_LIGHT.line,
  },
  cardLabel: {
    fontFamily: PDF_MONO,
    fontSize: T.h4,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: DOC_LIGHT.inkFaint,
    marginBottom: 8,
  },

  // ── chrome ──
  disclaimer: {
    fontFamily: PDF_SERIF,
    fontSize: T.tiny,
    color: DOC_LIGHT.inkSoft,
    marginTop: 22,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: DOC_LIGHT.line,
    lineHeight: 1.45,
  },
  footer: {
    position: "absolute",
    bottom: 38,
    left: 64,
    right: 64,
    flexDirection: "row",
    justifyContent: "space-between",
    // Explicit, because `position: absolute` + `fixed` takes this View out of
    // the page flow and it stops inheriting `page`'s fontFamily — which
    // silently pulled a whole base-14 resource in just to set "Page 1 of 3".
    fontFamily: PDF_MONO,
    fontSize: 7.5,
    color: DOC_LIGHT.inkFaint,
    borderTopWidth: 1,
    borderTopColor: DOC_LIGHT.line,
    paddingTop: 6,
  },
});

// ─── inline rendering ──────────────────────────────────────────────────────

/**
 * Render an inline run from the shared AST.
 *
 * All the tokenizing that used to live here is gone — three regexes and a
 * hand-rolled splitter that disagreed with the web renderer's three regexes
 * and hand-rolled splitter. This just walks nodes.
 *
 * `sanitizeForPdf` is applied at the leaves rather than to the whole string
 * up front, so a substitution can never disturb the markup boundaries the
 * parser already resolved.
 */
/**
 * The two accents a report renders with, resolved once per document.
 *
 * `fill` is the project's raw brand colour and paints shapes — bullet dots,
 * chart series, the masthead rule. `ink` is the same hue darkened until it
 * clears 4.5:1 on paper, and paints text. They are separate because the
 * product's own default accent (#00e87b) measures about 1.5:1 against
 * #EDEEEA: perfectly good as a fill, invisible as a link.
 */
interface AccentPair {
  fill: string;
  ink: string;
}

function renderInline(
  nodes: Inline[],
  keyBase: string,
  accent: AccentPair
): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyBase}-${i}`;
    switch (n.t) {
      case "text":
        return <Text key={key}>{sanitizeForPdf(n.v)}</Text>;
      case "strong":
        return (
          <Text key={key} style={{ fontWeight: 600 }}>
            {renderInline(n.c, key, accent)}
          </Text>
        );
      case "em":
        return (
          <Text key={key} style={{ fontStyle: "italic" }}>
            {renderInline(n.c, key, accent)}
          </Text>
        );
      case "code":
        return (
          <Text
            key={key}
            style={{
              fontFamily: PDF_MONO,
              fontSize: T.small,
              color: DOC_LIGHT.inkSoft,
            }}
          >
            {sanitizeForPdf(n.v)}
          </Text>
        );
      case "link":
        // Neither renderer could produce a link before; `Link` was never even
        // imported here, so `[text](url)` printed its own brackets. The parser
        // has already rejected any scheme outside http/https/mailto.
        return (
          <Link key={key} src={n.href} style={{ color: accent.ink }}>
            {renderInline(n.c, key, accent)}
          </Link>
        );
      default: {
        // Exhaustiveness guard. A new Inline variant becomes a COMPILE error
        // here rather than silently rendering as nothing — which is how the
        // old renderers came to be missing links in the first place.
        const exhaustive: never = n;
        return exhaustive;
      }
    }
  });
}

// ─── block rendering ───────────────────────────────────────────────────────

const HEADING_STYLE = {
  1: styles.h1,
  2: styles.h2,
  3: styles.h3,
  4: styles.h4,
} as const;

function renderBlock(
  block: DocBlock,
  key: string,
  accent: AccentPair
): React.ReactNode {
  switch (block.k) {
    case "heading":
      // `minPresenceAhead` is react-pdf's orphan guard: it forces a page break
      // BEFORE the heading if there isn't at least this much room after it.
      // The old template instead wrapped each whole section in
      // `<View wrap={false}>`, which meant a section taller than a page could
      // not break at all and simply overflowed off the bottom.
      return (
        <Text
          key={key}
          style={HEADING_STYLE[block.level]}
          minPresenceAhead={48}
        >
          {renderInline(block.c, key, accent)}
        </Text>
      );

    case "para":
      return (
        <Text key={key} style={styles.paragraph}>
          {renderInline(block.c, key, accent)}
        </Text>
      );

    case "bullets":
      return (
        <View key={key} style={{ marginBottom: 6 }}>
          {block.items.map((item, i) => (
            <View key={`${key}-${i}`} style={styles.listRow}>
              <View style={[styles.bulletDot, { backgroundColor: accent.fill }]} />
              <Text style={styles.listText}>
                {renderInline(item, `${key}-${i}`, accent)}
              </Text>
            </View>
          ))}
        </View>
      );

    case "ordered":
      return (
        <View key={key} style={{ marginBottom: 6 }}>
          {block.items.map((item, i) => (
            <View key={`${key}-${i}`} style={styles.listRow}>
              <Text style={styles.ordinal}>{block.start + i}.</Text>
              <Text style={styles.listText}>
                {renderInline(item, `${key}-${i}`, accent)}
              </Text>
            </View>
          ))}
        </View>
      );

    case "table":
      return renderTable(block, key, accent);

    case "rule":
      return <View key={key} style={styles.rule} />;

    case "code":
      return (
        <Text key={key} style={styles.codeBlock}>
          {sanitizeForPdf(block.v)}
        </Text>
      );

    default: {
      // Same exhaustiveness contract as renderInline. This is what makes the
      // shared AST safe: a block kind the PDF forgets to handle is a build
      // failure, not a silently missing section in a funder's document.
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

function renderTable(
  block: Extract<DocBlock, { k: "table" }>,
  key: string,
  accent: AccentPair
): React.ReactNode {
  // Every column used to be `flex: 1`, so a 42-character wallet address got
  // exactly as much room as a "%" column and both wrapped badly. Widths now
  // track content, with a floor so nothing collapses.
  const widths = columnWidths(block.align, block.head, block.rows);
  const colCount = widths.length;

  const alignAt = (i: number): Align => block.align[i] ?? "left";

  return (
    <View key={key} style={styles.table}>
      <View style={styles.tHeadRow} wrap={false}>
        {Array.from({ length: colCount }, (_, i) => (
          <Text
            key={`${key}-h-${i}`}
            style={[
              styles.th,
              { width: `${widths[i] * 100}%`, textAlign: alignAt(i) },
            ]}
          >
            {/* Header cells go through the same inline pass as body cells.
                They used to be emitted raw, so `**Total**` printed its
                asterisks in the header of a funder's table. */}
            {block.head[i] ? renderInline(block.head[i], `${key}-h-${i}`, accent) : ""}
          </Text>
        ))}
      </View>

      {block.rows.map((row, r) => (
        // wrap={false} belongs HERE, on the row — a row split across a page
        // boundary is unreadable, but a long table must still be able to
        // break between rows.
        <View key={`${key}-r-${r}`} style={styles.tRow} wrap={false}>
          {Array.from({ length: colCount }, (_, c) => {
            const cell = row[c];
            const raw = cell ? inlineText(cell) : "";
            const numeric = isNumericCell(raw);
            return (
              <Text
                key={`${key}-r-${r}-${c}`}
                style={[
                  numeric ? styles.tdNum : styles.td,
                  {
                    width: `${widths[c] * 100}%`,
                    // Fall back to right-aligning figures when the markdown
                    // didn't carry an alignment row — models emit those
                    // inconsistently, and a ragged-left money column is the
                    // clearest tell of an untypeset document.
                    textAlign:
                      block.align[c] !== undefined
                        ? alignAt(c)
                        : numeric
                          ? "right"
                          : "left",
                  },
                ]}
              >
                {cell ? renderInline(cell, `${key}-r-${r}-${c}`, accent) : ""}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── document ──────────────────────────────────────────────────────────────

export function VaultBriefPDF({
  projectName,
  logoUrl,
  website,
  period,
  contentMd,
  kind = "investor",
  primaryColor,
  snapshot,
  trendSnapshots = [],
  compositionSlices: compositionSlicesProp = [],
}: PDFTemplateProps) {
  // Two accents, deliberately. The raw one paints FILLS — bullet dots, chart
  // series, the masthead rule — so a project's brand stays visible. The
  // derived one paints TEXT, because the product's own default (#00e87b)
  // measures about 1.5:1 on paper and would be unreadable as a link.
  const accentFill =
    primaryColor && primaryColor.trim() ? primaryColor : DEFAULT_ACCENT;
  const accent: AccentPair = {
    fill: accentFill,
    ink: readableAccentOn(accentFill, DOC_LIGHT.paper),
  };

  const blocks = parseReportDoc(contentMd ?? "");

  // Derive chart inputs once. All chart components null-out internally when
  // the data isn't sufficient (e.g. fewer than 2 trend points), so they can be
  // passed unconditionally.
  //
  // Zero-value slices are dropped, and that stays deliberate: a bucket the
  // treasury holds nothing in should not render a 0% wedge with a legend
  // entry, because a wedge is a claim that there is something there.
  const compositionSlices = compositionSlicesProp.filter((s) => s.value > 0);
  const chainEntries = snapshot?.balancesByChain
    ? Object.entries(snapshot.balancesByChain as Record<string, number>).map(
        ([chain, value]) => ({ chain, value: Number(value) })
      )
    : [];
  const trendBars = trendSnapshots.map((s) => ({
    date:
      typeof s.snapshotDate === "string"
        ? s.snapshotDate
        : String(s.snapshotDate),
    value: Number(s.totalBalanceUsd ?? 0),
  }));
  const ghSpark = trendSnapshots.map((s) => Number(s.githubCommitsCount ?? 0));

  return (
    <Document
      title={`${projectName} — ${period}`}
      author="Vault Brief"
      creator="Vault Brief"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.masthead}>
          <View style={styles.mastheadTop}>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={styles.kicker}>
                {kind === "grant" ? "Grant Report" : "Investor Report"}
              </Text>
              <Text style={styles.title}>{sanitizeForPdf(projectName)}</Text>
            </View>
            {logoUrl ? (
              // `Image` is @react-pdf/renderer's PDF-layout primitive, not an
              // HTML <img> — its props have no `alt` (see BaseImageProps in
              // the package's type defs). jsx-a11y can't tell them apart.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoUrl} style={styles.logo} />
            ) : null}
          </View>

          <View style={styles.metaRow}>
            <View>
              <Text style={styles.metaLabel}>Period</Text>
              <Text style={styles.metaValue}>{period}</Text>
            </View>
            {website ? (
              <View>
                <Text style={styles.metaLabel}>Project</Text>
                <Text style={styles.metaValue}>{website}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Charts anchor the visual opening. Each component null-checks its
            own data, so single-month / single-chain projects render cleanly. */}
        {compositionSlices.length > 0 && (
          <View wrap={false} style={styles.card}>
            <Text style={styles.cardLabel}>Treasury composition</Text>
            <TreasuryPie data={compositionSlices} accent={accentFill} />
          </View>
        )}
        {chainEntries.length >= 2 && (
          <View wrap={false} style={{ marginBottom: 14 }}>
            <Text style={styles.cardLabel}>Treasury by chain</Text>
            <ChainSplit data={chainEntries} />
          </View>
        )}
        {trendBars.length >= 2 && (
          <View wrap={false} style={{ marginBottom: 14 }}>
            <Text style={styles.cardLabel}>Treasury over time</Text>
            <TrendBars data={trendBars} accent={accentFill} yLabel="USD" />
          </View>
        )}
        {ghSpark.length >= 2 && ghSpark.some((n) => n > 0) && (
          <View
            wrap={false}
            style={{
              marginBottom: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Text style={[styles.cardLabel, { marginBottom: 0 }]}>
              GitHub activity
            </Text>
            <GitHubSparkline data={ghSpark} accent={accentFill} />
          </View>
        )}

        {/* Body. A flat block list, NOT a list of heading-scoped sections —
            which is what let the old parser silently drop everything above
            the first heading and made a tall section overflow the page. */}
        {blocks.map((b, i) => renderBlock(b, `b${i}`, accent))}

        {/* Platform disclaimer — once, at the end of the content, not per-page
            like the footer. The model is instructed (report-sections.ts's
            Rules block) never to write its own, so this is the only
            disclaimer that reaches the PDF. */}
        <Text style={styles.disclaimer}>{REPORT_DISCLAIMER}</Text>

        <View style={styles.footer} fixed>
          <Text>
            {website ? `${website} · ` : ""}Generated by Vault Brief
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

