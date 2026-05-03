import type { TreasurySnapshot } from "@/server/db/schema";

export type AnomalySeverity = "minor" | "significant" | "critical";

export interface Anomaly {
  metric: string; // human-readable, "Burn rate" / "Stablecoins" / "Expense: payroll"
  current: number;
  baseline: number; // trailing avg
  changePct: number; // (current - baseline) / baseline * 100
  severity: AnomalySeverity;
  newCategory?: boolean; // true when this metric had no prior history
}

const MINOR_THRESHOLD_PCT = 30;
const SIGNIFICANT_THRESHOLD_PCT = 50;
const CRITICAL_THRESHOLD_PCT = 100;
const MIN_ABSOLUTE_USD = 1000; // ignore noise below this

function severityFor(absPct: number): AnomalySeverity | null {
  if (absPct < MINOR_THRESHOLD_PCT) return null;
  if (absPct < SIGNIFICANT_THRESHOLD_PCT) return "minor";
  if (absPct < CRITICAL_THRESHOLD_PCT) return "significant";
  return "critical";
}

function compareMetric(
  metric: string,
  current: number,
  baselines: number[]
): Anomaly | null {
  const validBaselines = baselines.filter((v) => v > 0);

  // No history at all — flag if the value is materially non-zero (could be a
  // launch or first inflow of this category).
  if (validBaselines.length === 0) {
    if (current > MIN_ABSOLUTE_USD) {
      return {
        metric,
        current,
        baseline: 0,
        changePct: 100,
        severity: "minor",
        newCategory: true,
      };
    }
    return null;
  }

  const baseline = validBaselines.reduce((a, b) => a + b, 0) / validBaselines.length;
  if (Math.abs(current - baseline) < MIN_ABSOLUTE_USD) return null;

  const changePct = ((current - baseline) / baseline) * 100;
  const severity = severityFor(Math.abs(changePct));
  if (!severity) return null;

  return { metric, current, baseline, changePct, severity };
}

/**
 * Compares the current snapshot against trailing N snapshots (default 3 prior
 * months). Returns anomalies (>=30% deviation OR new category) for the LLM
 * to highlight in the report. If `prevSnapshots` is empty, returns []
 * (nothing to compare against — first snapshot ever).
 */
export function detectAnomalies(
  current: TreasurySnapshot,
  prevSnapshots: TreasurySnapshot[]
): Anomaly[] {
  if (prevSnapshots.length === 0) return [];

  const anomalies: Anomaly[] = [];

  // Top-level metrics
  const totals: Array<[string, (s: TreasurySnapshot) => number]> = [
    ["Total balance", (s) => Number(s.totalBalanceUsd ?? 0)],
    ["Burn rate", (s) => Number(s.burnRateUsd ?? 0)],
    ["Stablecoins", (s) => Number(s.stablecoinsUsd ?? 0)],
    ["Total inflows", (s) => Number(s.totalInflowsUsd ?? 0)],
  ];
  for (const [name, getter] of totals) {
    const a = compareMetric(name, getter(current), prevSnapshots.map(getter));
    if (a) anomalies.push(a);
  }

  // Per-category expense deltas
  const currentExpenses = (current.expensesByCategory ?? {}) as Record<string, number>;
  const allExpenseCategories = new Set<string>(Object.keys(currentExpenses));
  for (const s of prevSnapshots) {
    const exp = (s.expensesByCategory ?? {}) as Record<string, number>;
    for (const k of Object.keys(exp)) allExpenseCategories.add(k);
  }
  for (const cat of allExpenseCategories) {
    if (cat === "token_sale") continue; // treasury op, not expense — skip
    const cur = currentExpenses[cat] ?? 0;
    const baselines = prevSnapshots.map((s) => {
      const exp = (s.expensesByCategory ?? {}) as Record<string, number>;
      return exp[cat] ?? 0;
    });
    const a = compareMetric(`Expense: ${cat}`, cur, baselines);
    if (a) anomalies.push(a);
  }

  // Sort: critical first, then significant, then minor; within same severity,
  // largest absolute change first.
  const severityRank: Record<AnomalySeverity, number> = {
    critical: 0,
    significant: 1,
    minor: 2,
  };
  anomalies.sort((a, b) => {
    const sd = severityRank[a.severity] - severityRank[b.severity];
    if (sd !== 0) return sd;
    return Math.abs(b.changePct) - Math.abs(a.changePct);
  });

  return anomalies;
}

export function formatAnomaliesForPrompt(anomalies: Anomaly[]): string {
  if (anomalies.length === 0) return "";
  const lines = anomalies.map((a) => {
    const dir = a.changePct > 0 ? "+" : "";
    if (a.newCategory) {
      return `- ${a.metric}: $${a.current.toFixed(0)} (no prior history — first occurrence)`;
    }
    return `- ${a.metric}: $${a.baseline.toFixed(0)} → $${a.current.toFixed(0)} (${dir}${a.changePct.toFixed(0)}%, ${a.severity})`;
  });
  return `\n## Anomalies (vs trailing-${Math.min(anomalies.length, 3)} avg)\n${lines.join("\n")}`;
}
