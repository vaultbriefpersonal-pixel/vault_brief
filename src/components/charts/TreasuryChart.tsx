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

interface DataPoint {
  date: string;
  totalBalanceUsd: number;
}

interface TreasuryChartProps {
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

export function TreasuryChart({ data }: TreasuryChartProps) {
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
            <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#64748b", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatUsd(v)}
          tick={{ fill: "#64748b", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 8,
            color: "#e2e8f0",
          }}
          formatter={(value) => [formatUsd(Number(value ?? 0)), "Treasury"]}
        />
        <Area
          type="monotone"
          dataKey="totalBalanceUsd"
          stroke="#6366F1"
          strokeWidth={2}
          fill="url(#treasury)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
