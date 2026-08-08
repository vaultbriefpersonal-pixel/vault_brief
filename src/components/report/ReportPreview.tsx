"use client";

import React from "react";
import {
  parseReportDoc,
  columnWidths,
  isNumericCell,
  inlineText,
  type DocBlock,
  type Inline,
} from "@/lib/report-doc";

/**
 * Renders a report body — on the public investor page and in the editor's
 * preview pane.
 *
 * Two things changed here that are worth knowing about.
 *
 * IT NO LONGER PARSES MARKDOWN. It used to, with its own line loop and its own
 * three inline regexes, which disagreed with the PDF's line loop and three
 * inline regexes about the same document. The clearest symptom: this side
 * emitted a <p> per SOURCE line, so a soft-wrapped paragraph rendered as a
 * stack of paragraphs, while the PDF joined them. Both now render the AST from
 * `report-doc.ts`, so a fix lands on both surfaces at once and a missing block
 * kind is a compile error (see the `never` arms below).
 *
 * IT NO LONGER USES dangerouslySetInnerHTML. The old renderer built an HTML
 * string and injected it, which meant hand-rolled escaping stood between
 * language-model output and an unauthenticated public page. React escapes text
 * children for free, so that whole class of risk is gone — along with the
 * escapeHtml() helper that used to guard it.
 *
 * The surface is PAPER, not the dark dashboard, on both call sites. The pane
 * is labelled "Preview" and this file's own docblock has always promised it
 * matches the eventual PDF; a dark preview of a light document breaks a
 * promise the component already makes. Dark app around a light document is the
 * correct affordance, not a mistake — the canvas is the artifact, the chrome
 * is the tool.
 */
interface ReportPreviewProps {
  content: string;
  /**
   * Render as a page floating on a darker gutter.
   *
   * True in the editor, where the document sits inside the dashboard and
   * needs an edge to read as a sheet. False on the public page, where the
   * paper IS the page background and a shadow would be a picture of paper on
   * top of paper.
   */
  sheet?: boolean;
}
// No accent prop: the accent reaches this subtree as the `--doc-accent-ink`
// custom property, set once on the document root by whichever page mounts it.
// Passing it as a prop as well would give two sources of truth for one colour.

export function ReportPreview({ content, sheet = false }: ReportPreviewProps) {
  if (!content) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 14,
          color: "var(--vb-dim)",
        }}
      >
        No content yet
      </div>
    );
  }

  const blocks = parseReportDoc(content);

  return (
    <div
      className="vb-doc vb-doc-body"
      style={
        sheet
          ? {
              maxWidth: 780,
              margin: "20px auto 32px",
              padding: "40px 44px",
              borderRadius: 3,
              boxShadow: "0 1px 3px rgba(0,0,0,0.28), 0 10px 30px rgba(0,0,0,0.22)",
            }
          : { padding: "8px 0 24px" }
      }
    >
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}

// ─── blocks ────────────────────────────────────────────────────────────────

function Block({ block }: { block: DocBlock }) {
  switch (block.k) {
    case "heading": {
      // Levels are preserved rather than flattened. The old renderer supported
      // h1-h3 and dropped h4 entirely; the PDF flattened h2 and h3 together.
      const Tag = (`h${block.level}` as const) satisfies keyof HTMLElementTagNameMap;
      return (
        <Tag className={`vb-doc-h${block.level}`}>
          <InlineRun nodes={block.c} />
        </Tag>
      );
    }

    case "para":
      return (
        <p className="vb-doc-p">
          <InlineRun nodes={block.c} />
        </p>
      );

    case "bullets":
      return (
        <ul className="vb-doc-ul">
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineRun nodes={item} />
            </li>
          ))}
        </ul>
      );

    // Ordered lists were not supported at all — a numbered list fell through
    // to the paragraph branch and rendered as prose.
    case "ordered":
      return (
        <ol className="vb-doc-ol" start={block.start}>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineRun nodes={item} />
            </li>
          ))}
        </ol>
      );

    case "table":
      return <Table block={block} />;

    case "rule":
      return <hr className="vb-doc-hr" />;

    case "code":
      return (
        <pre className="vb-doc-pre">
          <code>{block.v}</code>
        </pre>
      );

    default: {
      // Exhaustiveness guard, matching the PDF renderer. A new block kind
      // becomes a build failure rather than a section that silently fails to
      // appear in a funder's report.
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

function Table({ block }: { block: Extract<DocBlock, { k: "table" }> }) {
  // Same width policy as the PDF, from the same pure function, so the two
  // surfaces lay a table out the same way.
  const widths = columnWidths(block.align, block.head, block.rows);
  const colCount = widths.length;

  const alignOf = (i: number, raw: string) =>
    block.align[i] ?? (isNumericCell(raw) ? "right" : "left");

  return (
    // The horizontal-scroll wrapper this file never used, despite the utility
    // existing in globals.css. Without it a wide financial table pushes the
    // whole page sideways on a phone.
    <div className="vb-table-scroll vb-doc-tablewrap">
      <table className="vb-doc-table">
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: `${(w * 100).toFixed(2)}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {Array.from({ length: colCount }, (_, i) => (
              <th
                key={i}
                style={{ textAlign: block.head[i] ? alignOf(i, inlineText(block.head[i])) : "left" }}
              >
                {block.head[i] ? <InlineRun nodes={block.head[i]} /> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {Array.from({ length: colCount }, (_, c) => {
                const cell = row[c];
                const raw = cell ? inlineText(cell) : "";
                const numeric = isNumericCell(raw);
                return (
                  <td
                    key={c}
                    className={numeric ? "vb-doc-num" : undefined}
                    style={{ textAlign: alignOf(c, raw) }}
                  >
                    {cell ? <InlineRun nodes={cell} /> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── inline ────────────────────────────────────────────────────────────────

function InlineRun({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => (
        <InlineNode key={i} node={n} />
      ))}
    </>
  );
}

function InlineNode({ node }: { node: Inline }) {
  switch (node.t) {
    case "text":
      return <>{node.v}</>;
    case "strong":
      return (
        <strong>
          <InlineRun nodes={node.c} />
        </strong>
      );
    case "em":
      return (
        <em>
          <InlineRun nodes={node.c} />
        </em>
      );
    case "code":
      return <code className="vb-doc-code">{node.v}</code>;
    case "link":
      // New to this surface — `[text](url)` used to render its own brackets.
      // The parser has already rejected any scheme outside http/https/mailto,
      // so nothing hostile reaches this href. `noopener` because the target is
      // model-supplied and may be any third-party site.
      return (
        <a
          className="vb-doc-a"
          href={node.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <InlineRun nodes={node.c} />
        </a>
      );
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}
