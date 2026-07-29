// The derived views a report is built from, and the context they read.
//
// Everything here answers one question about the reporting period from the
// stored snapshot rows, and answers it ONCE. Two consumers sit above this
// module — `report-sections.ts` (prompt composition) and `report-evidence.ts`
// (the evidence ledger) — and both route every derived figure through these
// accessors rather than recomputing it.
//
// That discipline is the whole reason the module exists. A section that gates
// on "under 3 months of stablecoin cover" and then prints 3.4 months is worse
// than a section that never fired; a ledger that offers "flow-driven growth"
// as a win while the fragment beside it quotes a price-driven figure is a
// false statement in an investor report. Neither is reachable when the gate
// and the fragment read the same function.
//
// Why it is its own file rather than living in report-sections.ts: both
// consumers need it, and report-sections.ts needs report-evidence.ts, so
// keeping these helpers up there made the two modules mutually importing.
// That cycle worked, but it put a bundler-order landmine in the file every
// phase touches — and because report-sections.ts reaches the browser through
// ReportTemplateEditor.tsx ("use client"), the failure mode would have been an
// `undefined` at module init rather than a compile error. The dependency graph
// is now a DAG and reads downward:
//
//     report-derived.ts        (this file — imports pure services only)
//        ↑              ↑
//     report-evidence.ts       (imports report-derived)
//        ↑
//     report-sections.ts       (imports both)
//
// Deliberately dependency-free, like the pure services it composes: no
// `@/server/db` values, no `openai`, no `node:*`, no `process.env`. This file
// is in the client-bundle graph. `import type` on the schema is erased at
// build and is therefore fine; a value import from there would not be.

import type {
  TreasurySnapshot,
  Project,
  Milestone,
  Grant,
  GovernanceProposal,
  Partner,
  Ask,
  QaHighlight,
} from "@/server/db/schema";
import { formatUsd } from "@/lib/utils";
import {
  attributeTreasuryChange,
  type TreasuryAttribution,
} from "./treasury-attribution";
import {
  analyzeTreasuryLiquidity,
  type TreasuryLiquidity,
} from "./treasury-liquidity";
import { trailingAverageBurn } from "./burn-metrics";
import type { Anomaly } from "./anomalies";

// ─── the context ───────────────────────────────────────────────────────────

/**
 * Everything a section or an evidence signal is allowed to read about the
 * period, assembled once per report in prompts.ts.
 *
 * It lives here rather than in report-sections.ts because both consumers take
 * it as their parameter type, and the module that owns a type should be the
 * one neither consumer has to reach through. `report-sections.ts` re-exports
 * it, so every existing import path still resolves.
 */
export interface ReportSectionContext {
  snapshot: TreasurySnapshot;
  prevSnapshot: TreasurySnapshot | undefined | null;
  /**
   * Prior snapshots in chronological order, most-recent-first, EXCLUDING the
   * current one — so `trailing[0]` is the same row as `prevSnapshot`. Sections
   * needing a series rather than a single comparison (trailing burn average,
   * burn trend, a mechanical projection) read this instead of re-querying.
   * May be shorter than requested, or empty, on a young project.
   */
  trailing: TreasurySnapshot[];
  project: Project;
  milestones: Milestone[];
  /** 'YYYY-MM' derived from snapshot.snapshotDate; used for period match. */
  period: string;
  grants: Grant[];
  governanceProposals: GovernanceProposal[];
  partners: Partner[];
  asks: Ask[];
  qaHighlights: QaHighlight[];
  /**
   * Detected anomalies for this snapshot, from `detectAnomalies(snapshot,
   * trailing)`. Travels in the context so the anomalies section owns both
   * halves of its rendering like every other section: previously the data was
   * concatenated onto the user prompt in report-generator.ts, which meant
   * disabling the section stripped its rules (including "Don't fabricate
   * causes") while the figures still reached the model.
   */
  anomalies: Anomaly[];
  /** Total balance in USD, computed once. */
  total: number;
  /** Minimum balance to be worth mentioning (0.1% of total). */
  minSignificant: number;
}

// ─── shared formatter ──────────────────────────────────────────────────────

/**
 * `formatUsd` already carries the minus sign; the explicit plus is what stops
 * a positive figure from reading as a bare magnitude. Signed components are
 * the whole point of an attribution — "$4.9M of price movement" and
 * "-$4.9M of price movement" are opposite stories, and a model that reads
 * one as the other writes a false sentence into an investor update.
 */
export function signedUsd(amount: number): string {
  return amount > 0 ? `+${formatUsd(amount)}` : formatUsd(amount);
}

// ─── liquidity + burn basis ────────────────────────────────────────────────

/** Window for the trailing burn average. Matches the dashboard's burn tile. */
export const TRAILING_BURN_MONTHS = 3;

/** Below this many months of stablecoin cover, the concentration section fires. */
export const STABLE_COVER_FLOOR_MONTHS = 3;

/**
 * Own-token share of the treasury, in percent, above which concentration is
 * material enough to name. A fifth of the balance sheet is the point at which
 * the reported total stops being a fair proxy for what the project can spend.
 */
export const CONCENTRATION_PCT_FLOOR = 20;

export function liquidityOf(ctx: ReportSectionContext): TreasuryLiquidity {
  return analyzeTreasuryLiquidity(ctx.snapshot.balancesDetail, ctx.project);
}

export interface BurnBasis {
  /** The denominator to divide reserves by. 0 when there is no usable burn. */
  avgUsd: number;
  /** Prior months that contributed. 0 unless `source` is "trailing". */
  monthsUsed: number;
  /**
   * Which figure `avgUsd` actually is — the label the report must print. A
   * one-month figure presented as a trailing average is a false statement
   * about the evidence, even when the number is identical.
   */
  source: "trailing" | "current" | "none";
}

/**
 * The best available burn denominator, in preference order: the trailing
 * average, then this period's burn, then nothing. The fallback exists because
 * a project on its first or second report has no trailing history and would
 * otherwise get no liquid runway figure at all — which is the very number this
 * work exists to surface. The `source` field is what keeps the fallback
 * honest: it is disclosed in the fragment, never silently substituted.
 */
export function burnBasis(ctx: ReportSectionContext): BurnBasis {
  const trailing = trailingAverageBurn(ctx.trailing, TRAILING_BURN_MONTHS);
  if (trailing.monthsUsed > 0) {
    return {
      avgUsd: trailing.avgUsd,
      monthsUsed: trailing.monthsUsed,
      source: "trailing",
    };
  }
  const current = Number(ctx.snapshot.burnRateUsd ?? 0);
  if (Number.isFinite(current) && current > 0) {
    return { avgUsd: current, monthsUsed: 0, source: "current" };
  }
  return { avgUsd: 0, monthsUsed: 0, source: "none" };
}

/** Human label for the denominator, used inside the runway bullet itself. */
export function burnBasisLabel(basis: BurnBasis): string {
  if (basis.source === "trailing") {
    return `trailing ${basis.monthsUsed}-mo avg burn`;
  }
  return "this month's burn (no trailing history yet)";
}

// ─── attribution + net flow ────────────────────────────────────────────────

/**
 * Memoized per context object, because attribution is the one derived view
 * here that is genuinely expensive — it walks every token in both snapshots'
 * `balances_detail` payloads — and it now has four callers on identical
 * inputs (Month-over-Month, Wins, Lows/Concerns, Key Takeaways, the last
 * three through the evidence ledger). A `WeakMap` keyed on the context is the
 * cheapest memoization that cannot leak: the context is built once per report
 * in prompts.ts and dropped when the report is done.
 *
 * The single-source-of-truth rule matters more here than the cost: the gate
 * that decides whether treasury growth counts as a win, and the fragment that
 * prints the flow figure behind it, must read the identical decomposition.
 * Two independent calls could not disagree today, but a section that fires on
 * "flow-driven growth" and then quotes a price-driven figure would be a false
 * statement in an investor report, and routing everything through one
 * accessor makes that unreachable rather than merely unlikely.
 *
 * A null `prevSnapshot` attributes against `undefined`, which
 * `attributeTreasuryChange` reads as an empty wallet set — no tokens, no
 * movement, `dominantDriver` returns "none". That is the correct reading of
 * "nothing to compare against", and it is why this needs no null guard.
 */
const ATTRIBUTION_MEMO = new WeakMap<ReportSectionContext, TreasuryAttribution>();

export function attributionOf(ctx: ReportSectionContext): TreasuryAttribution {
  const cached = ATTRIBUTION_MEMO.get(ctx);
  if (cached) return cached;
  const attribution = attributeTreasuryChange(
    ctx.prevSnapshot?.balancesDetail,
    ctx.snapshot.balancesDetail
  );
  ATTRIBUTION_MEMO.set(ctx, attribution);
  return attribution;
}

/**
 * The snapshot's transaction-derived net flow, or null when the sync produced
 * no figure. Presence check, never `?? 0`: a net flow of exactly zero is a
 * real finding, and coercing an absent one to zero would invent a "no money
 * moved" reading and then score it as a divergence against the
 * balance-derived estimate.
 */
export function netFlowOf(ctx: ReportSectionContext): number | null {
  const raw = ctx.snapshot.netFlowUsd;
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// ─── income split ──────────────────────────────────────────────────────────
//
// `IncomeCategory` in expense-classifier.ts, partitioned by the only question
// an investor actually asks of an income figure: will it be there again next
// period? Revenue and staking rewards recur. A funding round, a token sale, an
// airdrop do not — they are balance-sheet events wearing an inflow's clothes.
//
// The category names are duplicated here rather than imported for the reason
// counterparty-labels.ts exists: expense-classifier.ts opens with `import
// OpenAI from "openai"`, and this module reaches the browser through
// report-sections.ts and ReportTemplateEditor.tsx. The strings are
// load-bearing — they must match `IncomeCategory` exactly, and the tests
// assert that they do.

const RECURRING_INCOME_CATEGORIES = ["revenue", "staking_reward"] as const;

const NON_RECURRING_INCOME_CATEGORIES = [
  "funding_round",
  "token_sale_inflow",
  "airdrop",
  "other_income",
] as const;

/** Investor-facing names. `token_sale_inflow` means nothing to a reader. */
const INCOME_LABELS: Record<string, string> = {
  revenue: "Protocol revenue (fees, product income)",
  staking_reward: "Staking and LP rewards",
  funding_round: "Funding round (capital raised from investors)",
  token_sale_inflow: "Token sale proceeds (project tokens sold for stables)",
  airdrop: "Airdrops received",
  other_income: "Other inflows (unclassified)",
};

export interface IncomeGroup {
  /** Categories with a positive figure, largest first. */
  entries: { category: string; label: string; usd: number }[];
  /** Sum of `entries` — always exactly what the bullets add up to. */
  totalUsd: number;
}

export interface IncomeSplit {
  recurring: IncomeGroup;
  nonRecurring: IncomeGroup;
  /**
   * False when the snapshot carries no classified income breakdown at all —
   * distinct from a breakdown that classified everything as zero. "We ran the
   * classifier and it found nothing" and "we never ran it" support different
   * sentences, and only one of them permits a comparison.
   */
  classified: boolean;
}

function buildIncomeGroup(
  raw: Record<string, unknown>,
  categories: readonly string[]
): IncomeGroup {
  const entries = categories
    .map((category) => ({
      category,
      label: INCOME_LABELS[category] ?? category,
      usd: Number(raw[category] ?? 0),
    }))
    // Positive-only, per house rule: a category with nothing in it is dropped,
    // never rendered as "$0". No per-line `minSignificant` filter here on
    // purpose — the group totals below are sums of exactly these lines, and a
    // filtered-out line would leave the bullets not adding up to their own
    // total. The significance floor is applied once, to the section as a whole,
    // in `requires`.
    .filter((e) => Number.isFinite(e.usd) && e.usd > 0)
    .sort((a, b) => b.usd - a.usd);
  return {
    entries,
    totalUsd: entries.reduce((sum, e) => sum + e.usd, 0),
  };
}

/**
 * Split a stored `income_by_category` payload into recurring and non-recurring.
 * Tolerates null, legacy payloads with unknown keys, and non-numeric values —
 * an unreadable payload is an unclassified period, not an exception.
 */
export function splitIncome(raw: unknown): IncomeSplit {
  const empty: IncomeGroup = { entries: [], totalUsd: 0 };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { recurring: empty, nonRecurring: empty, classified: false };
  }
  const record = raw as Record<string, unknown>;
  return {
    recurring: buildIncomeGroup(record, RECURRING_INCOME_CATEGORIES),
    nonRecurring: buildIncomeGroup(record, NON_RECURRING_INCOME_CATEGORIES),
    classified: true,
  };
}
