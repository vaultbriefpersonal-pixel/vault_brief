"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatUsd } from "@/lib/utils";
import { DARK_CHART_PALETTE, type ChartPalette } from "./chart-palette";

interface DataPoint {
  date: string;
  totalBalanceUsd: number;
}

interface TreasuryChartProps {
  /** Omit on the dashboard; the report page passes DOC_CHART_PALETTE.
   *  Recharts writes these as SVG presentation attributes, where var() is
   *  invalid — so the .vb-doc token scope cannot reach this component. */
  palette?: ChartPalette;
  data: DataPoint[];
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "0 16px",
        color: "var(--vb-dim)",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

export function TreasuryChart({ data, palette = DARK_CHART_PALETTE }: TreasuryChartProps) {
  if (data.length === 0) {
    return <EmptyState>No data yet — sync your wallets to see treasury history.</EmptyState>;
  }
  if (data.length === 1) {
    // Single data point makes for a degenerate chart; show the value plainly
    // and explain the chart will populate over time.
    const point = data[0];
    return (
      <div
        style={{
          height: 200,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: 28,
            fontWeight: 700,
            color: "var(--vb-text)",
          }}
        >
          {formatUsd(point.totalBalanceUsd)}
        </span>
        <span style={{ color: "var(--vb-muted)", fontSize: 12 }}>{point.date}</span>
        <span style={{ color: "var(--vb-dim)", fontSize: 11, marginTop: 4 }}>
          Chart appears after the second monthly snapshot.
        </span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="treasury" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={palette.series} stopOpacity={0.3} />
            <stop offset="95%" stopColor={palette.series} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} />
        <XAxis
          dataKey="date"
          tick={{ fill: palette.axis, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatUsd(v)}
          tick={{ fill: palette.axis, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: palette.tooltipBg,
            border: `1px solid ${palette.tooltipBorder}`,
            borderRadius: 8,
            color: "#e2e8f0",
          }}
          formatter={(value) => [formatUsd(Number(value ?? 0)), "Treasury"]}
        />
        <Area
          type="monotone"
          dataKey="totalBalanceUsd"
          stroke={palette.series}
          strokeWidth={2}
          fill="url(#treasury)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
