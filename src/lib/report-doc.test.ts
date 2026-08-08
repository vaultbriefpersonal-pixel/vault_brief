import { describe, it, expect } from "vitest";
import {
  parseReportDoc,
  parseInline,
  docPlainText,
  inlineText,
  columnWidths,
  type DocBlock,
  type Inline,
} from "./report-doc";

// Terse readers so the assertions below stay about the grammar, not about
// walking the tree.
const text = (b: DocBlock): string =>
  b.k === "heading" || b.k === "para" ? inlineText(b.c) : "";
const kinds = (md: string) => parseReportDoc(md).map((b) => b.k);
const only = (md: string): DocBlock => {
  const blocks = parseReportDoc(md);
  expect(blocks).toHaveLength(1);
  return blocks[0];
};

describe("parseReportDoc — headings", () => {
  // The PDF's parseMarkdown split on `"### "` / `"## "` only. `"#### x"`
  // fails BOTH those startsWith checks (index 3 is `#`, not a space), so an
  // H4 printed its own hashes into the investor's document.
  it("recognises every level 1..4, including the two that used to print literally", () => {
    for (const [md, level] of [
      ["# One", 1],
      ["## Two", 2],
      ["### Three", 3],
      ["#### Four", 4],
    ] as const) {
      const b = only(md);
      expect(b.k).toBe("heading");
      if (b.k !== "heading") return;
      expect(b.level).toBe(level);
      expect(inlineText(b.c)).not.toContain("#");
    }
  });

  it("clamps deeper hashes to level 4 rather than dropping the line", () => {
    const b = only("##### Five");
    expect(b.k).toBe("heading");
    if (b.k !== "heading") return;
    expect(b.level).toBe(4);
    expect(inlineText(b.c)).toBe("Five");
  });

  it("treats a hash with no space as prose, not a heading", () => {
    expect(only("#NotAHeading").k).toBe("para");
  });

  it("applies inline markup inside a heading", () => {
    const b = only("## Treasury **overview**");
    if (b.k !== "heading") throw new Error("expected heading");
    expect(b.c.some((n) => n.t === "strong")).toBe(true);
  });
});

describe("parseReportDoc — the silent-drop regression", () => {
  // pdf-template.tsx:210 pushed a section only `if (currentHeading)`, so
  // everything before the first heading vanished from the PDF with no warning.
  it("keeps content that appears before the first heading", () => {
    const blocks = parseReportDoc("An opening line.\n\n## Section\n\nBody.");
    expect(blocks).toHaveLength(3);
    expect(text(blocks[0])).toBe("An opening line.");
    expect(blocks[1].k).toBe("heading");
  });

  it("keeps a document that has no headings at all", () => {
    expect(kinds("Just prose.\n\nMore prose.")).toEqual(["para", "para"]);
  });
});

describe("parseReportDoc — paragraphs", () => {
  // The two renderers disagreed outright: ReportPreview emitted one <p> per
  // SOURCE line, so a soft-wrapped paragraph rendered as a stack of them.
  it("joins a soft-wrapped run into ONE paragraph with single spaces", () => {
    const blocks = parseReportDoc("The treasury held\n$1.2M across\nfour wallets.");
    expect(blocks).toHaveLength(1);
    expect(text(blocks[0])).toBe("The treasury held $1.2M across four wallets.");
  });

  it("splits paragraphs on a blank line", () => {
    expect(kinds("One.\n\nTwo.")).toEqual(["para", "para"]);
  });

  it("ends a paragraph at a heading with no blank line between", () => {
    expect(kinds("Prose.\n## Heading")).toEqual(["para", "heading"]);
  });

  it("ends a paragraph at a bullet with no blank line between", () => {
    expect(kinds("Prose.\n- item")).toEqual(["para", "bullets"]);
  });

  it("ends a paragraph at a table with no blank line between", () => {
    expect(kinds("Prose.\n| A | B |\n| --- | --- |\n| 1 | 2 |")).toEqual([
      "para",
      "table",
    ]);
  });
});

describe("parseReportDoc — lists", () => {
  // Ordered lists were not a block kind in the PDF at all, so `1. / 2. / 3.`
  // collapsed into one run-on paragraph.
  it("parses an ordered list instead of collapsing it into prose", () => {
    const b = only("1. First\n2. Second\n3. Third");
    expect(b.k).toBe("ordered");
    if (b.k !== "ordered") return;
    expect(b.items).toHaveLength(3);
    expect(inlineText(b.items[0])).toBe("First");
  });

  it("preserves a start number other than 1", () => {
    const b = only("4. Fourth\n5. Fifth");
    if (b.k !== "ordered") throw new Error("expected ordered");
    expect(b.start).toBe(4);
  });

  it("accepts `)` as an ordered delimiter", () => {
    expect(only("1) First\n2) Second").k).toBe("ordered");
  });

  it("groups consecutive bullets into one list, for -, * and •", () => {
    for (const marker of ["-", "*", "•"]) {
      const b = only(`${marker} one\n${marker} two`);
      expect(b.k).toBe("bullets");
      if (b.k !== "bullets") return;
      expect(b.items).toHaveLength(2);
    }
  });

  it("strips indentation rather than nesting (flat by design)", () => {
    const b = only("- top\n    - indented");
    if (b.k !== "bullets") throw new Error("expected bullets");
    expect(b.items).toHaveLength(2);
    expect(inlineText(b.items[1])).toBe("indented");
  });

  it("does not read a horizontal rule as a bullet", () => {
    expect(only("---").k).toBe("rule");
    expect(only("- - -").k).toBe("rule");
    expect(only("***").k).toBe("rule");
  });

  it("does not read *emphasis* at line start as a bullet", () => {
    // A bullet marker requires trailing whitespace; `*italic*` has none.
    expect(only("*italic*").k).toBe("para");
  });
});

describe("parseReportDoc — tables", () => {
  const TABLE = [
    "| Asset | Value | Share |",
    "| :--- | ---: | :---: |",
    "| USDC | $934,909 | 39% |",
    "| RAD | $1,478,508 | 61% |",
  ].join("\n");

  it("parses head, rows and per-column alignment", () => {
    const b = only(TABLE);
    expect(b.k).toBe("table");
    if (b.k !== "table") return;
    expect(b.head.map(inlineText)).toEqual(["Asset", "Value", "Share"]);
    expect(b.rows).toHaveLength(2);
    expect(b.rows[1].map(inlineText)).toEqual(["RAD", "$1,478,508", "61%"]);
  });

  // Alignment was parsed for detection and then thrown away; every column
  // rendered left-aligned and `flex: 1` wide.
  it("keeps alignment instead of discarding it", () => {
    const b = only(TABLE);
    if (b.k !== "table") throw new Error("expected table");
    expect(b.align).toEqual(["left", "right", "center"]);
  });

  it("defaults a bare separator column to left", () => {
    const b = only("| A |\n| --- |\n| 1 |");
    if (b.k !== "table") throw new Error("expected table");
    expect(b.align).toEqual(["left"]);
  });

  // pdf-template.tsx:541-545 emitted `{h}` raw for header cells while body
  // cells went through renderInline, so `**Total**` printed its asterisks.
  it("runs header cells through the same inline pass as body cells", () => {
    const b = only("| **Total** |\n| --- |\n| **99** |");
    if (b.k !== "table") throw new Error("expected table");
    expect(b.head[0][0].t).toBe("strong");
    expect(b.rows[0][0][0].t).toBe("strong");
    expect(inlineText(b.head[0])).toBe("Total");
  });

  it("needs a separator — a bare pipe row is prose, not a table", () => {
    expect(only("| A | B |").k).toBe("para");
  });

  it("tolerates a ragged row shorter than the header", () => {
    const b = only("| A | B | C |\n| --- | --- | --- |\n| 1 |");
    if (b.k !== "table") throw new Error("expected table");
    expect(b.rows[0]).toHaveLength(1);
  });
});

describe("parseReportDoc — fenced code", () => {
  it("captures the body verbatim and the language tag", () => {
    const b = only("```ts\nconst a = **not bold**;\n```");
    expect(b.k).toBe("code");
    if (b.k !== "code") return;
    expect(b.lang).toBe("ts");
    expect(b.v).toBe("const a = **not bold**;");
  });

  it("still yields a block when the fence is never closed", () => {
    const b = only("```\nunterminated");
    expect(b.k).toBe("code");
    if (b.k !== "code") return;
    expect(b.v).toBe("unterminated");
    expect(b.lang).toBeNull();
  });
});

describe("parseInline — links", () => {
  it("renders http, https and mailto", () => {
    for (const href of [
      "http://x.io",
      "https://etherscan.io/tx/0xabc",
      "mailto:a@b.io",
    ]) {
      const nodes = parseInline(`see [here](${href})`);
      const link = nodes.find((n) => n.t === "link");
      expect(link, href).toBeDefined();
      if (link?.t !== "link") return;
      expect(link.href).toBe(href);
      expect(inlineText(link.c)).toBe("here");
    }
  });

  // contentMd is model output on an unauthenticated public page. A rejected
  // scheme must still show its words — degrade, never drop.
  it("refuses a javascript: URL but keeps the label as readable text", () => {
    const nodes = parseInline("click [here](javascript:alert(1))");
    expect(nodes.some((n) => n.t === "link")).toBe(false);
    expect(inlineText(nodes)).toBe("click here");
  });

  it("refuses data: and relative URLs the same way", () => {
    for (const href of ["data:text/html,<script>", "/dashboard", "//evil.io"]) {
      const nodes = parseInline(`[x](${href})`);
      expect(nodes.some((n) => n.t === "link"), href).toBe(false);
      expect(inlineText(nodes)).toBe("x");
    }
  });

  it("keeps a URL that legitimately contains parentheses intact", () => {
    const nodes = parseInline(
      "see [Radicle](https://en.wikipedia.org/wiki/Radicle_(software))"
    );
    const link = nodes.find((n) => n.t === "link");
    if (link?.t !== "link") throw new Error("expected link");
    expect(link.href).toBe("https://en.wikipedia.org/wiki/Radicle_(software)");
    // No dangling `)` left behind in the prose.
    expect(inlineText(nodes)).toBe("see Radicle");
  });

  it("consumes a rejected paren-bearing URL whole, leaving no stray punctuation", () => {
    const nodes = parseInline("click [here](javascript:alert(1))");
    expect(nodes.some((n) => n.t === "link")).toBe(false);
    expect(inlineText(nodes)).toBe("click here");
  });

  it("falls back to the URL as visible text when the label is empty", () => {
    const nodes = parseInline("[](https://vaultbrief.io)");
    const link = nodes.find((n) => n.t === "link");
    if (link?.t !== "link") throw new Error("expected link");
    expect(inlineText(link.c)).toBe("https://vaultbrief.io");
  });
});

describe("parseInline — emphasis and code", () => {
  it("parses bold, italic and code", () => {
    expect(parseInline("**b**")[0].t).toBe("strong");
    expect(parseInline("*i*")[0].t).toBe("em");
    expect(parseInline("_i_")[0].t).toBe("em");
    expect(parseInline("`c`")[0].t).toBe("code");
  });

  it("treats backtick contents as opaque to emphasis", () => {
    const nodes = parseInline("`**not bold**`");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].t).toBe("code");
    if (nodes[0].t !== "code") return;
    expect(nodes[0].v).toBe("**not bold**");
  });

  // A sequential-pass parser gets exactly one of these two orders wrong.
  // Scanning for the earliest match across all patterns is what fixes it.
  it("handles bold-then-italic and italic-then-bold identically", () => {
    const a = parseInline("**bold** and *it*").map((n) => n.t);
    const b = parseInline("*it* and **bold**").map((n) => n.t);
    expect(a).toEqual(["strong", "text", "em"]);
    expect(b).toEqual(["em", "text", "strong"]);
  });

  it("leaves snake_case alone", () => {
    const nodes = parseInline("field_name_here stays literal");
    expect(nodes.every((n) => n.t === "text")).toBe(true);
    expect(inlineText(nodes)).toBe("field_name_here stays literal");
  });

  it("does not italicise a mid-word asterisk", () => {
    expect(parseInline("2*3*4").every((n) => n.t === "text")).toBe(true);
  });

  it("keeps an unmatched delimiter as literal text", () => {
    expect(inlineText(parseInline("5 * 3 = 15"))).toBe("5 * 3 = 15");
    expect(inlineText(parseInline("**unclosed"))).toBe("**unclosed");
  });

  it("merges adjacent text runs rather than fragmenting them", () => {
    const nodes = parseInline("plain text with no markup at all");
    expect(nodes).toHaveLength(1);
  });

  it("returns nothing for an empty string", () => {
    expect(parseInline("")).toEqual([]);
  });
});

describe("parseReportDoc — input hygiene", () => {
  it("handles CRLF, empty input and whitespace-only input", () => {
    expect(kinds("# A\r\n\r\nBody.")).toEqual(["heading", "para"]);
    expect(parseReportDoc("")).toEqual([]);
    expect(parseReportDoc("   \n\n  \n")).toEqual([]);
  });

  it("never throws on adversarial punctuation", () => {
    for (const md of ["|||", "###", "```", "***", "[](", "**", "- ", "1."]) {
      expect(() => parseReportDoc(md), md).not.toThrow();
    }
  });
});

describe("docPlainText", () => {
  it("flattens every block kind to a single spaced string", () => {
    const md = [
      "# Title",
      "",
      "Body **text**.",
      "",
      "- one",
      "- two",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const out = docPlainText(parseReportDoc(md));
    expect(out).toBe("Title Body text. one two A B 1 2");
    expect(out).not.toContain("**");
    expect(out).not.toContain("|");
  });

  it("collapses runs of whitespace", () => {
    expect(docPlainText(parseReportDoc("a\n\n\n\nb"))).toBe("a b");
  });
});

describe("columnWidths", () => {
  const cells = (...v: string[]): Inline[][] => v.map((s) => [{ t: "text", v: s }]);

  it("always sums to 1", () => {
    for (const head of [cells("A"), cells("A", "B"), cells(...Array(10).fill("X"))]) {
      const w = columnWidths([], head, []);
      expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    }
  });

  it("gives a single column the whole width", () => {
    expect(columnWidths(["left"], cells("Only"), [])).toEqual([1]);
  });

  it("gives a wide address column more room than a narrow percentage column", () => {
    const head = cells("Wallet", "%");
    const rows = [cells("0xcC7d34C76A9d08aa0109F7Bae35f29C1CE35355A", "61%")];
    const [wallet, pct] = columnWidths(["left", "right"], head, rows);
    expect(wallet).toBeGreaterThan(pct);
  });

  it("never starves a column below the floor, even against a long address", () => {
    const head = cells("Wallet", "%");
    const rows = [cells("0x" + "a".repeat(200), "1%")];
    const w = columnWidths(["left", "right"], head, rows);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(0.05);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
  });

  it("spreads ten equal columns evenly", () => {
    const head = cells(...Array(10).fill("X"));
    const w = columnWidths([], head, []);
    for (const x of w) expect(x).toBeCloseTo(0.1, 6);
  });

  it("survives an empty table", () => {
    const w = columnWidths([], [], []);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
  });
});
