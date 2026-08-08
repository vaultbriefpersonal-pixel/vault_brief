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
};
