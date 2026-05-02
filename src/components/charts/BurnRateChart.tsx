"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatUsd } from "@/lib/utils";

interface DataPoint {
  date: string;
  burnRateUsd: number;
}

interface BurnRateChartProps {
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
        color: "#555",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

export function BurnRateChart({ data }: BurnRateChartProps) {
  if (data.length === 0) {
    return (
      <EmptyState>
        No transactions tracked yet. Burn rate appears after the first sync.
      </EmptyState>
    );
  }
  if (data.length === 1) {
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
            color: "#f0f0f0",
          }}
        >
          {formatUsd(point.burnRateUsd)}
        </span>
        <span style={{ color: "#888", fontSize: 12 }}>{point.date}</span>
        <span style={{ color: "#555", fontSize: 11, marginTop: 4 }}>
          Trend chart appears after the second monthly snapshot.
        </span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
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
          formatter={(value) => [formatUsd(Number(value ?? 0)), "Burn rate"]}
        />
        <Bar dataKey="burnRateUsd" fill="#f59e0b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
