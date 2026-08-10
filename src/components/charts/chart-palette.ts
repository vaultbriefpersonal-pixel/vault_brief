// Colours for the two Recharts components, as data rather than CSS.
//
// Recharts passes `stroke`/`fill` through as SVG PRESENTATION ATTRIBUTES, and
// `var(--token)` is not valid in one. So the `.vb-doc` scope that re-themes
// every other widget for free cannot reach these two, and they need an
// explicit palette threaded in.
//
// Fixing that also retires the palette they shipped with: #1e293b grid,
// #6366F1 area, #f59e0b bars — Tailwind slate/indigo/amber, chosen
// independently of the product's own tokens and matching neither the dark
// dashboard nor the light document.

import { DOC_LIGHT } from "@/lib/report-theme";

export interface ChartPalette {
  grid: string;
  axis: string;
  /** Primary series — line/area stroke, bar fill. */
  series: string;
  /** Secondary series, used by the burn chart so the two read as a pair. */
  seriesAlt: string;
  /**
   * Distinct hues for a chart whose slices are CATEGORIES, not a measure —
   * the expense and income pies. Indexed modulo its length, so order is
   * stable but length is not a promise; keep the hues far enough apart that
   * two adjacent slices never read as the same colour.
   */
  categorical: readonly string[];
  /**
   * Categories that are all GOOD news — the income pie. Kept cool and green
   * on purpose so income reads at a glance as the positive counterpart to the
   * warmer expense split; that pairing is a deliberate design choice, which is
   * why income does not simply reuse `categorical`.
   */
  categoricalPositive: readonly string[];
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

/** The dashboard. Now sourced from the product's own dark tokens. */
export const DARK_CHART_PALETTE: ChartPalette = {
  grid: "#1f1f1f",
  axis: "#888888",
  series: "#00e87b",
  seriesAlt: "#f0b847",
  tooltipBg: "#161616",
  tooltipBorder: "rgba(255,255,255,0.12)",
  tooltipText: "#f0f0f0",
  // Led by the brand green, then hues spaced far enough apart to stay
  // separable on the dark card. This replaces the last of the Tailwind
  // slate/indigo ramp the two pies were still filling their slices with —
  // Stage 19.4 moved their tooltips and axes onto these tokens but left the
  // fills behind, which is why an indigo wedge was still on the Overview.
  categorical: [
    "#00e87b",
    "#4cc9f0",
    "#b388ff",
    "#ff6b9d",
    "#f0b847",
    "#9ef01a",
    "#f4523b",
  ],
  // Re-anchored on the brand green. Previously Tailwind's emerald ramp, which
  // carried the right MEANING but none of the product's colour.
  categoricalPositive: [
    "#00e87b",
    "#34d9a4",
    "#48d6c8",
    "#4cc9f0",
    "#3aa8e0",
    "#9ef01a",
  ],
};

/** The report document. Matches pdf-charts.tsx so both renderings agree. */
export const DOC_CHART_PALETTE: ChartPalette = {
  grid: DOC_LIGHT.line,
  axis: DOC_LIGHT.inkFaint,
  series: DOC_LIGHT.info,
  seriesAlt: DOC_LIGHT.warn,
  tooltipBg: DOC_LIGHT.paperRaised,
  tooltipBorder: DOC_LIGHT.lineStrong,
  tooltipText: DOC_LIGHT.ink,
  // The document's own semantic inks first, then three further muted darks.
  // Deliberately not the dark palette's brighter hues: on paper those read as
  // highlighter, and this surface is meant to look printed.
  categorical: [
    DOC_LIGHT.info,
    DOC_LIGHT.ok,
    DOC_LIGHT.warn,
    DOC_LIGHT.danger,
    "#4A4370",
    "#6B7A2E",
    "#7A3B5C",
  ],
  categoricalPositive: [
    DOC_LIGHT.ok,
    "#27584A",
    "#2F6B63",
    DOC_LIGHT.info,
    "#3A5F7A",
    "#5A7A3A",
  ],
};
