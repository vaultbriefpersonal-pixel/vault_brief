"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatUsd } from "@/lib/utils";
import { DARK_CHART_PALETTE } from "./chart-palette";

/**
 * Expense split for the project Overview.
 *
 * WHY `isAnimationActive={false}`. This chart rendered as an invisible
 * horizontal hairline in production while its legend stayed perfectly
 * populated. Diagnosed live: the sectors WERE computed (5 of them, correct
 * values, real numbers) but the rendered `<g>` was empty, with
 * `isAnimationActive: "auto"` — a Recharts >= 3.9 value. package.json asks for
 * `^3.8.1` and the lockfile resolves 3.10.1, whose rewritten
 * `AnimatedItems`/`useAnimationId` engine re-keys the animation on every
 * render of the Pie; if the chart re-renders faster than the 400ms
 * `animationBegin`, it never leaves frame 0 and paints nothing at all. The
 * legend is built from a separate selector, which is why it looked fine and
 * hid the fault.
 *
 * Turning the entrance animation off makes the animator initialise at the
 * final geometry. Pinning recharts to 3.8.x would be the alternative, but that
 * touches every chart in the product to fix two — and a treasury breakdown has
 * nothing to gain from an entrance animation anyway.
 */
const COLORS = DARK_CHART_PALETTE.categorical;

interface ExpenseBreakdownProps {
  data: Record<string, number>;
}

export function ExpenseBreakdown({ data }: ExpenseBreakdownProps) {
  // `Number(v)` before comparing: this reads a JSONB column, and a string
  // "1234" passes `> 0` unharmed but then contributes 0 to Recharts' own sum,
  // which collapses the whole pie. Not the cause of the blank chart above, but
  // every other consumer of `expenses_by_category` already coerces
  // (ReportWidgets' `num()`, report-derived's `Number(...)`) and this was the
  // one that did not.
  const entries = Object.entries(data)
    .map(([name, v]) => [name, Number(v)] as const)
    .filter(([, v]) => Number.isFinite(v) && v > 0);

  if (entries.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
        No expense data yet
      </div>
    );
  }

  const chartData = entries.map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
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
          // Was a hand-picked Tailwind slate set. Stage 18.7 moved every other
          // chart onto the shared palette and missed these two files.
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
