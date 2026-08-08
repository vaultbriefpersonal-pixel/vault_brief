"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatUsd } from "@/lib/utils";
import { DARK_CHART_PALETTE } from "./chart-palette";

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

/**
 * Income split for the project Overview. The twin of ExpenseBreakdown — see
 * that file for why the entrance animation is disabled and why the values are
 * coerced; both components had the identical defect and the identical fix.
 */
export function IncomeBreakdown({ data }: IncomeBreakdownProps) {
  const entries = Object.entries(data)
    .map(([name, v]) => [name, Number(v)] as const)
    .filter(([, v]) => Number.isFinite(v) && v > 0);

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
          isAnimationActive={false}
        >
          {chartData.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: DARK_CHART_PALETTE.tooltipBg,
            border: `1px solid ${DARK_CHART_PALETTE.tooltipBorder}`,
            borderRadius: 8,
            color: DARK_CHART_PALETTE.tooltipText,
          }}
          formatter={(value) => [formatUsd(Number(value ?? 0))]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => (
            <span style={{ color: DARK_CHART_PALETTE.axis, fontSize: 11 }}>
              {value}
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
