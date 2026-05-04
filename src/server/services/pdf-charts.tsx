import React from "react";
import { Svg, Path, Rect, Line, Text as SvgText, G } from "@react-pdf/renderer";

/**
 * Native React-PDF SVG chart primitives. Zero external deps so this works
 * inside the same Lambda that renders the rest of the report.
 *
 * Components:
 *   <TreasuryPie />       — composition donut (Stables / ETH / Native / Other).
 *                          Renders on any snapshot with at least one non-zero slice.
 *   <ChainSplit />        — horizontal stacked bar: balance by chain.
 *                          Phase A populated `balancesByChain`; this surfaces it.
 *   <TrendBars />         — last-N months totals as a vertical bar chart.
 *                          Skips render when fewer than 2 data points.
 *   <GitHubSparkline />   — tiny commits-by-month line. Same skip rule.
 *
 * Conventions:
 * - Colors come from a small palette + the project's accent (passed in).
 * - All sizes are in PDF points (72pt = 1 inch). A4 page width minus 144pt
 *   of horizontal padding leaves ~451pt usable, so charts default to ~420pt
 *   max width.
 * - Text labels use Helvetica — same default the rest of the PDF template
 *   uses, so we don't ship custom fonts just for charts.
 */

const PALETTE = {
  bgGrid: "#E5E7EB",
  textBody: "#374151",
  textMid: "#6B7280",
  // Pie / chain palette. Keep these distinct under 8% lightness deltas so
  // adjacent slices don't blur on monochrome printers.
  series: [
    "#6366F1", // indigo
    "#10B981", // emerald
    "#F59E0B", // amber
    "#EF4444", // red
    "#8B5CF6", // violet
    "#06B6D4", // cyan
    "#EC4899", // pink
    "#84CC16", // lime
  ],
  chains: {
    ethereum: "#627EEA",
    polygon: "#8247E5",
    arbitrum: "#28A0F0",
    base: "#0052FF",
    optimism: "#FF0420",
    solana: "#9945FF",
  } as Record<string, string>,
};

// ─── TreasuryPie ──────────────────────────────────────────────────────────

interface PieSlice {
  label: string;
  value: number;
}

export function TreasuryPie({
  data,
  size = 140,
  accent,
}: {
  data: PieSlice[];
  size?: number;
  accent?: string;
}) {
  const slices = data.filter((s) => s.value > 0);
  const total = slices.reduce((a, b) => a + b.value, 0);
  if (slices.length === 0 || total === 0) return null;

  // Donut (inner cutout) reads more modern than a flat pie.
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const inner = r * 0.55;

  let startAngle = -Math.PI / 2; // start at top
  const segs = slices.map((s, i) => {
    const angle = (s.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const path = donutSlicePath(cx, cy, r, inner, startAngle, endAngle);
    const color =
      i === 0 && accent ? accent : PALETTE.series[i % PALETTE.series.length];
    const seg = { path, color, label: s.label, value: s.value, percent: s.value / total };
    startAngle = endAngle;
    return seg;
  });

  return (
    <Svg width={size + 220} height={size}>
      {/* Donut */}
      <G>
        {segs.map((s, i) => (
          <Path key={i} d={s.path} fill={s.color} />
        ))}
      </G>
      {/* Legend on the right */}
      <G>
        {segs.map((s, i) => {
          const y = 8 + i * 22;
          return (
            <G key={i}>
              <Rect x={size + 14} y={y} width={10} height={10} fill={s.color} rx={2} />
              <SvgText
                x={size + 30}
                y={y + 8}
                style={{ fontFamily: "Helvetica", fontSize: 9, fill: PALETTE.textBody }}
              >
                {s.label}
              </SvgText>
              <SvgText
                x={size + 30}
                y={y + 19}
                style={{ fontFamily: "Helvetica", fontSize: 8, fill: PALETTE.textMid }}
              >
                {`${(s.percent * 100).toFixed(1)}%`}
              </SvgText>
            </G>
          );
        })}
      </G>
    </Svg>
  );
}

// SVG arc helper. React-PDF supports SVG path "d" strings directly, which is
// the cleanest way to draw a donut wedge.
function donutSlicePath(
  cx: number,
  cy: number,
  r: number,
  inner: number,
  start: number,
  end: number
): string {
  const startOuter = polar(cx, cy, r, start);
  const endOuter = polar(cx, cy, r, end);
  const startInner = polar(cx, cy, inner, end);
  const endInner = polar(cx, cy, inner, start);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}
function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

// ─── ChainSplit ───────────────────────────────────────────────────────────

export function ChainSplit({
  data,
  width = 420,
  height = 24,
}: {
  data: Array<{ chain: string; value: number }>;
  width?: number;
  height?: number;
}) {
  const items = data.filter((d) => d.value > 0);
  if (items.length < 2) return null;
  const total = items.reduce((s, d) => s + d.value, 0);

  // Build segments left to right.
  let x = 0;
  const segs = items
    .sort((a, b) => b.value - a.value)
    .map((d) => {
      const w = (d.value / total) * width;
      const seg = {
        x,
        w,
        chain: d.chain,
        value: d.value,
        percent: d.value / total,
        color: PALETTE.chains[d.chain] ?? "#666",
      };
      x += w;
      return seg;
    });

  // Legend two-line per chain underneath.
  const legendCols = Math.min(items.length, 4);
  const legendW = width / legendCols;
  const legendY = height + 14;

  return (
    <Svg width={width} height={legendY + 24}>
      {/* Bar */}
      {segs.map((s, i) => (
        <Rect
          key={i}
          x={s.x}
          y={0}
          width={s.w}
          height={height}
          fill={s.color}
        />
      ))}
      {/* Rounded corners hack: overlay a transparent rect with stroke */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="none"
        stroke="#E5E7EB"
        strokeWidth={0.5}
        rx={4}
      />
      {/* Legend */}
      {segs.slice(0, legendCols).map((s, i) => (
        <G key={i}>
          <Rect
            x={i * legendW}
            y={legendY}
            width={8}
            height={8}
            fill={s.color}
            rx={1.5}
          />
          <SvgText
            x={i * legendW + 14}
            y={legendY + 7}
            style={{
              fontFamily: "Helvetica-Bold",
              fontSize: 8,
              fill: PALETTE.textBody,
            }}
          >
            {capitalize(s.chain)}
          </SvgText>
          <SvgText
            x={i * legendW + 14}
            y={legendY + 18}
            style={{ fontFamily: "Helvetica", fontSize: 8, fill: PALETTE.textMid }}
          >
            {`${(s.percent * 100).toFixed(0)}%`}
          </SvgText>
        </G>
      ))}
    </Svg>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── TrendBars ────────────────────────────────────────────────────────────

interface TrendPoint {
  date: string; // "YYYY-MM"
  value: number;
}

export function TrendBars({
  data,
  width = 420,
  height = 110,
  yLabel = "Treasury",
  accent,
}: {
  data: TrendPoint[];
  width?: number;
  height?: number;
  yLabel?: string;
  accent?: string;
}) {
  if (data.length < 2) return null; // single-month projects: nothing to trend.

  const padL = 36;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const max = Math.max(...data.map((d) => d.value));
  const min = 0; // always anchor at zero so $73M doesn't visually look like "lost half"
  const range = max - min || 1;

  const barGap = 4;
  const barW = (innerW - barGap * (data.length - 1)) / data.length;
  const color = accent ?? "#10B981";

  return (
    <Svg width={width} height={height}>
      {/* Y-axis tick labels (3 labels: 0, mid, max) */}
      <SvgText
        x={padL - 4}
        y={padT + 6}
        textAnchor="end"
        style={{ fontFamily: "Helvetica", fontSize: 7, fill: PALETTE.textMid }}
      >
        {abbrev(max)}
      </SvgText>
      <SvgText
        x={padL - 4}
        y={padT + innerH / 2 + 3}
        textAnchor="end"
        style={{ fontFamily: "Helvetica", fontSize: 7, fill: PALETTE.textMid }}
      >
        {abbrev((max + min) / 2)}
      </SvgText>
      <SvgText
        x={padL - 4}
        y={padT + innerH + 3}
        textAnchor="end"
        style={{ fontFamily: "Helvetica", fontSize: 7, fill: PALETTE.textMid }}
      >
        {abbrev(min)}
      </SvgText>
      {/* Horizontal grid lines */}
      <Line
        x1={padL}
        y1={padT + innerH}
        x2={padL + innerW}
        y2={padT + innerH}
        stroke={PALETTE.bgGrid}
        strokeWidth={0.5}
      />
      <Line
        x1={padL}
        y1={padT + innerH / 2}
        x2={padL + innerW}
        y2={padT + innerH / 2}
        stroke={PALETTE.bgGrid}
        strokeWidth={0.5}
      />
      <Line
        x1={padL}
        y1={padT}
        x2={padL + innerW}
        y2={padT}
        stroke={PALETTE.bgGrid}
        strokeWidth={0.5}
      />
      {/* Bars */}
      {data.map((d, i) => {
        const h = ((d.value - min) / range) * innerH;
        const x = padL + i * (barW + barGap);
        const y = padT + innerH - h;
        return (
          <G key={i}>
            <Rect x={x} y={y} width={barW} height={h} fill={color} rx={2} />
            <SvgText
              x={x + barW / 2}
              y={padT + innerH + 14}
              textAnchor="middle"
              style={{
                fontFamily: "Helvetica",
                fontSize: 7,
                fill: PALETTE.textMid,
              }}
            >
              {shortMonth(d.date)}
            </SvgText>
          </G>
        );
      })}
      {/* Y label */}
      <SvgText
        x={4}
        y={padT + innerH / 2}
        style={{
          fontFamily: "Helvetica-Bold",
          fontSize: 7,
          fill: PALETTE.textMid,
        }}
        transform={`rotate(-90 4 ${padT + innerH / 2})`}
      >
        {yLabel}
      </SvgText>
    </Svg>
  );
}

function abbrev(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function shortMonth(yyyymm: string): string {
  // Accepts "2026-04" or "2026-04-30" → "Apr"
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = parseInt(yyyymm.slice(5, 7), 10);
  return months[m - 1] ?? "?";
}

// ─── GitHubSparkline ──────────────────────────────────────────────────────

export function GitHubSparkline({
  data,
  width = 200,
  height = 36,
  accent,
}: {
  data: number[];
  width?: number;
  height?: number;
  accent?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const stepX = width / (data.length - 1);
  const stroke = accent ?? "#10B981";
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  });
  const linePath = `M ${points.join(" L ")}`;
  // Filled area under line.
  const areaPath = `M 0,${height} L ${points.join(" L ")} L ${width},${height} Z`;
  return (
    <Svg width={width} height={height}>
      <Path d={areaPath} fill={stroke} fillOpacity={0.15} />
      <Path d={linePath} stroke={stroke} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}
