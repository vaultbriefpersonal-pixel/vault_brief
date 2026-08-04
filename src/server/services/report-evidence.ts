// The data behind "Wins" and "Lows / Concerns".
//
// Both sections shipped as instructions with no input: `userPromptFragment`
// returned "" and the system prompt told the model to "pull from milestones
// completed, dev activity spikes, partnerships". There was nothing to pull
// from — the model assembled wins out of whatever else happened to be in the
// prompt, which is improvisation wearing the costume of analysis.
//
// The sharpest symptom was the rule "do NOT list a treasury increase as a win
// unless the input attributes that increase to net asset flows". Nothing
// computed that attribution for the Wins section. The model could only honour
// the rule when the Month-over-Month section happened to be enabled and its
// block happened to appear above — a silent cross-section coupling, so a
// founder who turned Month-over-Month off silently turned the guardrail off
// too. `treasuryGrowth()` below is that rule expressed as a gate: three
// conditions, all computed, all failing closed. A price-driven rise cannot
// reach the prompt as a positive item at all, so the model cannot select it.
//
// What this module is NOT: a scorer. It produces no verdict, no rating, no
// ranking of how good a period was. It produces statements that are true of
// the data, each carrying the figure that makes it checkable, and the model
// selects from them. An empty ledger is a correct and expected output — a
// young project with one snapshot genuinely has no verified evidence either
// way, and padding it would reintroduce exactly the fabrication this replaces.
//
// Deliberately dependency-free, like the pure services it composes: no
// `@/server/db` values, no `openai`, no `node:*`, no `process.env`.
// report-sections.ts imports this and reaches the browser through
// ReportTemplateEditor.tsx ("use client"), so a server-only import here breaks
// the client bundle. `import type` on the schema is erased and therefore fine.

import type { Milestone, TreasurySnapshot } from "@/server/db/schema";
import { formatUsd } from "@/lib/utils";
import { dominantDriver, reconcileWithNetFlow } from "./treasury-attribution";
import {
  analyzeTreasuryLiquidity,
  liquidReservesUsd,
} from "./treasury-liquidity";
import { burnTrend, liquidRunwayMonths } from "./burn-metrics";
import { dateInPeriod, matchesPeriod } from "./report-period";
import type { Anomaly } from "./anomalies";
import {
  attributionOf,
  budgetComparison,
  burnBasis,
  burnBasisLabel,
  comparisonBasis,
  compositionOf,
  liquidityOf,
  netFlowOf,
  signedUsd,
  splitIncome,
  CONCENTRATION_PCT_FLOOR,
  STABLE_COVER_FLOOR_MONTHS,
  type BudgetLine,
  type ReportSectionContext,
} from "./report-derived";

/**
 * One defensible statement about the period, split into the claim and the
 * figure that backs it.
 *
 * The split is the point. A bullet reading "dev activity was strong" gives the
 * model nothing to quote and everything to embellish; "Commits ran above the
 * trailing baseline / 142 commits vs a 96 average over 3 prior periods" gives
 * it a number it can copy and a comparison it cannot inflate. The model is
 * told to select items and quote figures, never to paraphrase them.
 */
export interface EvidenceItem {
  /** Stable slug. Not shown to the model — it exists so tests can assert on it. */
  id: string;
  /** Short factual statement. No adjectives that aren't measured. */
  claim: string;
  /** The figure(s) behind the claim, pre-formatted in house style. */
  figure: string;
}

export interface EvidenceLedger {
  positives: EvidenceItem[];
  negatives: EvidenceItem[];
}

/**
 * Ceiling per side. Wins and Lows ask for 2-3 and 1-2 bullets respectively, so
 * a list this long is already generous; beyond it the prompt is just paying
 * tokens to widen a choice the model will not use.
 */
const MAX_ITEMS_PER_SIDE = 8;

/** Milestones are the one signal that can arrive in bulk. Cap each list. */
const MAX_MILESTONE_ITEMS = 5;

/**
 * How far above its trailing baseline GitHub activity must run before it is
 * evidence of anything. Matches the minor-anomaly threshold in anomalies.ts so
 * the two features agree on what counts as a real move.
 */
const GITHUB_UPLIFT_PCT = 30;

/**
 * Baseline activity below which a percentage move is noise. Going from 2
 * commits to 3 is a 50% increase and means nothing; the floor stops a quiet
 * repo from generating a "development accelerated" win every other month.
 */
const MIN_GITHUB_BASELINE = 10;

/** Prior periods needed before a GitHub baseline is worth comparing against. */
const MIN_GITHUB_BASELINE_PERIODS = 2;

/** Runway has to move by more than rounding before it is worth a bullet. */
const RUNWAY_DROP_FLOOR_MONTHS = 0.5;

/** Holder-count and recurring-income moves below this are noise, not signal. */
const MATERIAL_MOVE_PCT = 5;
const INCOME_MOVE_PCT = 10;

// ─── small readers ─────────────────────────────────────────────────────────

/**
 * A nullable integer column, read as "absent" rather than zero.
 *
 * This is the same class of error burn-metrics.ts warns about at the top of
 * the file, in the opposite direction. `githubCommitsCount ?? 0` makes "no
 * GitHub org is connected to this project" indistinguishable from "the team
 * shipped nothing this month". The first supports no sentence at all; the
 * second supports a concern. Collapsing them would let the report tell an
 * investor that development stopped, on the evidence of an integration the
 * founder never set up — and it would do it silently, because the zero looks
 * exactly like a measurement.
 *
 * Note the asymmetry with the baseline logic in `trailingAverageBurn`: there,
 * a recorded zero is dropped because a month with no outflows is missing data.
 * Here a recorded zero is KEPT, because a synced repo with zero commits in a
 * month is a real measurement of a quiet month. Only null is absent.
 */
function optionalCount(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function item(id: string, claim: string, figure: string): EvidenceItem {
  return { id, claim, figure };
}

/**
 * Thousands separators, locale pinned. An unqualified `toLocaleString()`
 * follows whatever ICU data the runtime shipped with, so the same snapshot
 * renders "4,820" on one host and "4820" on another — and a figure that
 * changes shape between environments is a figure nobody can diff a report
 * against. Matches `formatQty` elsewhere in the report pipeline.
 */
function formatCount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function milestoneLabel(m: Milestone): string {
  const title = String(m.title ?? "").trim();
  return title.length > 0 ? title : "untitled milestone";
}

// ─── positive signals ──────────────────────────────────────────────────────

/**
 * Treasury growth, gated. THE reason this module exists.
 *
 * Three conditions, all required, all failing closed:
 *
 *   1. `flowUsd > 0` — money actually arrived, on the balance-derived split.
 *   2. `dominantDriver().driver === "flow"` — and it is the largest component
 *      of the period's movement, not a rounding term next to a price rally.
 *   3. `reconcileWithNetFlow().verdict === "consistent"` — and the parsed
 *      transactions independently agree. "unavailable" is not good enough: an
 *      unconfirmed single estimate is not evidence of an achievement.
 *
 * Everything the old prose rule listed as disqualifying is excluded by
 * construction rather than by instruction. A price-driven rise fails (2), since
 * `priceEffectUsd` would carry the larger magnitude. A rise from newly-tracked
 * wallets fails (2) on `walletSet` and (3), which returns "unavailable"
 * whenever the wallet set changed. An unattributable rise fails (2) on
 * `unpriced`. None of them can reach the prompt, so none of them can be
 * selected — which is the difference between a rule and a gate.
 */
function treasuryGrowth(ctx: ReportSectionContext): EvidenceItem | null {
  if (!ctx.prevSnapshot) return null;
  // A fourth condition, added in P3.1 and the strictest of the four: at least
  // one side of this comparison must not be a reconstruction. See
  // `suppressedByBasis` below for why this is checked here as well as in
  // `buildEvidenceLedger` — belt and braces on the item the whole module was
  // written to gate.
  if (!comparisonBasis(ctx).observed) return null;

  const attribution = attributionOf(ctx);
  if (attribution.tokens.length === 0) return null;
  if (attribution.flowUsd <= 0) return null;

  const driver = dominantDriver(attribution);
  if (driver.driver !== "flow") return null;

  const reconciliation = reconcileWithNetFlow(attribution, netFlowOf(ctx));
  if (reconciliation.verdict !== "consistent") return null;

  return item(
    "treasury-growth-flow",
    "The treasury grew on money that actually arrived, not on the market re-pricing what was already held",
    `net asset flows ${signedUsd(attribution.flowUsd)} — the dominant component at ${(
      driver.share * 100
    ).toFixed(
      0
    )}% of all movement, and independently corroborated by the period's parsed transactions (cross-check: CONSISTENT). Total treasury ${formatUsd(
      attribution.valuePrevUsd
    )} → ${formatUsd(attribution.valueCurrUsd)}.`
  );
}

/**
 * Milestones completed inside the reporting period.
 *
 * The `milestones` table has no period column — completion is dated, not
 * scoped — so this matches on the real `completedDate` against the period's
 * actual boundaries rather than on a 'YYYY-MM' prefix. For a calendar month
 * the two are identical; for a window that starts on the 14th the date match
 * is exact where a prefix match would pull in the first thirteen days.
 * Without any filter this would surface a milestone completed two years ago
 * as a win this month, every month, forever.
 */
function completedMilestones(ctx: ReportSectionContext): EvidenceItem[] {
  return ctx.milestones
    .filter(
      (m) =>
        m != null &&
        // A milestone attached to a grant award surfaces only via
        // `grant_milestone_progress` (report-derived.ts's
        // `m.grantAwardId === award.id` filter) — never here. Confirmed live
        // production bug: a grant-owned milestone leaked into an investor
        // report's Wins/Key Takeaways even with every grant section off.
        m.grantAwardId == null &&
        m.status === "completed" &&
        m.completedDate != null &&
        dateInPeriod(m.completedDate, ctx.period)
    )
    .slice(0, MAX_MILESTONE_ITEMS)
    .map((m, i) =>
      item(
        `milestone-completed-${i}`,
        `Milestone completed this period: ${milestoneLabel(m)}`,
        `marked completed ${String(m.completedDate)}${
          m.description ? ` — ${m.description}` : ""
        }`
      )
    );
}

/**
 * Partners announced in this reporting period. Period-scoped by column, and
 * that column is a calendar month — so the match is set membership over the
 * months the period touches.
 *
 * The figure quotes the ROW's own month, not the period's identifier. For a
 * monthly report the two are the same string; for a six-month window they are
 * not, and "recorded against 2026-02-14..2026-07-31" would be a false
 * statement about where the row was filed.
 */
function newPartners(ctx: ReportSectionContext): EvidenceItem[] {
  return ctx.partners
    .filter((p) => p != null && matchesPeriod(p.period, ctx.period))
    .slice(0, MAX_MILESTONE_ITEMS)
    .map((p, i) =>
      item(
        `partner-new-${i}`,
        `New partner or integration announced this period: ${p.name}`,
        `${p.type ? `${p.type}, ` : ""}recorded against ${p.period}${
          p.notes ? ` — ${p.notes}` : ""
        }`
      )
    );
}

/**
 * Token HOLDER growth, and deliberately never token price.
 *
 * A price rise is a market event. The team did not do it, it reverses without
 * anyone doing anything either, and listing it as an achievement is the same
 * category error as counting a price-driven treasury rise as growth — see
 * `treasuryGrowth` above. Holder count is a distribution fact: more addresses
 * hold the token than did last period. That one is about the project.
 */
function holderGrowth(ctx: ReportSectionContext): EvidenceItem | null {
  const now = optionalCount(ctx.snapshot.tokenHoldersCount);
  const then = optionalCount(ctx.prevSnapshot?.tokenHoldersCount);
  if (now === null || then === null || then <= 0) return null;

  const delta = now - then;
  if (delta <= 0) return null;
  const changePct = (delta / then) * 100;
  if (changePct < MATERIAL_MOVE_PCT) return null;

  return item(
    "token-holders-up",
    "The token reached more holders than last period",
    `${formatCount(then)} → ${formatCount(now)} holders (+${formatCount(
      delta
    )}, +${changePct.toFixed(
      0
    )}%). This is a holder count, not a price — do not describe it as price or market performance.`
  );
}

interface GithubComparison {
  current: number;
  baseline: number;
  periods: number;
}

/**
 * One GitHub metric against its own trailing baseline, or null when the
 * comparison cannot honestly be made.
 *
 * Nulls are dropped from the baseline rather than counted as zero months, so a
 * project that connected GitHub two months ago is compared against the two
 * months it actually has, and a project that never connected it produces
 * nothing at all.
 */
function githubComparison(
  ctx: ReportSectionContext,
  pick: (s: TreasurySnapshot) => number | null | undefined
): GithubComparison | null {
  const current = optionalCount(pick(ctx.snapshot));
  if (current === null) return null;

  const priors = ctx.trailing
    .map((s) => (s ? optionalCount(pick(s)) : null))
    .filter((n): n is number => n !== null);
  if (priors.length < MIN_GITHUB_BASELINE_PERIODS) return null;

  const baseline = priors.reduce((a, b) => a + b, 0) / priors.length;
  if (baseline < MIN_GITHUB_BASELINE) return null;

  return { current, baseline, periods: priors.length };
}

function githubActivity(ctx: ReportSectionContext): EvidenceItem[] {
  const metrics: [string, string, (s: TreasurySnapshot) => number | null | undefined][] =
    [
      ["commits", "Commits", (s) => s.githubCommitsCount],
      ["prs", "Pull requests merged", (s) => s.githubPrsMerged],
    ];

  const items: EvidenceItem[] = [];
  for (const [slug, label, pick] of metrics) {
    const cmp = githubComparison(ctx, pick);
    if (!cmp) continue;
    const changePct = ((cmp.current - cmp.baseline) / cmp.baseline) * 100;
    if (changePct < GITHUB_UPLIFT_PCT) continue;
    items.push(
      item(
        `github-${slug}-up`,
        `${label} ran materially above the project's own recent baseline`,
        `${formatCount(cmp.current)} this period vs a ${cmp.baseline.toFixed(
          0
        )} average over the ${cmp.periods} prior period${
          cmp.periods === 1 ? "" : "s"
        } that recorded GitHub activity (+${changePct.toFixed(0)}%)`
      )
    );
  }
  return items;
}

// ─── negative signals ──────────────────────────────────────────────────────

function delayedMilestones(ctx: ReportSectionContext): EvidenceItem[] {
  return ctx.milestones
    .filter(
      (m) => m != null && m.grantAwardId == null && m.status === "delayed"
    )
    .slice(0, MAX_MILESTONE_ITEMS)
    .map((m, i) =>
      item(
        `milestone-delayed-${i}`,
        `Milestone currently marked delayed: ${milestoneLabel(m)}`,
        `status 'delayed'${
          m.targetDate ? `, original target ${String(m.targetDate)}` : ""
        }${m.description ? ` — ${m.description}` : ""}`
      )
    );
}

/**
 * Net flow this period was materially negative — the fact "no material
 * concerns" cannot be true alongside.
 *
 * `netFlowOf(ctx)` reads `ctx.snapshot.netFlowUsd` directly: the same
 * authoritative figure `financialHealthLines` (report-sections.ts) prints as
 * "Net flow (inflows minus outflows)", computed at sync time from the FULL
 * unsampled transaction list — not the sampled major-transactions list. This
 * function is the missing route from that figure into the evidence ledger,
 * which is what `lowsConcerns` and `keyTakeaways` actually read from —
 * `financialHealthLines` prints the number in a different section entirely,
 * so its presence there never stopped Lows/Concerns from independently
 * deciding there was nothing to flag. Confirmed as a real production gap: a
 * large one-off outflow that doesn't trip the 30%-move anomaly threshold and
 * doesn't shrink runway by the 0.5-month floor produced zero negative
 * evidence, while the net-flow figure printed elsewhere in the same report.
 *
 * Gated on `ctx.minSignificant` — `changeSignificanceFloor(ctx.total)`, this
 * codebase's standard materiality floor (0.1% of treasury, $1,000 floor) —
 * the same bar `attributionConcerns`'s `unpricedUsd` check already uses. No
 * `prevSnapshot` requirement, unlike `runwayShrinking`/`attributionConcerns`:
 * this is a fact about the period's own transactions, not a comparison
 * across snapshots, so it can fire on a project's very first snapshot.
 */
function materialNetOutflow(ctx: ReportSectionContext): EvidenceItem | null {
  const netFlow = netFlowOf(ctx);
  if (netFlow === null || netFlow >= 0) return null;
  if (Math.abs(netFlow) <= ctx.minSignificant) return null;

  return item(
    "material-net-outflow",
    "Net flow this period was negative and past the reporting materiality floor",
    `${signedUsd(netFlow)} net flow this period (inflows minus outflows), against a materiality floor of ${formatUsd(
      ctx.minSignificant
    )}`
  );
}

/**
 * Liquid runway shorter than it was a period ago.
 *
 * Both sides are divided by the SAME burn basis on purpose. Runway is a ratio,
 * and letting the denominator move too would fold a burn change into a figure
 * the reader will hear as "the money is going faster" — two different findings
 * blended into one number. Holding burn fixed makes this exactly what it says:
 * spendable reserves fell. The burn direction gets its own item below.
 *
 * The prior snapshot's liquidity is computed here rather than read from a
 * helper because it is a different input, not the same figure twice —
 * `liquidityOf(ctx)` is defined as the CURRENT snapshot's split, and there is
 * no shared accessor to route this through.
 */
function runwayShrinking(ctx: ReportSectionContext): EvidenceItem | null {
  if (!ctx.prevSnapshot) return null;

  const liq = liquidityOf(ctx);
  const basis = burnBasis(ctx);
  if (!liq.derived || basis.avgUsd <= 0) return null;

  const prevLiq = analyzeTreasuryLiquidity(
    ctx.prevSnapshot.balancesDetail,
    ctx.project
  );
  if (!prevLiq.derived) return null;

  const now = liquidRunwayMonths(liquidReservesUsd(liq), basis.avgUsd);
  const then = liquidRunwayMonths(liquidReservesUsd(prevLiq), basis.avgUsd);
  if (now === null || then === null) return null;
  if (then - now < RUNWAY_DROP_FLOOR_MONTHS) return null;

  return item(
    "runway-shrinking",
    "Liquid runway is shorter than it was last period",
    `${then.toFixed(1)} → ${now.toFixed(1)} months. Spendable reserves ${formatUsd(
      liquidReservesUsd(prevLiq)
    )} → ${formatUsd(
      liquidReservesUsd(liq)
    )}, both divided by the same ${burnBasisLabel(
      basis,
      ctx.period
    )} of ${formatUsd(
      basis.avgUsd
    )} — so this is reserves falling, not spending rising.`
  );
}

function concentration(ctx: ReportSectionContext): EvidenceItem | null {
  const liq = liquidityOf(ctx);
  if (!liq.derived || liq.totalUsd <= 0) return null;
  if (liq.concentrationPct <= CONCENTRATION_PCT_FLOOR) return null;

  const name = ctx.project.tokenSymbol
    ? `${ctx.project.tokenSymbol}, the project's own token`
    : "the project's own token";
  return item(
    "concentration-high",
    `A material share of the treasury is ${name}, which does not behave like reserves`,
    `${formatUsd(liq.concentratedUsd)} of ${formatUsd(
      liq.totalUsd
    )} measured per-token (${liq.concentrationPct.toFixed(
      1
    )}%), above the ${CONCENTRATION_PCT_FLOOR}% reporting floor`
  );
}

function stablecoinCover(ctx: ReportSectionContext): EvidenceItem | null {
  const liq = liquidityOf(ctx);
  const basis = burnBasis(ctx);
  if (!liq.derived || liq.totalUsd <= 0 || basis.avgUsd <= 0) return null;

  const cover = liq.liquidStableUsd / basis.avgUsd;
  if (cover >= STABLE_COVER_FLOOR_MONTHS) return null;

  return item(
    "stable-cover-thin",
    "Stablecoin holdings cover less than the reporting floor of price-stable spending",
    `${formatUsd(
      liq.liquidStableUsd
    )} of stablecoins is ${cover.toFixed(1)} months at the ${burnBasisLabel(
      basis,
      ctx.period
    )} of ${formatUsd(
      basis.avgUsd
    )}, below the ${STABLE_COVER_FLOOR_MONTHS}-month floor`
  );
}

function burnDirection(ctx: ReportSectionContext): {
  positive: EvidenceItem | null;
  negative: EvidenceItem | null;
} {
  const none = { positive: null, negative: null };
  const basis = burnBasis(ctx);
  // Only the trailing average is a legitimate comparison. `burnBasis` falls
  // back to the current period when there is no history, and comparing this
  // month's burn against itself would report "stable" for every young project.
  if (basis.source !== "trailing") return none;

  const current = Number(ctx.snapshot.burnRateUsd ?? 0);
  const trend = burnTrend(current, basis.avgUsd);
  if (trend !== "accelerating" && trend !== "decelerating") return none;

  const figure = `${formatUsd(current)} this period vs a ${burnBasisLabel(
    basis,
    ctx.period
  )} of ${formatUsd(basis.avgUsd)} (${basis.monthsUsed} period${
    basis.monthsUsed === 1 ? "" : "s"
  } in the average)`;

  if (trend === "decelerating") {
    return {
      positive: item(
        "burn-decelerating",
        "Spending ran below the trailing average",
        figure
      ),
      negative: null,
    };
  }
  return {
    positive: null,
    negative: item(
      "burn-accelerating",
      "Spending ran above the trailing average",
      figure
    ),
  };
}

function recurringIncomeDirection(ctx: ReportSectionContext): {
  positive: EvidenceItem | null;
  negative: EvidenceItem | null;
} {
  const none = { positive: null, negative: null };
  const now = splitIncome(ctx.snapshot.incomeByCategory);
  const then = splitIncome(ctx.prevSnapshot?.incomeByCategory);
  // Both periods must have been through the classifier. "We ran it and found
  // nothing" and "we never ran it" support different sentences, and only the
  // first permits a comparison at all.
  if (!now.classified || !then.classified) return none;
  if (then.recurring.totalUsd <= 0) return none;

  const delta = now.recurring.totalUsd - then.recurring.totalUsd;
  const changePct = (delta / then.recurring.totalUsd) * 100;
  if (Math.abs(changePct) < INCOME_MOVE_PCT) return none;

  const figure = `${formatUsd(then.recurring.totalUsd)} → ${formatUsd(
    now.recurring.totalUsd
  )} (${signedUsd(delta)}, ${changePct > 0 ? "+" : ""}${changePct.toFixed(
    0
  )}%). Recurring income only — funding rounds, token sales and airdrops are excluded from both figures.`;

  if (delta > 0) {
    return {
      positive: item(
        "recurring-income-up",
        "Recurring operating income — what the protocol earns — was higher than last period",
        figure
      ),
      negative: null,
    };
  }
  return {
    positive: null,
    negative: item(
      "recurring-income-down",
      "Recurring operating income — what the protocol earns — was lower than last period",
      figure
    ),
  };
}

/** Data-quality findings from the attribution. Each is a real caveat, not a metric. */
function attributionConcerns(ctx: ReportSectionContext): EvidenceItem[] {
  if (!ctx.prevSnapshot) return [];
  const attribution = attributionOf(ctx);
  if (attribution.tokens.length === 0) return [];

  const items: EvidenceItem[] = [];

  const reconciliation = reconcileWithNetFlow(attribution, netFlowOf(ctx));
  if (reconciliation.verdict === "diverging") {
    const apart =
      reconciliation.divergencePct === null
        ? ""
        : `, ${(reconciliation.divergencePct * 100).toFixed(0)}% apart`;
    items.push(
      item(
        "attribution-diverging",
        "The two independent estimates of money moved this period do not agree",
        `balance-derived flow ${signedUsd(
          attribution.flowUsd
        )} vs transaction-derived net flow ${signedUsd(
          netFlowOf(ctx) ?? 0
        )} (gap ${signedUsd(
          reconciliation.divergenceUsd
        )}${apart}). Neither figure is confirmed — this is a data-quality caveat, not a finding about the business.`
      )
    );
  }

  if (Math.abs(attribution.unpricedUsd) > ctx.minSignificant) {
    items.push(
      item(
        "attribution-unpriced",
        "Part of the treasury change could not be attributed because price data was missing",
        `${signedUsd(
          attribution.unpricedUsd
        )} unattributed against a total change of ${signedUsd(
          attribution.deltaUsd
        )}. Unattributed means unmeasured, NOT value appearing or vanishing.`
      )
    );
  }

  if (attribution.walletSetChanged) {
    const added = attribution.addedWallets.length;
    const removed = attribution.removedWallets.length;
    items.push(
      item(
        "attribution-wallet-set-changed",
        "The set of tracked wallets changed between the two snapshots, so coverage is not like-for-like",
        `${added} wallet${added === 1 ? "" : "s"} added, ${removed} removed, moving ${signedUsd(
          attribution.walletSetUsd
        )} of measured value. A wallet newly tracked is a coverage change, never a deposit; a wallet that dropped out may simply have failed to sync.`
      )
    );
  }

  return items;
}

/**
 * Whether an anomaly points the wrong way.
 *
 * Direction is metric-specific — burn rising is bad, treasury falling is bad —
 * so there is no generic sign rule, and an unrecognised metric returns false
 * rather than guessing. Omitting a real concern is recoverable; narrating a
 * cost saving as a crisis because the sign convention was assumed is not.
 */
function anomalyIsNegative(a: Anomaly): boolean {
  if (typeof a?.metric !== "string") return false;
  if (!Number.isFinite(a.changePct)) return false;
  if (a.metric.startsWith("Expense: ")) return a.changePct > 0;
  if (a.metric === "Burn rate") return a.changePct > 0;
  if (
    a.metric === "Total balance" ||
    a.metric === "Stablecoins" ||
    a.metric === "Total inflows"
  ) {
    return a.changePct < 0;
  }
  return false;
}

function negativeAnomalies(ctx: ReportSectionContext): EvidenceItem[] {
  return ctx.anomalies
    .filter((a) => a && anomalyIsNegative(a))
    .slice(0, MAX_MILESTONE_ITEMS)
    .map((a, i) =>
      item(
        `anomaly-negative-${i}`,
        `${a.metric} moved against the project versus its trailing average (${a.severity})`,
        a.newCategory
          ? `${formatUsd(a.current)} with no prior history — first occurrence`
          : `${formatUsd(a.baseline)} → ${formatUsd(a.current)} (${
              a.changePct > 0 ? "+" : ""
            }${a.changePct.toFixed(
              0
            )}%). The detector measures the move, not its cause — do not supply one.`
      )
    );
}

// ─── the ledger ────────────────────────────────────────────────────────────

/**
 * Every defensible positive and negative statement about the period, each with
 * its figure.
 *
 * Order within each side is by how load-bearing the item is, not by strength:
 * the model is told to pick 2-3, so the ones that matter most to an investor
 * go first. Nothing here is padded and nothing is invented — a period with no
 * verified evidence returns empty arrays, and the sections handle that.
 *
 * Never throws. This runs inside report generation, where an exception loses
 * the whole report over one malformed JSONB payload; every reader below either
 * tolerates bad input or is fed by a service that already does.
 */
export function buildEvidenceLedger(ctx: ReportSectionContext): EvidenceLedger {
  const burn = burnDirection(ctx);
  const income = recurringIncomeDirection(ctx);

  // ── the reconstruction gate ──────────────────────────────────────────────
  //
  // A reconstructed baseline must never produce a WIN. Every quantity the
  // walk-back cannot see — rebasing, staking accrual, mints, gas — pushes the
  // reconstructed opening balance DOWN, so an apparent increase from it is
  // exactly what a systematically understated starting point produces. An
  // investor reading that as an achievement has been misled by arithmetic, and
  // no caveat placed nearby undoes a bullet that begins "the treasury grew".
  //
  // WHICH POSITIVES, AND WHY NOT ALL OF THEM. Only the BALANCE columns are
  // reconstructed. `treasuryGrowth` is derived from balances on both sides and
  // is the item this gate exists for. `holderGrowth` reads
  // `token_holders_count`, which comes from the current-value-only
  // `fetchTokenMetrics` and is written NULL on a reconstructed row — so it
  // self-gates already, and this makes that structural rather than incidental.
  //
  // The rest are NOT suppressed, and that is a deliberate reading of "every
  // achievement-claiming positive" rather than a shortcut. Completed
  // milestones and new partners are founder-entered facts that owe nothing to
  // the reconstruction. Burn deceleration, recurring income and GitHub
  // activity are measured over the period by the sync itself — the walk-back
  // is built out of exactly those transfers, so they are as observed on a
  // reconstructed row as on any other. Suppressing them would delete true,
  // checkable statements from a backfilled report to guard against a risk that
  // lives in a different set of columns, and would leave a report whose Wins
  // section is empty for reasons the reader cannot see.
  //
  // Negatives are deliberately left alone. The asymmetry is the point: a
  // reconstruction that invents a concern errs toward caution, one that
  // invents a win errs toward the reader's loss.
  const basisObserved = comparisonBasis(ctx).observed;
  const suppressedByBasis = <T>(item: T | null): T | null =>
    basisObserved ? item : null;

  const positives: EvidenceItem[] = [
    suppressedByBasis(treasuryGrowth(ctx)),
    ...completedMilestones(ctx),
    income.positive,
    burn.positive,
    ...newPartners(ctx),
    suppressedByBasis(holderGrowth(ctx)),
    ...githubActivity(ctx),
  ].filter((i): i is EvidenceItem => i !== null);

  const negatives: EvidenceItem[] = [
    ...delayedMilestones(ctx),
    materialNetOutflow(ctx),
    runwayShrinking(ctx),
    concentration(ctx),
    stablecoinCover(ctx),
    burn.negative,
    income.negative,
    ...attributionConcerns(ctx),
    ...negativeAnomalies(ctx),
  ].filter((i): i is EvidenceItem => i !== null);

  return {
    positives: positives.slice(0, MAX_ITEMS_PER_SIDE),
    negatives: negatives.slice(0, MAX_ITEMS_PER_SIDE),
  };
}

/**
 * Memoized ledger — one build per report, shared by Wins, Lows/Concerns and
 * Key Takeaways.
 *
 * The memo lives here rather than in report-derived.ts alongside the other
 * `WeakMap` accessors on purpose: it caches `buildEvidenceLedger`, which is
 * defined in this file. Hosting it one layer down would make report-derived
 * import report-evidence, recreating exactly the cycle the split removed. A
 * memo belongs next to the function it memoizes.
 */
const EVIDENCE_MEMO = new WeakMap<ReportSectionContext, EvidenceLedger>();

export function evidenceOf(ctx: ReportSectionContext): EvidenceLedger {
  const cached = EVIDENCE_MEMO.get(ctx);
  if (cached) return cached;
  const ledger = buildEvidenceLedger(ctx);
  EVIDENCE_MEMO.set(ctx, ledger);
  return ledger;
}

/**
 * One factual finding a recommendation is allowed to cite, plus the figure
 * that backs it.
 *
 * This is the entire enforcement mechanism behind letting the model write
 * recommendations: a recommendation not grounded in one of these entries is
 * an opinion, and the Recommendations section's own rules say opinions don't
 * get a bullet. Never shown to the model as `source` — that field exists so
 * tests can assert which pipeline produced a given entry.
 */
export interface DecisionLedgerEntry {
  /** Short factual statement a recommendation may cite as its basis. */
  finding: string;
  /** The figure that backs the finding, pre-formatted in house style. */
  figure: string;
  /** Where this entry came from — for tests/traceability, never shown to the model. */
  source: string;
}

/**
 * Sane ceiling on ledger size so the Recommendations prompt fragment cannot
 * balloon on a treasury with dozens of budget lines and holdings. Composition
 * rows are appended last and therefore truncated first when the cap bites —
 * evidence items are already curated to matter most (see `evidenceOf`), and
 * the liquidity/budget entries below are the ones a recommendation is most
 * likely to need.
 */
const MAX_DECISION_LEDGER_ITEMS = 20;

/**
 * Every finding the Recommendations section is allowed to cite, combined from
 * four sources that do not overlap:
 *
 *   1. `evidenceOf(ctx)` — the same curated positives/negatives Wins and
 *      Lows/Concerns already select from. This already includes concentration
 *      risk and thin stablecoin cover as negative items (see `concentration()`
 *      and `stablecoinCover()` above), so those two are NOT recomputed here.
 *   2. `liquidityOf` + `burnBasis` — the CURRENT liquid runway figure.
 *      `evidenceOf` only carries `runwayShrinking`, a period-over-period
 *      comparison; it has no entry for the raw current-state number, which is
 *      exactly what a recommendation about runway needs to cite.
 *   3. `budgetComparison(ctx)` — every line (and the total row) the founder's
 *      own plan-vs-actual already marked `material`. The materiality
 *      threshold is `report-derived.ts`'s, reused rather than reimplemented.
 *   4. `compositionOf(ctx)` — the top 3 holdings by value, already sorted
 *      descending in `TreasuryComposition.assets`.
 *
 * Never throws — same discipline as `buildEvidenceLedger`: every `ctx` field
 * this reads can be absent or empty, and that means "no entry from this
 * source", never an error.
 */
export function decisionLedger(
  ctx: ReportSectionContext
): DecisionLedgerEntry[] {
  const entries: DecisionLedgerEntry[] = [];

  // 1. Evidence ledger — already curated, already used by Wins/Lows.
  const { positives, negatives } = evidenceOf(ctx);
  for (const it of [...positives, ...negatives]) {
    entries.push({
      finding: it.claim,
      figure: it.figure,
      source: `evidence:${it.id}`,
    });
  }

  // Balance-derived entries below carry the provenance of the balances they
  // came from. This is the SECOND path to the reader — `decisionLedger` feeds
  // Recommendations, which is instructed to quote a ledger figure verbatim —
  // so a reconstructed reserve figure arriving here unlabelled would be quoted
  // as a measurement in the one section the model is allowed to editorialise
  // in. Empty for an observed comparison, which is every row in the database
  // today, so no existing report's prompt changes.
  const reconstructedTag = comparisonBasis(ctx).observed
    ? ""
    : " [RECONSTRUCTED BALANCES — estimated, not observed; say so if you cite this]";

  // 2. Current liquid runway — the raw current-state figure evidenceOf lacks.
  const liq = liquidityOf(ctx);
  const basis = burnBasis(ctx);
  if (liq.derived && basis.avgUsd > 0) {
    const reserves = liquidReservesUsd(liq);
    const months = liquidRunwayMonths(reserves, basis.avgUsd);
    if (months !== null) {
      entries.push({
        finding: "Liquid runway",
        figure: `${months.toFixed(1)} months (liquid reserves ${formatUsd(
          reserves
        )} ÷ ${burnBasisLabel(basis, ctx.period)} of ${formatUsd(
          basis.avgUsd
        )})${reconstructedTag}`,
        source: "liquidity",
      });
    }
  }

  // 3. Material budget variances — plan vs actual, founder-entered.
  //
  // Gated on a calendar month for exactly the reason `actual_vs_budget` is
  // (see `budgetsForPeriod`), and the gate has to be repeated HERE because
  // this is a second, independent path from the budget rows to the reader:
  // `decisionLedger` calls `budgetComparison` directly, never through the
  // section's `requires`. Without it, gating the section would hide the table
  // while a variance computed from one arbitrary month's plan against a
  // six-month window's actuals still arrived in Recommendations, labelled
  // MATERIAL and quoted as a figure the model is instructed to cite verbatim.
  const cmp =
    ctx.period.kind === "month"
      ? budgetComparison(ctx)
      : { expense: null, income: null, planUpdatedAt: null };
  const budgetLines: BudgetLine[] = [
    ...(cmp.expense ? [...cmp.expense.lines, cmp.expense.total] : []),
    ...(cmp.income ? [...cmp.income.lines, cmp.income.total] : []),
  ];
  for (const line of budgetLines) {
    if (!line.material) continue;
    const pct =
      line.variancePct == null
        ? "unplanned"
        : `${line.variancePct > 0 ? "+" : ""}${line.variancePct.toFixed(0)}%`;
    entries.push({
      finding: `${line.label} variance`,
      figure: `planned ${formatUsd(line.plannedUsd)}, actual ${formatUsd(
        line.actualUsd
      )} (${pct})`,
      source: "budget",
    });
  }

  // 4. Top holdings by value — appended last so the cap below truncates these
  // first, never the evidence/liquidity/budget entries above.
  const composition = compositionOf(ctx);
  for (const row of composition.assets.slice(0, 3)) {
    entries.push({
      finding: `${row.symbol} holding`,
      figure: `${formatUsd(row.valueUsd)} (${row.sharePct.toFixed(
        1
      )}% of treasury)${reconstructedTag}`,
      source: "composition",
    });
  }

  return entries.slice(0, MAX_DECISION_LEDGER_ITEMS);
}

/** Prompt bullets. Empty string for an empty list, so callers can skip silently. */
export function formatEvidenceItems(items: EvidenceItem[]): string {
  return items.map((i) => `- ${i.claim} — ${i.figure}`).join("\n");
}
