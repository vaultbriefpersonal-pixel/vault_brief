"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatUsd } from "@/lib/utils";

// Green/teal palette so income reads at a glance as the positive counterpart
// to the warm Expense breakdown chart.
const COLORS = [
  "#10b981",
  "#22c55e",
  "#34d399",
  "#06b6d4",
  "#0ea5e9",
  "#84cc16",
];

interface IncomeBreakdownProps {
  data: Record<string, number>;
}

export function IncomeBreakdown({ data }: IncomeBreakdownProps) {
  const entries = Object.entries(data).filter(([, v]) => v > 0);

  if (entries.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
        No income recorded this period
      </div>
    );
  }

  // Capitalize and humanize underscored category names (e.g. "funding_round" → "Funding round").
  const chartData = entries.map(([name, value]) => ({
    name:
      name.charAt(0).toUpperCase() +
      name.slice(1).replace(/_/g, " "),
    value,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={70}
          strokeWidth={0}
        >
          {chartData.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 8,
            color: "#e2e8f0",
          }}
          formatter={(value) => [formatUsd(Number(value ?? 0))]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => (
            <span style={{ color: "#94a3b8", fontSize: 11 }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
