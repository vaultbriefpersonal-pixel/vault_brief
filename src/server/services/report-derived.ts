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
  ProjectBudget,
} from "@/server/db/schema";
import { formatUsd } from "@/lib/utils";
import {
  attributeTreasuryChange,
  type TreasuryAttribution,
} from "./treasury-attribution";
import {
  liquidityFromBuckets,
  type TreasuryLiquidity,
} from "./treasury-liquidity";
import {
  composeTreasury,
  type TreasuryComposition,
} from "./treasury-composition";
import { trailingAverageBurn, type BurnSnapshotLike } from "./burn-metrics";
import {
  burnPeriodDays,
  matchesPeriod,
  monthsInPeriod,
  type ReportPeriod,
} from "./report-period";
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
  /**
   * The reporting window this report covers, as a value — see
   * `report-period.ts`. Derived once per report from the snapshot
   * (`periodFromSnapshot`), and derived the SAME way by the readiness
   * endpoint, for the reason `changeSignificanceFloor` below spells out.
   *
   * It was a bare 'YYYY-MM' string until grant reporting needed a window that
   * starts on the 14th and spans six months. Consumers must go through the
   * module's predicates rather than comparing strings: `matchesPeriod` for
   * month-tagged manual-entry rows, `dateInPeriod` for rows with a real `date`
   * column, `period.tag` where a stable identifier is printed (it is exactly
   * the old 'YYYY-MM' for a calendar month, which is what keeps existing
   * prompt text and the `llm_cache` key unchanged).
   */
  period: ReportPeriod;
  grants: Grant[];
  governanceProposals: GovernanceProposal[];
  partners: Partner[];
  asks: Ask[];
  qaHighlights: QaHighlight[];
  /**
   * Manually entered plan rows for the project, across every period — the
   * Plan vs Actual section filters to the months `ctx.period` touches,
   * matching how `grants` and the other manual-entry datasets travel. Empty
   * when the founder has never typed a budget, which is what gates the section
   * off.
   */
  budgets: ProjectBudget[];
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
  /**
   * The floor for "is this component of a CHANGE worth narrating?" —
   * `max(total * 0.001, $1_000)`, set in prompts.ts.
   *
   * Proportional is the right shape for a delta: a $900K move inside a $1.06B
   * treasury genuinely is noise, and narrating it costs the reader the
   * attention the real driver needed. The absolute $1K arm stops a tiny
   * treasury from having every rounding difference promoted to a finding.
   *
   * It is emphatically NOT the floor for composition or for revenue — see
   * `DUST_FLOOR_USD` and `RECURRING_INCOME_FLOOR_USD` below. One floor was
   * serving all three questions, and on the fixture treasury it evaluated to
   * ~$1.06M, which suppressed the entire stablecoin and ETH position from the
   * Treasury Overview and would suppress a real $500K/month revenue line.
   */
  minSignificant: number;
}

// ─── the three floors ──────────────────────────────────────────────────────
//
// `ctx.minSignificant` (above) answers "is this component of a change worth
// narrating?" and is proportional. These two answer different questions and are
// deliberately absolute, because proportional is not merely imprecise for them
// — it is backwards.

/**
 * "Does this holding exist?" — the floor for COMPOSITION: the Treasury Overview
 * buckets, its per-asset rows, and the `treasury_by_chain` gate and lines.
 *
 * Proportional is flatly wrong here. "$1,136 of stablecoins against a $1.06B
 * total" is not an immaterial figure to be dropped; it IS the finding, because
 * it says the treasury holds essentially no spendable cash. A 0.1%-of-total
 * floor deletes exactly the sentence an investor most needs.
 *
 * Re-exported from treasury-composition.ts, which owns it because the same
 * constant also decides which holdings get named individually versus rolled
 * into the dust line.
 */
export { DUST_FLOOR_USD } from "./treasury-composition";

/**
 * "Is there a revenue line here?" — the floor for `protocol_revenue.requires`.
 *
 * Revenue is measured against BURN, not against the balance sheet. A protocol
 * earning a real $500K/month must not have its revenue section suppressed
 * because it also happens to sit on a $1.06B treasury, which is precisely what
 * a 0.1%-of-total floor did. $5K/month is the point below which recurring
 * income is dust yield rather than a business line.
 */
export const RECURRING_INCOME_FLOOR_USD = 5_000;

/**
 * `ctx.minSignificant` from a treasury total: proportional at 0.1%, with an
 * absolute $1K arm so a small treasury does not promote every rounding
 * difference to a finding.
 *
 * A function rather than an inline expression because TWO places build a
 * `ReportSectionContext` — `buildReportPrompts` in prompts.ts and
 * `getSectionReadiness` in the projects router — and they had already
 * duplicated the formula. Duplicated, they can disagree, and then the
 * constructor UI's readiness chip says a section will render while the report
 * that actually runs decides it will not.
 *
 * `Number.isFinite` guards a snapshot whose stored total does not parse: NaN
 * would poison every `>` comparison into `false` and silently suppress
 * everything gated on this.
 */
export function changeSignificanceFloor(total: number): number {
  return Math.max(
    Number.isFinite(total) && total > 0 ? total * 0.001 : 0,
    1_000
  );
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

/**
 * The full per-token composition of the current snapshot — buckets, sorted
 * per-asset rows, the dust rollup and the unpriced count — memoized per context
 * object on the same `WeakMap` pattern `attributionOf` and `budgetComparison`
 * use, and for the same two reasons.
 *
 * Cost: it walks every token in `balances_detail`, and it now has several
 * callers on identical inputs (the Treasury Overview buckets, that section's
 * `requires` gate, its per-asset table, `liquidityOf` below and therefore the
 * runway figure, the concentration gate, and the evidence ledger through them).
 *
 * Correctness, which matters more: the gate that decides whether the Treasury
 * Overview renders and the table that prints its rows must read the identical
 * composition. Two independent calls could not disagree today, but a section
 * that fires on "there is a stablecoin position" and then prints no stablecoin
 * row would be a defect that only shows up in a shipped report — and routing
 * both through one accessor makes it unreachable rather than merely unlikely.
 */
const COMPOSITION_MEMO = new WeakMap<
  ReportSectionContext,
  TreasuryComposition
>();

export function compositionOf(
  ctx: ReportSectionContext
): TreasuryComposition {
  const cached = COMPOSITION_MEMO.get(ctx);
  if (cached) return cached;
  const composition = composeTreasury(
    ctx.snapshot.balancesDetail,
    ctx.project
  );
  COMPOSITION_MEMO.set(ctx, composition);
  return composition;
}

/**
 * The liquidity/runway view of the same composition. Projected rather than
 * recomputed, so the runway denominator and the Treasury Overview table can
 * never be derived from two different reads of the same JSONB.
 */
export function liquidityOf(ctx: ReportSectionContext): TreasuryLiquidity {
  return liquidityFromBuckets(compositionOf(ctx));
}

export interface BurnBasis {
  /**
   * The denominator to divide reserves by. 0 when there is no usable burn.
   *
   * ALWAYS A MONTHLY FIGURE, whichever `source` it came from. That is what
   * makes `liquidRunwayMonths(reserves, avgUsd)` return months rather than
   * "periods" — the trailing branch is normalised inside `trailingAverageBurn`
   * and the current branch is normalised here, against `ctx.period`.
   */
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
 * A trailing row reduced to what `trailingAverageBurn` needs, with its period
 * length attached — the last piece of the per-month normalisation.
 *
 * `burnRateUsd` is a stored PERIOD TOTAL. Until `period_start` existed there
 * was no way to know what window a prior row's total covered, so every row
 * normalised by exactly 1. Now there is, and the alternative to using it is a
 * trailing average that adds a 181-day window's total to three months' totals
 * and divides by four.
 *
 * `periodDays` IS OMITTED FOR A CALENDAR MONTH — `burnPeriodDays` returns
 * undefined for one, which that field defines as exactly one month. A day
 * count cannot carry the exemption itself (31 is both a January and an
 * arbitrary 31-day window), and passing 31 for a January would divide its burn
 * by 1.0185 and restate every already-published 31-day report by 1.8%. Since
 * every snapshot in the database is a calendar month, every row comes through
 * here with `periodDays` absent and the arithmetic is bit-for-bit what it was.
 */
function toBurnEntry(snapshot: TreasurySnapshot): BurnSnapshotLike {
  return {
    burnRateUsd: snapshot?.burnRateUsd,
    periodDays: burnPeriodDays(snapshot),
  };
}

/**
 * The best available burn denominator, in preference order: the trailing
 * average, then this period's burn, then nothing. The fallback exists because
 * a project on its first or second report has no trailing history and would
 * otherwise get no liquid runway figure at all — which is the very number this
 * work exists to surface. The `source` field is what keeps the fallback
 * honest: it is disclosed in the fragment, never silently substituted.
 *
 * BOTH BRANCHES RETURN A MONTHLY FIGURE. The trailing branch inherits its
 * normalisation from `trailingAverageBurn`; the current branch has to do its
 * own, because `snapshot.burnRateUsd` is this period's raw outflow TOTAL and
 * nothing else in the pipeline divides it. Skipping that here would make
 * liquid runway and stablecoin cover — both of which print "months" — read as
 * whole-period units for a young project on a grant window, which is precisely
 * the class of plausible-looking wrong number this normalisation exists to
 * remove. `monthsInPeriod` is exactly 1 for a calendar month, so the monthly
 * path is untouched.
 */
export function burnBasis(ctx: ReportSectionContext): BurnBasis {
  const trailing = trailingAverageBurn(
    ctx.trailing?.map(toBurnEntry),
    TRAILING_BURN_MONTHS
  );
  if (trailing.monthsUsed > 0) {
    return {
      avgUsd: trailing.avgUsd,
      monthsUsed: trailing.monthsUsed,
      source: "trailing",
    };
  }
  const current = Number(ctx.snapshot.burnRateUsd ?? 0);
  if (Number.isFinite(current) && current > 0) {
    return {
      avgUsd: current / monthsInPeriod(ctx.period),
      monthsUsed: 0,
      source: "current",
    };
  }
  return { avgUsd: 0, monthsUsed: 0, source: "none" };
}

/**
 * Human label for the denominator, used inside the runway bullet itself.
 *
 * `period` is optional so the signature stays additive, and OMITTING IT YIELDS
 * THE PRE-EXISTING STRING — the monthly text, byte for byte. It exists because
 * once `burnBasis` normalises the "current" branch, "this month's burn" names
 * a denominator the number no longer has on a custom period: the figure is
 * this period's outflows reduced to a calendar month, and a label asserting
 * otherwise is the same false statement Phase 1 removed everywhere else.
 * Callers with a context should pass `ctx.period`.
 */
export function burnBasisLabel(
  basis: BurnBasis,
  period?: ReportPeriod
): string {
  if (basis.source === "trailing") {
    return `trailing ${basis.monthsUsed}-mo avg burn`;
  }
  if (period && period.kind !== "month") {
    return "this period's operating outflows normalised to a calendar month (no trailing history yet)";
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
// airdrop, a grant tranche do not — they are balance-sheet events wearing an
// inflow's clothes.
//
// The category names are duplicated here rather than imported for the reason
// counterparty-labels.ts exists: expense-classifier.ts opens with `import
// OpenAI from "openai"`, and this module reaches the browser through
// report-sections.ts and ReportTemplateEditor.tsx. The strings are
// load-bearing — they must match `IncomeCategory` exactly, and the tests
// assert that they do.

export const RECURRING_INCOME_CATEGORIES = [
  "revenue",
  "staking_reward",
] as const;

export const NON_RECURRING_INCOME_CATEGORIES = [
  "funding_round",
  "token_sale_inflow",
  "airdrop",
  // A grant tranche is an award against a fixed schedule, not something the
  // protocol earns — it will not be there again next period once the schedule
  // runs out. Putting it on the recurring side would let `protocol_revenue`
  // report a one-off award as operating revenue, and the reader most likely to
  // see that sentence is the grantor who paid it.
  "grant_received",
  "other_income",
] as const;

/**
 * Every `IncomeCategory` name, in one list. Exported so server-only code that
 * must validate a category string — the project-budgets router's Zod input —
 * can reach the names without importing expense-classifier.ts, which opens
 * with `import OpenAI from "openai"`. Same mirroring discipline as the two
 * arrays above, and the same test asserts it stays in step.
 */
export const INCOME_CATEGORY_NAMES: readonly string[] = [
  ...RECURRING_INCOME_CATEGORIES,
  ...NON_RECURRING_INCOME_CATEGORIES,
];

/** Investor-facing names. `token_sale_inflow` means nothing to a reader. */
const INCOME_LABELS: Record<string, string> = {
  revenue: "Protocol revenue (fees, product income)",
  staking_reward: "Staking and LP rewards",
  funding_round: "Funding round (capital raised from investors)",
  token_sale_inflow: "Token sale proceeds (project tokens sold for stables)",
  airdrop: "Airdrops received",
  grant_received: "Grant funding received (award from a grant program)",
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

// ─── plan vs actual ────────────────────────────────────────────────────────
//
// The founder's typed plan for the period, joined to what the sync actually
// measured. Lives here rather than in the section for the reason every other
// derived view does: `requires()` and the fragment must read one function, so
// a gate that fires on "there is a material overspend" and a table that shows
// none is unreachable.

/**
 * The sentinel category from `project_budgets.category`. A founder who plans
 * one number for the whole month writes a single row carrying this instead of
 * a real category name. Defined here — client-safe, no OpenAI import — so the
 * router's Zod enum, the section, and the modal all read one constant.
 */
export const TOTAL_BUDGET_CATEGORY = "__total__";

/**
 * `ExpenseCategory`, mirrored for the client the same way the income names
 * above are and for the same reason: the module that defines them opens with
 * `import OpenAI from "openai"`, and the budget entry form in
 * SectionDataModal.tsx is a "use client" component that needs the list to
 * render its category picker. The strings are load-bearing — a value the
 * picker offers that the router's Zod enum rejects is a form that cannot be
 * submitted — so a test asserts this array equals `EXPENSE_CATEGORIES`.
 *
 * Server-side code must NOT read this. The router validates against the real
 * export in expense-classifier.ts, which is what makes the mirror checkable
 * rather than merely duplicated.
 */
export const EXPENSE_CATEGORY_NAMES: readonly string[] = [
  "payroll",
  "infrastructure",
  "marketing",
  "grants",
  "legal",
  "token_sale",
  "operational",
  "other",
];

/**
 * A variance is worth naming only when it clears BOTH floors. 20% alone makes
 * a $50 line into a headline at 200% over; $5K alone makes a rounding
 * difference on payroll look deliberate. Requiring both is what keeps the
 * section's callouts to things a reader would act on.
 */
export const VARIANCE_PCT_FLOOR = 20;
export const VARIANCE_USD_FLOOR = 5_000;

/**
 * `token_sale` outflows are a treasury reallocation, not operating spend —
 * `expenseBreakdown` and `treasuryOperations` split on exactly this. A
 * `__total__` plan ("we expect to spend $180K") means operating spend, so the
 * actual it is compared against must exclude the reallocation. A founder who
 * deliberately budgets the `token_sale` line still gets it: an explicitly
 * planned category is always shown.
 */
const NON_OPERATING_EXPENSE_CATEGORY = "token_sale";

export interface BudgetLine {
  category: string;
  /** What the report prints. Raw category for expenses, investor-facing label for income. */
  label: string;
  plannedUsd: number;
  actualUsd: number;
  /** actual − planned. Positive is over plan on the expense side, above plan on income. */
  varianceUsd: number;
  /**
   * Percent of plan, or null when nothing was planned for this category —
   * a percentage against a zero base is not a number, and printing one
   * ("+Infinity%", "+100%") would be a fabricated figure.
   */
  variancePct: number | null;
  /** Clears both floors — the only lines the prompt is allowed to call out. */
  material: boolean;
  /** True when actuals landed in a category the plan never mentioned. */
  unplanned: boolean;
  notes: string | null;
}

export interface BudgetSide {
  kind: "expense" | "income";
  /** Per-category rows, largest plan first. Empty for a `__total__`-only plan. */
  lines: BudgetLine[];
  /** The roll-up. Always present when the side has any budget row at all. */
  total: BudgetLine;
  /** True when the founder planned one number rather than a per-category plan. */
  totalOnly: boolean;
}

export interface BudgetComparison {
  expense: BudgetSide | null;
  income: BudgetSide | null;
  /** Newest `updatedAt` across the period's rows — when the plan last changed. */
  planUpdatedAt: Date | null;
}

/**
 * Rows for a period, or an empty array. Tolerates a context built without
 * budgets.
 *
 * `matchesPeriod` is set membership against the months the period touches, so
 * a calendar month returns exactly the rows the old `b.period === ctx.period`
 * string equality returned — identical output, identical order.
 *
 * DELIBERATELY NOT FOLDED. For a multi-month period this returns several rows
 * per (kind, category), and `buildSide`'s `new Map(itemised.map(...))` keeps
 * the LAST of them — one arbitrary month's plan against the whole window's
 * actuals. That is why `actual_vs_budget.requires` gates on
 * `ctx.period.kind === "month"` and `decisionLedger` skips budget entries for
 * anything else: the fold cannot be written correctly until the ACTUALS are
 * aligned to the period, and `buildSide` reads one snapshot's JSONB. See the
 * deferred backlog.
 */
export function budgetsForPeriod(ctx: ReportSectionContext): ProjectBudget[] {
  return (ctx.budgets ?? []).filter((b) => matchesPeriod(b.period, ctx.period));
}

function toNumber(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/** Positive per-category actuals from a stored JSONB payload. */
function actualsOf(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const usd = toNumber(value);
    if (usd > 0) out[key] = usd;
  }
  return out;
}

function makeLine(
  category: string,
  label: string,
  plannedUsd: number,
  actualUsd: number,
  notes: string | null
): BudgetLine {
  const varianceUsd = actualUsd - plannedUsd;
  // Percent is undefined against a zero plan, so an unplanned line clears the
  // percentage floor vacuously and is judged on the dollar floor alone.
  const variancePct =
    plannedUsd > 0 ? (varianceUsd / plannedUsd) * 100 : null;
  const material =
    Math.abs(varianceUsd) > VARIANCE_USD_FLOOR &&
    (variancePct === null || Math.abs(variancePct) > VARIANCE_PCT_FLOOR);
  return {
    category,
    label,
    plannedUsd,
    actualUsd,
    varianceUsd,
    variancePct,
    material,
    unplanned: plannedUsd <= 0,
    notes,
  };
}

function buildSide(
  kind: "expense" | "income",
  rows: ProjectBudget[],
  rawActuals: unknown
): BudgetSide | null {
  const sideRows = rows.filter((r) => r.kind === kind);
  if (sideRows.length === 0) return null;

  const totalRow = sideRows.find((r) => r.category === TOTAL_BUDGET_CATEGORY);
  const itemised = sideRows.filter(
    (r) => r.category !== TOTAL_BUDGET_CATEGORY
  );
  const plannedByCategory = new Map(
    itemised.map((r) => [r.category, r])
  );

  const actuals = actualsOf(rawActuals);
  // The universe of rows the table covers: everything planned, plus anything
  // the period actually spent or earned. The reallocation bucket joins only
  // when it was planned on purpose — see NON_OPERATING_EXPENSE_CATEGORY.
  const categories = new Set(plannedByCategory.keys());
  for (const category of Object.keys(actuals)) {
    if (
      kind === "expense" &&
      category === NON_OPERATING_EXPENSE_CATEGORY &&
      !plannedByCategory.has(category)
    ) {
      continue;
    }
    categories.add(category);
  }

  const lines =
    itemised.length === 0
      ? []
      : [...categories]
          .map((category) => {
            const row = plannedByCategory.get(category);
            return makeLine(
              category,
              kind === "income"
                ? INCOME_LABELS[category] ?? category
                : category,
              toNumber(row?.plannedUsd),
              actuals[category] ?? 0,
              row?.notes ?? null
            );
          })
          .sort(
            (a, b) => b.plannedUsd - a.plannedUsd || b.actualUsd - a.actualUsd
          );

  // Actual total spans the whole universe whether or not the plan itemised
  // it, so an itemised table's rows always add up to the total beneath them.
  const actualTotal = [...categories].reduce(
    (sum, category) => sum + (actuals[category] ?? 0),
    0
  );
  // A stated `__total__` wins over the sum of the lines. The founder wrote it
  // deliberately, and silently replacing it with a sum would misreport the
  // plan whenever the itemisation is partial.
  const plannedTotal = totalRow
    ? toNumber(totalRow.plannedUsd)
    : lines.reduce((sum, l) => sum + l.plannedUsd, 0);

  return {
    kind,
    lines,
    total: makeLine(
      TOTAL_BUDGET_CATEGORY,
      kind === "expense"
        ? "Total operating spend"
        : "Total income",
      plannedTotal,
      actualTotal,
      totalRow?.notes ?? null
    ),
    totalOnly: itemised.length === 0,
  };
}

const BUDGET_MEMO = new WeakMap<ReportSectionContext, BudgetComparison>();

/**
 * Plan vs actual for `ctx.period`. Memoized per context like `attributionOf`,
 * because `requires()`, the fragment and (through them) readiness all call it
 * on the same object.
 *
 * Only meaningful when `ctx.period.kind === "month"` — see `budgetsForPeriod`.
 * Both callers that can put a figure in front of a reader
 * (`actual_vs_budget.requires` and `decisionLedger`) gate on that.
 */
export function budgetComparison(ctx: ReportSectionContext): BudgetComparison {
  const cached = BUDGET_MEMO.get(ctx);
  if (cached) return cached;

  const rows = budgetsForPeriod(ctx);
  const timestamps = rows
    .map((r) => r.updatedAt)
    .filter((t): t is Date => t instanceof Date);
  const result: BudgetComparison = {
    expense: buildSide("expense", rows, ctx.snapshot.expensesByCategory),
    income: buildSide("income", rows, ctx.snapshot.incomeByCategory),
    planUpdatedAt:
      timestamps.length > 0
        ? new Date(Math.max(...timestamps.map((t) => t.getTime())))
        : null,
  };
  BUDGET_MEMO.set(ctx, result);
  return result;
}
