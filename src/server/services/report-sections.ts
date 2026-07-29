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
import { formatUsd, formatDate } from "@/lib/utils";
import {
  attributeTreasuryChange,
  dominantDriver,
  reconcileWithNetFlow,
  type AttributionDriver,
  type TokenAttribution,
} from "./treasury-attribution";
import {
  extractMajorTransactions,
  type MajorTransaction,
} from "./major-transactions";
import {
  analyzeTreasuryLiquidity,
  liquidReservesUsd,
  type TreasuryLiquidity,
} from "./treasury-liquidity";
import {
  burnTrend,
  liquidRunwayMonths,
  trailingAverageBurn,
} from "./burn-metrics";

/**
 * Report section library — single source of truth for every block the
 * LLM can produce. The constructor UI toggles + reorders these; the
 * prompt builder composes user+system prompts from the enabled list.
 *
 * Each section is self-contained:
 *   • `requires(ctx)` — gate predicate. If false, the section is skipped
 *     even when enabled (e.g. "Token Metrics" with no token symbol).
 *     Different from disabled-via-config: the user wanted the section,
 *     but data isn't there yet.
 *   • `userPromptFragment(ctx)` — the chunk that goes into the user
 *     prompt block. Empty string ⇒ skip silently.
 *   • `systemPromptFragment` — instructions appended to the system
 *     prompt. Per-section "shape rules" live here.
 *
 * Why one file: a centralized library makes the constructor UI trivial
 * (iterate the array, render toggles). It also forces every section to
 * carry both halves of its rendering — there's no place to leave a
 * dangling section title in prompts.ts that the system prompt forgot to
 * reference.
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
  /** Total balance in USD, computed once. */
  total: number;
  /** Minimum balance to be worth mentioning (0.1% of total). */
  minSignificant: number;
}

export interface ReportSection {
  id: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
  /** When false on the latest snapshot, skip even if enabled. */
  requires: (ctx: ReportSectionContext) => boolean;
  /**
   * Returns the chunk that goes into the user prompt. Empty string ⇒
   * silent skip. Most sections use this to feed the LLM their slice of
   * the input data.
   */
  userPromptFragment: (ctx: ReportSectionContext) => string;
  /**
   * Instructions appended to the system prompt for this section's
   * shape rules. Always included when the section is enabled (even if
   * `requires` is false — the system prompt is just rules, no data).
   */
  systemPromptFragment: string;
  /**
   * Human-readable reason why a section won't render with current
   * data. Shown in the constructor UI as a chip when `requires()` is
   * false. Two common shapes:
   *   • "Coming soon — no <X> pipeline yet" for sections gated on
   *     features we haven't built yet
   *   • "Needs <Y>" for sections waiting on user data
   * If omitted, the editor falls back to a generic "Not yet ready".
   */
  notReadyHint?: string;
}

// ─── prompt formatters ─────────────────────────────────────────────────────

/**
 * `formatUsd` already carries the minus sign; the explicit plus is what stops
 * a positive figure from reading as a bare magnitude. Signed components are
 * the whole point of an attribution — "$4.9M of price movement" and
 * "-$4.9M of price movement" are opposite stories, and a model that reads
 * one as the other writes a false sentence into an investor update.
 */
function signedUsd(amount: number): string {
  return amount > 0 ? `+${formatUsd(amount)}` : formatUsd(amount);
}

/**
 * Whole days between two snapshot dates. `snapshotDate` is a `date` column
 * ("2026-06-30"), which parses as UTC midnight, so the subtraction is exact
 * and immune to the local timezone the report happens to be generated in.
 * Returns null for anything unparseable rather than emitting "NaN days".
 */
function gapInDays(
  prevDate: string | Date,
  currDate: string | Date
): number | null {
  const prev = new Date(prevDate).getTime();
  const curr = new Date(currDate).getTime();
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return null;
  return Math.round((curr - prev) / 86_400_000);
}

/**
 * Beyond this the balance-derived flow and the period's transaction totals
 * cover visibly different windows, so cross-comparing them is a mistake the
 * prompt has to name out loud. 45 days clears a normal monthly cadence
 * (28-31 days) plus a late sync, without excusing a skipped period.
 */
const LONG_GAP_DAYS = 45;

/** Investor-facing names. Field names like `walletSetUsd` mean nothing to a reader. */
const DRIVER_LABELS: Record<AttributionDriver, string> = {
  flow: "net asset flows — money that actually moved",
  price: "price movement of assets already held",
  cross: "quantity and price moving at the same time",
  walletSet: "wallets newly tracked or dropped — a coverage change, not a treasury movement",
  unpriced: "change that cannot be attributed because price data is missing",
  none: "no measurable movement",
};

/**
 * Prices are inputs to a check, not report figures, so precision beats
 * brevity — the reader has to be able to multiply quantity by price and land
 * on the stated delta. Digits scale with magnitude so a long-tail token
 * doesn't round to "$0.0000" and read as unpriced.
 */
function formatPrice(price: number): string {
  if (price === 0) return "unpriced";
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.0001) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(8)}`;
}

function formatQty(qty: number): string {
  const abs = Math.abs(qty);
  const digits = abs >= 1_000 ? 0 : abs >= 1 ? 2 : 6;
  return qty.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/**
 * What actually changed for one token, so the model can attribute the line
 * instead of guessing. The coverage check comes first: a token appearing in a
 * newly-tracked wallet has `qtyPrev = 0`, which reads as a quantity move — and
 * "the treasury received X" is exactly the claim that must not be made about
 * a wallet we merely started watching.
 */
function tokenMovement(t: TokenAttribution): string {
  if (!t.priced) return "no usable price — change left unattributed";
  const attributed =
    Math.abs(t.flowUsd) + Math.abs(t.priceEffectUsd) + Math.abs(t.crossUsd);
  if (Math.abs(t.walletSetUsd) > attributed) {
    return "wallet coverage changed — not a treasury movement";
  }
  const qtyMoved = t.qtyCurr !== t.qtyPrev;
  const priceMoved = t.priceCurr !== t.pricePrev;
  if (qtyMoved && priceMoved) return "quantity and price both moved";
  if (qtyMoved) return "quantity moved, price unchanged";
  if (priceMoved) return "price moved, quantity unchanged";
  return "neither quantity nor price moved";
}

// ─── liquidity + burn basis ────────────────────────────────────────────────
//
// Two sections (Financial Health, Treasury Concentration) read the same two
// derived views. They go through these helpers rather than each computing
// their own so a gate and the fragment it gates can never disagree about the
// figure — a section that fires on "under 3 months of stablecoin cover" and
// then prints 3.4 months is worse than a section that never fired.

/** Window for the trailing burn average. Matches the dashboard's burn tile. */
const TRAILING_BURN_MONTHS = 3;

/** Below this many months of stablecoin cover, the concentration section fires. */
const STABLE_COVER_FLOOR_MONTHS = 3;

/**
 * Own-token share of the treasury, in percent, above which concentration is
 * material enough to name. A fifth of the balance sheet is the point at which
 * the reported total stops being a fair proxy for what the project can spend.
 */
const CONCENTRATION_PCT_FLOOR = 20;

function liquidityOf(ctx: ReportSectionContext): TreasuryLiquidity {
  return analyzeTreasuryLiquidity(ctx.snapshot.balancesDetail, ctx.project);
}

interface BurnBasis {
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
function burnBasis(ctx: ReportSectionContext): BurnBasis {
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
function burnBasisLabel(basis: BurnBasis): string {
  if (basis.source === "trailing") {
    return `trailing ${basis.monthsUsed}-mo avg burn`;
  }
  return "this month's burn (no trailing history yet)";
}

/**
 * The four buckets, as prompt bullets. Zero buckets are dropped per house rule
 * — except the own-token bucket, which is stated even at zero when the project
 * has a token, because "the treasury holds none of its own token" is a real
 * and load-bearing finding for the runway figure directly above it.
 */
function liquidityLines(
  liq: TreasuryLiquidity,
  ctx: ReportSectionContext
): string[] {
  const lines: string[] = [];
  if (liq.liquidStableUsd > 0) {
    lines.push(`- Liquid stablecoins: ${formatUsd(liq.liquidStableUsd)}`);
  }
  if (liq.liquidCryptoUsd > 0) {
    const btc =
      liq.btcUsd > 0 ? ` (of which BTC and wrapped BTC: ${formatUsd(liq.btcUsd)})` : "";
    lines.push(
      `- Liquid crypto — ETH, BTC, liquid-staking tokens: ${formatUsd(liq.liquidCryptoUsd)}${btc}`
    );
  }
  const tokenName = ctx.project.tokenSymbol
    ? `${ctx.project.tokenSymbol}, the project's own token`
    : "the project's own token";
  if (liq.concentratedUsd > 0 || ctx.project.tokenSymbol) {
    lines.push(
      `- ${tokenName} — NOT spendable reserves: ${formatUsd(
        liq.concentratedUsd
      )} (${liq.concentrationPct.toFixed(1)}% of the treasury)`
    );
  }
  if (liq.otherUsd > 0) {
    lines.push(
      `- Other assets, unrecognised and treated as illiquid: ${formatUsd(liq.otherUsd)}`
    );
  }
  lines.push(
    `- Spendable liquid reserves (stablecoins + liquid crypto): ${formatUsd(
      liquidReservesUsd(liq)
    )}`
  );
  return lines;
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
// OpenAI from "openai"`, and this file reaches the browser through
// ReportTemplateEditor.tsx. The strings are load-bearing — they must match
// `IncomeCategory` exactly, and the tests assert that they do.

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

interface IncomeGroup {
  /** Categories with a positive figure, largest first. */
  entries: { category: string; label: string; usd: number }[];
  /** Sum of `entries` — always exactly what the bullets add up to. */
  totalUsd: number;
}

interface IncomeSplit {
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
function splitIncome(raw: unknown): IncomeSplit {
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

// ─── individual sections ───────────────────────────────────────────────────

const executiveSummary: ReportSection = {
  id: "executive_summary",
  title: "Executive Summary",
  description:
    "3-4 sentence opening: where the treasury sits, biggest change vs. last month, one forward-looking statement.",
  defaultEnabled: true,
  requires: () => true,
  userPromptFragment: () => "", // handled implicitly by snapshot context
  systemPromptFragment: `### Executive Summary
3-4 sentences. State the treasury position, biggest change vs last month, and one forward-looking statement. Use exact numbers. Never fabricate data.`,
};

const wins: ReportSection = {
  id: "wins",
  title: "Wins this period",
  description:
    "2-3 bullets calling out positive developments — milestones hit, key partnerships, dev velocity. Treasury increases only count when actual inflows caused them.",
  defaultEnabled: true,
  requires: () => true,
  userPromptFragment: () => "",
  systemPromptFragment: `### Wins
2-3 bullet points of positive developments this period. Pull from milestones completed, dev activity spikes, partnerships, or anomaly detector hits flagged as positive.
- Be specific: name the thing, the date, the counterparty, the number. "Shipped v2 mainnet on 12 April" beats "strong development progress."
- Specificity means precise facts, NOT invented explanations. State what happened. Attach a cause only when the input states that cause. Never pair a real number with a reason the input does not contain — a plausible-sounding cause you inferred is a fabrication, and it is indistinguishable from a real one to the investor reading it.
- Do NOT list a treasury increase as a win unless the input attributes that increase to net asset flows — money that actually arrived. An increase the input attributes to price movement of assets already held, to newly-tracked wallets, or to unattributed change is NOT a win: a token appreciating is a market event, not something the team achieved, and an investor who reads it as an achievement has been misled.`,
};

const lowsConcerns: ReportSection = {
  id: "lows_concerns",
  title: "Lows / Concerns",
  description:
    "1-2 bullets honestly naming risks, missed targets, or unexplained metric movements.",
  defaultEnabled: true,
  requires: () => true,
  userPromptFragment: () => "",
  systemPromptFragment: `### Lows / Concerns
1-2 bullet points naming real concerns: missed milestones (status='delayed'), runway shrinking, unexplained outflows, anomaly hits with negative direction. If there's nothing material to flag, write a single sentence acknowledging it ("No material concerns this period — burn and runway tracking to plan."). Don't manufacture a concern.`,
};

const treasuryOverview: ReportSection = {
  id: "treasury_overview",
  title: "Treasury Overview",
  description:
    "Asset breakdown table: stablecoins, native ETH, project token, other holdings.",
  defaultEnabled: true,
  requires: (ctx) => ctx.total > 0,
  userPromptFragment: (ctx) => {
    const { snapshot, project, total, minSignificant } = ctx;
    const lines: string[] = [`- Total balance: ${formatUsd(total)}`];
    const stables = Number(snapshot.stablecoinsUsd ?? 0);
    if (stables > minSignificant) lines.push(`- Stablecoins: ${formatUsd(stables)}`);
    const ethUsd = Number(snapshot.ethUsd ?? 0);
    if (ethUsd > minSignificant) lines.push(`- ETH/WETH: ${formatUsd(ethUsd)}`);
    const nativeUsd = Number(snapshot.nativeTokenUsd ?? 0);
    if (project.tokenSymbol && nativeUsd > minSignificant) {
      lines.push(`- ${project.tokenSymbol} (native token): ${formatUsd(nativeUsd)}`);
    }
    const otherUsd = Number(snapshot.otherAssetsUsd ?? 0);
    if (otherUsd > minSignificant) lines.push(`- Other assets: ${formatUsd(otherUsd)}`);
    return `\n## Current Treasury (${snapshot.snapshotDate})\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Treasury Overview
- Table: Asset | Balance | % of Total
- **Only include rows where Balance > $0.** Skip categories the project does not currently hold — do NOT emit "$0 / 0%" placeholder rows. If the input doesn't list a balance for an asset, that asset doesn't exist in this treasury; pretend it's not even on the menu.
- Total treasury value
- Change vs previous month (absolute and percentage) — only if a Previous Month section appears in the input.`,
  notReadyHint: "Run a sync to fetch wallet balances first.",
};

const treasuryByChain: ReportSection = {
  id: "treasury_by_chain",
  title: "Treasury by Chain",
  description:
    "How balances split across Ethereum, L2s, Solana, etc. Auto-skips for single-chain projects.",
  defaultEnabled: true,
  requires: (ctx) => {
    const byChain =
      (ctx.snapshot.balancesByChain as Record<string, number> | null) ?? null;
    if (!byChain) return false;
    return (
      Object.values(byChain).filter((v) => Number(v) > ctx.minSignificant)
        .length >= 2
    );
  },
  userPromptFragment: (ctx) => {
    const byChain =
      (ctx.snapshot.balancesByChain as Record<string, number> | null) ?? null;
    if (!byChain) return "";
    const entries = Object.entries(byChain).filter(
      ([, v]) => Number(v) > ctx.minSignificant
    );
    if (entries.length < 2) return "";
    const sorted = entries.sort((a, b) => Number(b[1]) - Number(a[1]));
    return `\n## Treasury by chain\n${sorted
      .map(
        ([chain, v]) =>
          `- ${chain}: ${formatUsd(Number(v))} (${(
            (Number(v) / ctx.total) *
            100
          ).toFixed(1)}%)`
      )
      .join("\n")}`;
  },
  systemPromptFragment: `### Treasury by Chain (CONDITIONAL)
- Only render if the input contains a "## Treasury by chain" block with 2+ chains.
- One or two sentences explaining the split. Example: "85% sits on Ethereum mainnet; the remaining 15% is split across Optimism and Base for L2 ops."
- Skip when only one chain is present — "100% on Ethereum" is noise, not analysis.`,
  notReadyHint: "Add wallets on ≥2 chains.",
};

const treasuryConcentration: ReportSection = {
  id: "treasury_concentration",
  title: "Treasury Concentration",
  description:
    "Fires when the treasury leans on the project's own token, or when stablecoins cover under three months of burn. States the split and why own-token holdings don't behave like reserves.",
  defaultEnabled: true,
  // Two independent triggers, because they describe two different problems:
  // a treasury that is mostly a bet on its own token, and a treasury without
  // enough price-stable cash to pay next quarter's bills. Either alone is
  // worth a paragraph.
  //
  // The `derived` gate comes first and is not optional. Without per-token
  // detail every bucket is zero, which reads as "zero months of stablecoin
  // cover" and would fire this section on every legacy snapshot in the
  // database — asserting a liquidity finding from an absence of data.
  requires: (ctx) => {
    const liq = liquidityOf(ctx);
    if (!liq.derived || liq.totalUsd <= 0) return false;
    if (liq.concentrationPct > CONCENTRATION_PCT_FLOOR) return true;
    const basis = burnBasis(ctx);
    if (basis.avgUsd <= 0) return false;
    return liq.liquidStableUsd / basis.avgUsd < STABLE_COVER_FLOOR_MONTHS;
  },
  userPromptFragment: (ctx) => {
    const liq = liquidityOf(ctx);
    if (!liq.derived || liq.totalUsd <= 0) return "";
    const basis = burnBasis(ctx);

    const lines: string[] = [
      `- Total treasury measured per-token: ${formatUsd(liq.totalUsd)}`,
      ...liquidityLines(liq, ctx),
    ];

    if (basis.avgUsd > 0) {
      const cover = liq.liquidStableUsd / basis.avgUsd;
      lines.push(
        `- Stablecoin cover: ${cover.toFixed(
          1
        )} months of spending at the ${burnBasisLabel(basis)} of ${formatUsd(
          basis.avgUsd
        )}`
      );
    } else {
      lines.push(
        `- Stablecoin cover: not measurable — no period on record carries operating outflows to measure it against.`
      );
    }

    return `\n## Treasury concentration and liquidity (${ctx.snapshot.snapshotDate})\n${lines.join(
      "\n"
    )}`;
  },
  systemPromptFragment: `### Treasury Concentration (CONDITIONAL)
- Only render when the input contains a "## Treasury concentration and liquidity" block. Two sentences, maximum.
- Sentence one states the fact, with the input's own figures: what share of the treasury is the project's own token, and how many months of burn the stablecoin holdings cover.
- Sentence two states the mechanism, once: a project's own token cannot be sold at size without moving its price against the project, and it is worth least in exactly the conditions that would force a sale — so it does not behave like reserves.
- **No alarmism and no advice.** Do not write "critical", "dangerous", "at risk", "urgent", or a survival timeline. Do not recommend diversifying, selling, hedging, raising, or extending runway — that is financial advice, and this section does not give it. State the position and the mechanism; the reader draws the conclusion.
- The figures are derived from per-token balances and are approximate at the margins. Never present the split as audited or exact, and never restate the "Other assets" bucket as confirmed-illiquid — it is unclassified.`,
  notReadyHint:
    "Needs a synced snapshot with per-token balances (run a sync), plus either own-token concentration or thin stablecoin cover.",
};

const previousMonthComparison: ReportSection = {
  id: "previous_month_comparison",
  title: "Month-over-Month",
  description:
    "Treasury delta vs. last snapshot, split into what actually moved in or out versus what was just re-priced by the market.",
  defaultEnabled: true,
  requires: (ctx) => Boolean(ctx.prevSnapshot),
  userPromptFragment: (ctx) => {
    if (!ctx.prevSnapshot) return "";
    const cur = Number(ctx.snapshot.totalBalanceUsd ?? 0);
    const prev = Number(ctx.prevSnapshot.totalBalanceUsd ?? 0);
    const delta = cur - prev;
    const pct = prev > 0 ? ((delta / prev) * 100).toFixed(1) : "N/A";

    const attribution = attributeTreasuryChange(
      ctx.prevSnapshot.balancesDetail,
      ctx.snapshot.balancesDetail
    );
    const driver = dominantDriver(attribution);

    // Snapshots predating `balances_detail`, and payloads that no longer
    // parse, both aggregate to nothing rather than throwing — no token rows
    // and no movement to name. There is genuinely nothing to attribute, so
    // fall back to the total-balance block this section emitted before
    // attribution existed. A header promising a breakdown with no breakdown
    // under it invites the model to fill the gap itself.
    if (attribution.tokens.length === 0 || driver.driver === "none") {
      return `\n## Previous Month Treasury\n- Total balance: ${formatUsd(prev)}\n- Change: ${formatUsd(delta)} (${pct}%)`;
    }

    const gapDays = gapInDays(
      ctx.prevSnapshot.snapshotDate,
      ctx.snapshot.snapshotDate
    );
    const gapLabel = gapDays === null ? "" : `, ${gapDays} days`;

    const lines: string[] = [
      `- Previous total balance (${ctx.prevSnapshot.snapshotDate}): ${formatUsd(prev)}`,
      `- Current total balance (${ctx.snapshot.snapshotDate}): ${formatUsd(cur)}`,
      // Percent is dropped rather than printed as "N/A" when the prior total
      // is zero — house rule is silence over placeholders.
      `- Total change: ${signedUsd(delta)}${prev > 0 ? ` (${pct}%)` : ""}`,
      "",
      "Where that change came from (these components sum to the change):",
    ];

    // House style: drop the bullet rather than print a $0 line. A component
    // below the significance floor is noise the model would otherwise feel
    // obliged to narrate.
    const components: [number, string][] = [
      [attribution.flowUsd, "Net asset flows (deposits minus withdrawals)"],
      [attribution.priceEffectUsd, "Price movement of assets already held"],
      [attribution.crossUsd, "Quantity and price moving at the same time"],
      [
        attribution.walletSetUsd,
        "Newly-tracked or dropped wallets (coverage change — NOT an inflow or outflow)",
      ],
      [attribution.unpricedUsd, "Unattributed (price data missing)"],
    ];
    for (const [usd, label] of components) {
      if (Math.abs(usd) > ctx.minSignificant) {
        lines.push(`- ${label}: ${signedUsd(usd)}`);
      }
    }

    lines.push(
      `- Dominant driver: ${DRIVER_LABELS[driver.driver]} (${signedUsd(
        driver.usd
      )}, ${(driver.share * 100).toFixed(0)}% of all movement)`
    );

    // Two independent estimates of "money moved": this one derived from
    // balances, `netFlowUsd` derived from parsed transactions. Whether they
    // agree is the single best signal for how hard the report may lean on the
    // flow number. Absent means absent — coercing null to 0 would invent a
    // "no money moved" reading and then score it as a divergence.
    const netFlowUsd =
      ctx.snapshot.netFlowUsd == null ? null : Number(ctx.snapshot.netFlowUsd);
    const reconciliation = reconcileWithNetFlow(attribution, netFlowUsd);
    if (reconciliation.verdict === "unavailable") {
      lines.push(
        `- Cross-check vs transaction-derived net flow: UNAVAILABLE — the two estimates are not comparable this period. Treat the flow figure above as a single unconfirmed estimate.`
      );
    } else {
      const pctApart =
        reconciliation.divergencePct === null
          ? ""
          : `, ${(reconciliation.divergencePct * 100).toFixed(0)}% apart`;
      lines.push(
        `- Cross-check vs transaction-derived net flow: ${reconciliation.verdict.toUpperCase()} — balance-derived flow ${signedUsd(
          attribution.flowUsd
        )} vs transaction-derived net flow ${signedUsd(
          netFlowUsd ?? 0
        )} (gap ${signedUsd(reconciliation.divergenceUsd)}${pctApart}).`
      );
    }

    // Sorted by absolute impact upstream. Three is enough to show the model
    // which position drove the number without letting a long tail of dust
    // positions into the prompt.
    const topTokens = attribution.tokens
      .filter((t) => Math.abs(t.deltaUsd) > ctx.minSignificant)
      .slice(0, 3);
    if (topTokens.length > 0) {
      lines.push("", "Largest per-token contributors:");
      for (const t of topTokens) {
        lines.push(
          `- ${t.symbol || "unknown"} on ${t.chain}: ${signedUsd(
            t.deltaUsd
          )} — quantity ${formatQty(t.qtyPrev)} → ${formatQty(
            t.qtyCurr
          )}, price ${formatPrice(t.pricePrev)} → ${formatPrice(
            t.priceCurr
          )} (${tokenMovement(t)})`
        );
      }
    }

    if (gapDays !== null && gapDays > LONG_GAP_DAYS) {
      lines.push(
        "",
        `NOTE: these snapshots are ${gapDays} days apart, far longer than one reporting period. The flow figure above covers that entire ${gapDays}-day window, while the inflow, outflow and net flow totals elsewhere in this input cover only the reporting period. Do NOT compare, reconcile or add the two. Do NOT present the flow figure as this period's movement — say explicitly that it spans ${gapDays} days.`
      );
    }

    return `\n## Treasury change (${ctx.snapshot.snapshotDate} vs ${ctx.prevSnapshot.snapshotDate}${gapLabel})\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Month-over-Month (CONDITIONAL)
- Only render if a "## Treasury change" block (or the legacy "## Previous Month Treasury" block) appears in the input.
- Open with a single sentence summarising the delta with a directional verb ("grew", "shrank by", "held steady at"). Don't dramatize a 0.5% move.
- **When the input carries a "Where that change came from" breakdown, naming the driver is MANDATORY, not optional.** The delta never stands alone: the very next sentence states which component moved it, quoting the input's own figures. A total change reported without its attribution is an incomplete answer, not a shorter one.
- **If price movement of assets already held is the dominant driver, say so plainly and do not call it growth.** The treasury was re-priced; the team did not bring money in. Do not use "grew", "gained", "raised", "inflow", "added", or any verb implying the project earned or received value. The shape to use: "Treasury value rose $4.9M, driven almost entirely by the price of assets already held; net asset flows were roughly flat."
- **"Newly-tracked or dropped wallets" is NEVER an inflow or an outflow.** It is a change in what is being measured — wallets added to or removed from coverage. Report it as coverage expanding or contracting, with its figure stated separately. Describing it as a deposit, a raise, a withdrawal, or growth is a false statement about the treasury.
- "Unattributed" means a price feed was missing for part of the treasury, not that value appeared or vanished. Report it as unattributed and, when it is large relative to the total change, say the change is only partly explained.
- Report the cross-check line as given. CONSISTENT means the two independent estimates agree and the flow figure can be stated directly. DIVERGING means they disagree — say the balance-derived flow is not confirmed by the recorded transactions and hedge accordingly. UNAVAILABLE means no comparison was possible — never present the flow figure as verified.
- **Never assert a cause the input does not support.** The input names components, not reasons. "Driven by price movement" is supported — it is a component the data measures. "Driven by the funding round", "on the back of revenue", "following the partnership announcement" are NOT, unless that cause appears verbatim elsewhere in this input. When no cause is available, name the component and stop.`,
  notReadyHint: "Needs at least one prior monthly snapshot.",
};

const financialHealth: ReportSection = {
  id: "financial_health",
  title: "Financial Health",
  description:
    "Burn rate, runway in months, total inflows/outflows for the period.",
  defaultEnabled: true,
  requires: (ctx) =>
    Number(ctx.snapshot.burnRateUsd ?? 0) > 0 ||
    Number(ctx.snapshot.totalInflowsUsd ?? 0) > 0 ||
    Number(ctx.snapshot.totalOutflowsUsd ?? 0) > 0,
  userPromptFragment: (ctx) => {
    const lines: string[] = [];
    const { snapshot } = ctx;
    const liq = liquidityOf(ctx);
    const basis = burnBasis(ctx);
    const currentBurn = Number(snapshot.burnRateUsd ?? 0);

    if (snapshot.burnRateUsd) {
      lines.push(
        `- Monthly burn rate (this period): ${formatUsd(currentBurn)}`
      );
    }

    if (basis.source === "trailing") {
      lines.push(
        `- Trailing ${TRAILING_BURN_MONTHS}-month average burn: ${formatUsd(
          basis.avgUsd
        )} — averaged over the ${basis.monthsUsed} prior period${
          basis.monthsUsed === 1 ? "" : "s"
        } that recorded operating outflows${
          basis.monthsUsed < TRAILING_BURN_MONTHS
            ? ". THIN SAMPLE — say how many periods it covers whenever you quote a figure derived from it"
            : ""
        }`
      );
      const trend = burnTrend(currentBurn, basis.avgUsd);
      if (trend !== "unknown") {
        lines.push(`- Burn trend vs that trailing average: ${trend}`);
      }
    }

    // Both runway figures, always labelled with their own denominator. The
    // stored column divides the WHOLE treasury — own token, unrecognised
    // assets and all — by one month's burn, and is charted on the dashboard,
    // so it is reported rather than quietly redefined. The liquid figure is
    // the one an investor can act on.
    const storedRunway =
      snapshot.runwayMonths == null ? null : Number(snapshot.runwayMonths);
    if (storedRunway != null && Number.isFinite(storedRunway) && storedRunway > 0) {
      lines.push(
        `- Runway (total treasury ÷ this month's burn): ${storedRunway.toFixed(
          1
        )} months — an UPPER BOUND only: it counts the project's own token and every unrecognised asset as spendable, and divides by a single month`
      );
    } else if (currentBurn <= 0) {
      lines.push(
        `- Runway (total treasury ÷ this month's burn): NOT MEASURABLE this period — no operating outflows were recorded, so the ratio has no denominator. This does NOT mean the runway is zero or short; do not report it as a number, and do not imply the project is out of money.`
      );
    }

    const reserves = liquidReservesUsd(liq);
    if (!liq.derived) {
      lines.push(
        `- Runway (liquid reserves ÷ average burn): NOT COMPUTABLE — this snapshot stores no per-token balance detail, so spendable reserves cannot be separated from the project's own token. Do NOT present the total-treasury figure above as a liquid or conservative runway.`
      );
    } else if (basis.source === "none") {
      lines.push(
        `- Runway (liquid reserves ÷ average burn): NOT MEASURABLE — no period on record carries operating outflows to divide by. Spendable liquid reserves are ${formatUsd(
          reserves
        )}. Do not state this as a runway of zero.`
      );
    } else {
      const months = liquidRunwayMonths(reserves, basis.avgUsd);
      if (months != null) {
        lines.push(
          `- Runway (liquid reserves ÷ ${burnBasisLabel(
            basis
          )}): ${months.toFixed(
            1
          )} months — the conservative figure, and the one to lead with`
        );
      }
    }

    if (snapshot.totalInflowsUsd) {
      lines.push(`- Total inflows: ${formatUsd(Number(snapshot.totalInflowsUsd))}`);
    }
    if (snapshot.totalOutflowsUsd) {
      lines.push(`- Total outflows: ${formatUsd(Number(snapshot.totalOutflowsUsd))}`);
    }
    // Presence check, not truthiness, unlike the lines above: a net flow of
    // exactly zero is a real finding (money moved both ways and cancelled),
    // and only null means the transaction sync produced no figure. The sign
    // is spelled out because "$4.9M" and "-$4.9M" are opposite stories and a
    // dropped minus turns a drawdown into a raise.
    if (snapshot.netFlowUsd != null) {
      lines.push(
        `- Net flow (inflows minus outflows): ${signedUsd(Number(snapshot.netFlowUsd))}`
      );
    }
    if (lines.length === 0) return "";

    if (liq.derived) {
      lines.push(
        "",
        "Treasury liquidity — what those reserves actually consist of, derived per-token from the stored balances:",
        ...liquidityLines(liq, ctx)
      );
    }

    return `\n## Financial Metrics\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Financial Health
- **Lead with the liquid runway** — "Runway (liquid reserves ÷ ...)" — and identify what it divides: spendable reserves (stablecoins plus liquid crypto) over average burn. It is the figure an investor can act on, and it is the headline.
- The input may carry TWO runway figures with different denominators. Report both only when you also state what separates them, and NEVER present the total-treasury figure as the headline when the input shows the project holds its own token. The total-treasury figure counts that token as spendable, and a DAO cannot sell its own token at size without moving the price against itself — worst of all in the moment it most needs to sell. Quoting it alone overstates survival time, often by years.
- A runway figure marked NOT MEASURABLE or NOT COMPUTABLE is not a runway of zero and not a short runway. Say the period gives no basis for the figure, in one clause, and move on — never print "0 months", never imply the money has run out, and never substitute the other runway figure in its place.
- When the trailing average is flagged THIN SAMPLE, state how many periods it covers in the same sentence that quotes any figure derived from it. A one-month "trailing average" presented as three months misrepresents the evidence even when the number is right.
- Report the burn trend only as the input labels it (accelerating / stable / decelerating), and only against the trailing average. Do not infer a trend from a single period, and do not explain the cause of one — the input carries no causes.
- When the input lists the liquidity breakdown, give the split in one or two sentences: how much is stablecoins, how much is volatile-but-liquid crypto, how much is the project's own token, how much is unrecognised. Assets in the "Other" bucket are unrecognised, NOT confirmed illiquid — say "not classified" rather than asserting they cannot be sold.
- Monthly burn rate (only if available).
- Inflows and outflows totals — only the ones the input provides.
- When the input gives a net flow, report it alongside inflows and outflows — it is what reconciles them, and omitting it leaves the reader unable to tell whether the treasury took in more than it paid out. Preserve its sign: a negative net flow means the project paid out more than it received, and must read that way. Never state it as a bare positive figure.
- Do NOT echo "Not available" for missing fields. Drop the bullet.`,
  notReadyHint: "Needs at least one period with inflows or outflows.",
};

const expenseBreakdown: ReportSection = {
  id: "expense_breakdown",
  title: "Operating Expenses",
  description:
    "Per-category expense table (payroll, infra, audits, marketing, etc.).",
  defaultEnabled: true,
  requires: (ctx) => {
    if (!ctx.snapshot.expensesByCategory) return false;
    const all = ctx.snapshot.expensesByCategory as Record<string, number>;
    return Object.entries(all).some(([k, v]) => v > 0 && k !== "token_sale");
  },
  userPromptFragment: (ctx) => {
    if (!ctx.snapshot.expensesByCategory) return "";
    const all = ctx.snapshot.expensesByCategory as Record<string, number>;
    const operating = Object.entries(all).filter(
      ([k, v]) => v > 0 && k !== "token_sale"
    );
    if (operating.length === 0) return "";
    return `\nOperating expenses (excludes treasury reallocation):\n${operating
      .map(([k, v]) => `- ${k}: ${formatUsd(v)}`)
      .join("\n")}`;
  },
  systemPromptFragment: `### Operating Expenses (CONDITIONAL)
- Render as a category table only when the input lists at least one operating expense category.
- Notable changes vs previous month — only if a previous month was provided AND there's a real delta to discuss. Otherwise skip.`,
  notReadyHint: "Needs operating outflows in this period (rebalances don't count).",
};

const protocolRevenue: ReportSection = {
  id: "protocol_revenue",
  title: "Protocol Revenue",
  description:
    "What the protocol actually earns (fees, staking rewards) held apart from one-off inflows like funding rounds and token sales.",
  defaultEnabled: true,
  // The gate is deliberately narrow: recurring income only. A period whose
  // entire inflow is a funding round has no revenue to report, and rendering a
  // "Protocol Revenue" heading over a raise is precisely the category error
  // this section exists to prevent — the heading alone does the misleading,
  // before the model writes a word. `minSignificant` (0.1% of treasury) is the
  // floor: a few hundred dollars of dust yield is not a revenue line.
  requires: (ctx) =>
    splitIncome(ctx.snapshot.incomeByCategory).recurring.totalUsd >
    ctx.minSignificant,
  userPromptFragment: (ctx) => {
    const split = splitIncome(ctx.snapshot.incomeByCategory);
    if (split.recurring.totalUsd <= 0) return "";

    const lines: string[] = [
      "Recurring operating income — money the protocol earned, expected to recur:",
      ...split.recurring.entries.map(
        (e) => `- ${e.label}: ${formatUsd(e.usd)}`
      ),
      `- Total recurring operating income: ${formatUsd(split.recurring.totalUsd)}`,
    ];

    if (split.nonRecurring.entries.length > 0) {
      lines.push(
        "",
        "Non-recurring income — one-off events. NOT revenue, NOT earned, and NOT to be added to the figures above:",
        ...split.nonRecurring.entries.map(
          (e) => `- ${e.label}: ${formatUsd(e.usd)}`
        ),
        `- Total non-recurring income: ${formatUsd(split.nonRecurring.totalUsd)}`
      );

      // The single number that stops "the protocol brought in $5.1M" from
      // being written about a period that earned $138K and raised $5M.
      const allIncome =
        split.recurring.totalUsd + split.nonRecurring.totalUsd;
      if (allIncome > 0) {
        lines.push(
          `- Recurring share of all income this period: ${(
            (split.recurring.totalUsd / allIncome) *
            100
          ).toFixed(1)}%`
        );
      }
    }

    // Prior-period recurring income, so a direction can be stated from two
    // measured figures rather than inferred from one. Absent means absent: the
    // model is told to say nothing about direction, because "flat" and
    // "growing" are both claims and neither is supported by one period.
    const prevSplit = splitIncome(ctx.prevSnapshot?.incomeByCategory);
    const prevDate = ctx.prevSnapshot?.snapshotDate;
    lines.push("");
    if (!ctx.prevSnapshot || !prevSplit.classified) {
      lines.push(
        "Prior-period comparison: NOT AVAILABLE — no classified income breakdown exists for an earlier period. Do not state a direction, trend or trajectory for revenue."
      );
    } else if (prevSplit.recurring.totalUsd <= 0) {
      lines.push(
        `Prior period (${prevDate}): the income classifier recorded no recurring operating income. This period is the first with a recurring figure — state that, and do not express it as a percentage increase from zero.`
      );
    } else {
      const prev = prevSplit.recurring.totalUsd;
      const delta = split.recurring.totalUsd - prev;
      const pct = ((delta / prev) * 100).toFixed(1);
      lines.push(
        `Prior period (${prevDate}) recurring operating income: ${formatUsd(prev)}`,
        `Change in recurring operating income: ${signedUsd(delta)} (${
          delta >= 0 ? "+" : ""
        }${pct}%)`
      );
    }

    return `\n## Income by source (${ctx.snapshot.snapshotDate})\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Protocol Revenue (CONDITIONAL)
- Only render when the input contains an "## Income by source" block.
- The block splits income into two groups. **Report them separately and keep them separate.** Recurring operating income is what the protocol earns. Non-recurring income is capital and windfalls that arrived once.
- **Never add the two groups into a single figure**, and never report a "total income" or "total inflows" number inside this section. A blended figure that is mostly a funding round tells an investor the protocol earns money it does not earn — that is the single worst error this section can make, and it is unrecoverable once the reader has seen the number.
- **Never call a funding round, token sale proceeds, or an airdrop "revenue", "earnings", "income the protocol generated", "money the protocol brought in", or any synonym.** Name each for what it is: capital raised from investors, proceeds from selling treasury tokens, tokens received.
- Lead with the recurring figure and identify it as recurring. If non-recurring income is present, give it its own sentence with its own label; when the input reports a recurring share of all income, use that percentage to make the proportion explicit.
- **One period is not a trend.** Do not write "growing", "accelerating", "ramping", "steady", "consistent", or "on track" off a single period's figure. When the input carries a prior-period recurring figure, state the direction using both numbers. When it says the comparison is NOT AVAILABLE, say nothing about direction at all — not even "flat".
- Do not explain *why* recurring income moved. The input carries category totals, not causes. Attributing a revenue change to a launch, a partnership, or market conditions is fabrication unless that cause appears verbatim elsewhere in this input.`,
  notReadyHint:
    "Needs classified income for this period — recurring revenue or staking rewards above the reporting floor.",
};

const treasuryOperations: ReportSection = {
  id: "treasury_operations",
  title: "Treasury Operations",
  description:
    "token_sale rebalances kept separate from operating expenses (so they don't inflate burn).",
  defaultEnabled: true,
  requires: (ctx) => {
    if (!ctx.snapshot.expensesByCategory) return false;
    const all = ctx.snapshot.expensesByCategory as Record<string, number>;
    return (all.token_sale ?? 0) > 0;
  },
  userPromptFragment: (ctx) => {
    if (!ctx.snapshot.expensesByCategory) return "";
    const all = ctx.snapshot.expensesByCategory as Record<string, number>;
    const tokenSale = all.token_sale ?? 0;
    if (tokenSale <= 0) return "";
    return `\n\nTreasury operations (NOT operating expenses — stablecoin/native-token rebalancing):\n- token_sale: ${formatUsd(tokenSale)}`;
  },
  systemPromptFragment: `### Treasury Operations (CONDITIONAL)
- Render this section ONLY when the input lists a non-zero "token_sale" line in Treasury operations.
- token_sale outflows are treasury reallocations (e.g. swapping native token for stablecoins or vice versa), NOT operating expenses. Never include them in the expense breakdown table; show them separately here with a one-sentence explanation of what was rebalanced.`,
  notReadyHint: "Only renders when there's a token_sale rebalance in the period.",
};

/**
 * One table row. Pipe-delimited rather than markdown-table syntax: the model
 * is composing the report's own table, and handing it a finished one invites
 * a verbatim copy including any formatting that clashes with the rest of the
 * document. Empty fields get an explicit word — a bare `| |` reads as an
 * omission the model may feel entitled to fill.
 */
function majorTxRow(tx: MajorTransaction): string {
  const direction = tx.direction === "in" ? "incoming" : "outgoing";
  return [
    tx.date || "unknown",
    direction,
    formatUsd(tx.valueUsd),
    tx.token,
    tx.category || "unclassified",
    tx.counterparty || "unidentified address",
  ].join(" | ");
}

const majorTransactions: ReportSection = {
  id: "major_transactions",
  title: "Major Transactions",
  description:
    "The period's largest individual transfers, with counterparty and classification. Internal wallet-to-wallet moves excluded.",
  defaultEnabled: true,
  requires: (ctx) =>
    extractMajorTransactions(ctx.snapshot.transactionsRaw, ctx.total).rows
      .length > 0,
  userPromptFragment: (ctx) => {
    const result = extractMajorTransactions(
      ctx.snapshot.transactionsRaw,
      ctx.total
    );
    if (result.rows.length === 0) return "";

    const lines: string[] = [
      `Every transaction at or above ${formatUsd(
        result.thresholdUsd
      )} (the larger of $25,000 and 0.5% of treasury), largest first. Transfers between the project's own wallets are excluded — they move nothing. Transactions whose USD value could not be priced are excluded — their value is not known.`,
      "",
      "Date | Direction | Amount | Asset | Category | Counterparty",
      ...result.rows.map((tx) => `- ${majorTxRow(tx)}`),
    ];

    if (result.qualifyingCount > result.rows.length) {
      lines.push(
        "",
        `Showing the ${result.rows.length} largest of ${result.qualifyingCount} transactions that cleared the threshold.`
      );
    }

    // The disclosure. data-sync.ts stores the most RECENT transactions, not
    // the largest, so once that store was capped these rows are "largest among
    // the recent ones" and a bigger transfer may sit outside the window
    // entirely. Nothing downstream can detect that, and re-sampling only helps
    // snapshots not yet taken — so the report says it out loud instead of
    // quietly presenting a partial ranking as a complete one.
    if (result.capped) {
      const of =
        result.totalCount === null
          ? ""
          : ` of ${result.totalCount.toLocaleString()} recorded for the period`;
      lines.push(
        "",
        `SAMPLING NOTE: this snapshot stored only the ${result.sampleSize.toLocaleString()} most recent transactions${of}. The rows above are the largest within that sample, NOT necessarily the largest of the period — a larger transaction may have occurred earlier in the period and fallen outside what was stored. This caveat MUST appear in the section.`
      );
    }

    return `\n## Major transactions (${ctx.snapshot.snapshotDate})\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Major Transactions (CONDITIONAL)
- Only render when the input contains a "## Major transactions" block.
- Render a table with the columns Date | Direction | Amount | Asset | Category | Counterparty, one row per listed transaction, values copied from the input. A row whose Date reads "unknown" has no usable timestamp in the stored data — leave that cell blank rather than guessing or inferring a date.
- **Never invent a purpose for a transfer.** The input records what moved, when, and to or from whom. It does not record why. Commentary is allowed only where the category and counterparty in the row already carry it: "a $1.2M USDC transfer to Binance, classified as a token sale" is supportable because every element of it is in the input. "Sold treasury assets to fund operations", "paid down vendor obligations", "deployed capital into the ecosystem", "took profit" are NOT supportable — each asserts an intent the data cannot show.
- A counterparty shown as a truncated address ("0x1234…abcd") is an address and nothing else. Do not name an entity, a relationship, or a category of business for it. A row marked "unclassified" or "unidentified address" gets stated plainly, with no inference attached.
- At most two sentences of commentary in total, and only if a row genuinely supports it. A bare table with no commentary is a correct, complete answer here.
- **If the input carries a SAMPLING NOTE, the rendered section MUST carry that caveat** — one short sentence stating the list is drawn from the period's most recent stored transactions and may not include the period's largest. Do not present the table as the definitive list of the largest transactions. Dropping this caveat misrepresents what the numbers are; it is not a stylistic trim.
- Never describe this table as complete, exhaustive, or "all transactions". Transfers below the stated threshold, internal transfers, and unpriced transfers are all excluded by construction.`,
  notReadyHint:
    "Needs a synced period containing transactions above the reporting threshold.",
};

const grantsDistributed: ReportSection = {
  id: "grants_distributed",
  title: "Grants Distributed",
  description:
    "Grant commitments and disbursements for the period. Foundation-shaped projects.",
  defaultEnabled: false,
  requires: (ctx) =>
    ctx.grants.some((g) => g.period === ctx.period),
  userPromptFragment: (ctx) => {
    const list = ctx.grants.filter((g) => g.period === ctx.period);
    if (list.length === 0) return "";
    const committed = list
      .filter((g) => g.status === "committed")
      .reduce((s, g) => s + Number(g.amountUsd), 0);
    const disbursed = list
      .filter((g) => g.status === "disbursed")
      .reduce((s, g) => s + Number(g.amountUsd), 0);
    const lines = list.map(
      (g) =>
        `- ${g.recipient}: ${formatUsd(Number(g.amountUsd))} (${g.status}${
          g.category ? `, ${g.category}` : ""
        })${g.notes ? ` — ${g.notes}` : ""}`
    );
    return `\n## Grants this period\n- Committed: ${formatUsd(committed)}\n- Disbursed: ${formatUsd(disbursed)}\n\nGrant list:\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Grants Distributed (CONDITIONAL)
- Only render when the input includes a "## Grants this period" block.
- Lead with two sub-bullets: total committed this period, total disbursed this period (use the figures verbatim from the input).
- If 5+ grants are listed, group by category (when present) into a short table; otherwise render as bullets.
- Don't editorialize — state recipients, amounts, status. Investors compare deployment efficiency, not narrative.`,
  notReadyHint: "Click Edit data to add grants for this period.",
};

const tokenMetrics: ReportSection = {
  id: "token_metrics",
  title: "Token Metrics",
  description:
    "Price, market cap, holders, circulating supply for the project's native token.",
  defaultEnabled: true,
  requires: (ctx) => Boolean(ctx.project.tokenSymbol),
  userPromptFragment: (ctx) => {
    const { snapshot, project } = ctx;
    const lines: string[] = [];
    if (snapshot.tokenPriceUsd) {
      lines.push(`- Price: $${Number(snapshot.tokenPriceUsd).toFixed(4)}`);
    }
    if (snapshot.tokenMarketCapUsd) {
      lines.push(
        `- Market cap: ${formatUsd(Number(snapshot.tokenMarketCapUsd))}`
      );
    }
    if (snapshot.tokenHoldersCount) {
      lines.push(`- Holders: ${snapshot.tokenHoldersCount.toLocaleString()}`);
    }
    if (snapshot.tokenCirculatingSupply) {
      lines.push(
        `- Circulating supply: ${Number(snapshot.tokenCirculatingSupply).toLocaleString()}`
      );
    }
    if (lines.length === 0) return "";
    return `\n## Token Metrics (${project.tokenSymbol ?? "Token"})\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Token Metrics (CONDITIONAL — only render if input includes a Token Metrics section)
- Holder count and change — only render the bullet if a number is provided.
- Price and market cap — only if provided.
- Circulating vs total supply — only if BOTH numbers are provided. Don't write "Circulating: X, total: Not available".
- If the entire Token Metrics block has only one or two data points, render those without listing the missing ones. Never echo "Not available" to investors.`,
  notReadyHint: "Set 'Token symbol' in Project settings.",
};

const governanceUpdates: ReportSection = {
  id: "governance_updates",
  title: "Governance Updates",
  description:
    "Proposals voted, voting turnout, key governance forum activity. DAO-shaped projects.",
  defaultEnabled: false,
  requires: (ctx) =>
    ctx.governanceProposals.some((p) => p.period === ctx.period),
  userPromptFragment: (ctx) => {
    const list = ctx.governanceProposals.filter(
      (p) => p.period === ctx.period
    );
    if (list.length === 0) return "";
    const lines = list.map((p) => {
      const tag = `[${p.status}]`;
      const link = p.url ? ` (${p.url})` : "";
      const tail = p.voteResult
        ? ` — ${p.voteResult}`
        : p.notes
          ? ` — ${p.notes}`
          : "";
      return `- ${tag} ${p.title}${link}${tail}`;
    });
    return `\n## Governance this period\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Governance Updates (CONDITIONAL)
- Only render when the input includes a "## Governance this period" block.
- 2-3 bullets max: proposals submitted, proposals passed/rejected, notable active debates.
- Quote vote results verbatim if provided. Don't speculate on outcomes for active proposals.
- Link out via the URL when present (founder may have provided Snapshot/Tally permalinks).`,
  notReadyHint: "Click Edit data to add proposals for this period.",
};

const developmentProgress: ReportSection = {
  id: "development_progress",
  title: "Development Progress",
  description:
    "GitHub activity: commits, PRs merged, active contributors this period.",
  defaultEnabled: true,
  requires: (ctx) => {
    const c = ctx.snapshot.githubCommitsCount ?? 0;
    const p = ctx.snapshot.githubPrsMerged ?? 0;
    const r = ctx.snapshot.githubContributorsActive ?? 0;
    return c + p + r > 0;
  },
  userPromptFragment: (ctx) => {
    const c = ctx.snapshot.githubCommitsCount ?? 0;
    const p = ctx.snapshot.githubPrsMerged ?? 0;
    const r = ctx.snapshot.githubContributorsActive ?? 0;
    if (c + p + r === 0) return "";
    return `\n## Development Activity\n- Commits: ${c}\n- PRs merged: ${p}\n- Active contributors: ${r}`;
  },
  systemPromptFragment: `### Development Progress (CONDITIONAL)
- GitHub activity summary (commits, PRs, contributors) — ONLY if the input's "Development Activity" block lists numbers > 0.
- If the block shows all zeros, OMIT this entire section. Don't echo zeros or "Not available".`,
  notReadyHint: "Connect a GitHub org in Project settings.",
};

const milestonesCompleted: ReportSection = {
  id: "milestones_completed",
  title: "Milestones Completed",
  description:
    "Milestones marked completed during the reporting period.",
  defaultEnabled: true,
  requires: (ctx) =>
    ctx.milestones.some((m) => m.status === "completed" && m.completedDate),
  userPromptFragment: (ctx) => {
    const recently = ctx.milestones
      .filter((m) => m.status === "completed" && m.completedDate)
      .sort((a, b) =>
        String(b.completedDate ?? "").localeCompare(
          String(a.completedDate ?? "")
        )
      )
      .slice(0, 5);
    if (recently.length === 0) return "";
    return `\n## Milestones Completed\n${recently
      .map(
        (m) =>
          `- ${m.title}${m.completedDate ? ` (${m.completedDate})` : ""}${m.description ? ` — ${m.description}` : ""}`
      )
      .join("\n")}`;
  },
  systemPromptFragment: `### Milestones Completed (CONDITIONAL)
- Only render if the input includes a "## Milestones Completed" block.
- One bullet per milestone with the date and a tight one-sentence description.
- Don't editorialize ("massive achievement!"); just state what shipped.`,
  notReadyHint: "Mark a milestone as completed in Project settings.",
};

const partnersIntegrations: ReportSection = {
  id: "partners_integrations",
  title: "Partners & Integrations",
  description:
    "New partnerships, integrations, exchange listings, bridges. Off by default — user opts in.",
  defaultEnabled: false,
  requires: (ctx) => ctx.partners.some((p) => p.period === ctx.period),
  userPromptFragment: (ctx) => {
    const list = ctx.partners.filter((p) => p.period === ctx.period);
    if (list.length === 0) return "";
    const lines = list.map((p) => {
      const type = p.type ? ` (${p.type})` : "";
      const link = p.url ? ` — ${p.url}` : "";
      const tail = p.notes ? ` · ${p.notes}` : "";
      return `- ${p.name}${type}${link}${tail}`;
    });
    return `\n## Partners this period\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Partners & Integrations (CONDITIONAL)
- Only render when the input includes a "## Partners this period" block.
- Bullets only. No marketing prose ("excited to announce", "thrilled to partner with"). Just: who, what kind, link.
- Group consecutively when multiple share a type (e.g. several listings, several bridges).`,
  notReadyHint: "Click Edit data to add partners announced this period.",
};

const anomalies: ReportSection = {
  id: "anomalies",
  title: "Anomalies",
  description:
    "Statistical anomalies vs. trailing average — sudden cost spikes, dev-activity drops, etc.",
  defaultEnabled: true,
  // gated by the anomaly detector — handled in report-generator, not here
  requires: () => true,
  userPromptFragment: () => "",
  systemPromptFragment: `### Anomalies (CONDITIONAL)
- If the input contains an "Anomalies" section listing metric deltas vs trailing average, mention each one in the Executive Summary with one short sentence per anomaly.
- Don't fabricate causes — if no contextual reason is available, write "warrants investigation" or "see breakdown below". Never invent reasons.
- Critical-severity anomalies (>100% change) deserve a sentence in their own; minor anomalies can be combined ("payroll up 35%, marketing down 40%").
- If no Anomalies section is provided in input, do NOT add this commentary.`,
};

const lookingAhead: ReportSection = {
  id: "looking_ahead",
  title: "Looking Ahead",
  description:
    "Forward-looking commentary tied to active milestones or recent funding round.",
  defaultEnabled: true,
  requires: (ctx) => {
    const hasActive = ctx.milestones.some(
      (m) =>
        m.status === "in_progress" ||
        m.status === "planned" ||
        m.status === "delayed"
    );
    return hasActive || Boolean(ctx.project.lastFundingRound);
  },
  userPromptFragment: (ctx) => {
    const active = ctx.milestones.filter(
      (m) =>
        m.status === "in_progress" ||
        m.status === "planned" ||
        m.status === "delayed"
    );
    if (active.length === 0) return "";
    return `\n## Active / Upcoming Milestones\n${active
      .map(
        (m) =>
          `- [${m.status}] ${m.title}${m.targetDate ? ` (target: ${m.targetDate})` : ""}${m.description ? ` — ${m.description}` : ""}`
      )
      .join("\n")}`;
  },
  systemPromptFragment: `### Looking Ahead (CONDITIONAL)
- Include this section ONLY when the input contains either active milestones or a recent funding round.
- If neither is present, OMIT the section entirely. Never write generic placeholders like "the team plans to focus on continuing core development" or "specific milestones are not available at this time" — silence is better than filler.
- When included: name specific milestones (with target dates if known) or tie next-month focus to the funding round just raised.`,
  notReadyHint: "Add an active milestone or recent funding round.",
};

const asks: ReportSection = {
  id: "asks",
  title: "Asks",
  description:
    "Specific requests to investors (intros, governance votes, hiring help). Off by default — opt in when relevant.",
  defaultEnabled: false,
  // Asks are NOT period-bound — they live until founder marks resolved.
  // Open asks ride along with every report until closed.
  requires: (ctx) => ctx.asks.some((a) => a.status === "open"),
  userPromptFragment: (ctx) => {
    const list = ctx.asks.filter((a) => a.status === "open");
    if (list.length === 0) return "";
    const lines = list.map(
      (a) => `- ${a.request}${a.category ? ` _(${a.category})_` : ""}`
    );
    return `\n## Asks (open)\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Asks (CONDITIONAL)
- Only render when the input contains an "## Asks (open)" block.
- One bullet per ask with the specific action required (intro to X, vote on proposal Y, hire Z role).
- Preserve the founder's wording. Don't paraphrase.
- Don't write "no asks this period" — silence beats placeholder.`,
  notReadyHint: "Click Edit data to add open asks.",
};

const qaHighlights: ReportSection = {
  id: "qa_highlights",
  title: "Q&A Highlights",
  description:
    "Curated questions + answers from a tokenholder call or AMA. Manually entered.",
  defaultEnabled: false,
  requires: (ctx) =>
    ctx.qaHighlights.some((q) => q.period === ctx.period),
  userPromptFragment: (ctx) => {
    const list = ctx.qaHighlights
      .filter((q) => q.period === ctx.period)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    if (list.length === 0) return "";
    const blocks = list.map(
      (q) =>
        `Q: ${q.question}\nA: ${q.answer}${q.askedBy ? ` _— ${q.askedBy}_` : ""}`
    );
    return `\n## Q&A this period\n${blocks.join("\n\n")}`;
  },
  systemPromptFragment: `### Q&A Highlights (CONDITIONAL)
- Only render when the input contains a "## Q&A this period" block.
- Format: "Q: ..." / "A: ..." pairs. Two-three pairs max — pick the most substantive.
- Don't paraphrase the founder's answers heavily; preserve their voice.
- Attribute the asker only when provided (\`_— @username_\` style is fine).`,
  notReadyHint: "Click Edit data to add Q&A from this period's call.",
};

// ─── library + helpers ────────────────────────────────────────────────────

/**
 * The canonical ordered list. Constructor renders this in this order;
 * stored configs override only the enabled flag and (optionally) the
 * order when user reorders.
 */
export const SECTION_LIBRARY: readonly ReportSection[] = [
  executiveSummary,
  wins,
  lowsConcerns,
  treasuryOverview,
  treasuryByChain,
  treasuryConcentration,
  previousMonthComparison,
  financialHealth,
  expenseBreakdown,
  protocolRevenue,
  treasuryOperations,
  majorTransactions,
  grantsDistributed,
  tokenMetrics,
  governanceUpdates,
  developmentProgress,
  milestonesCompleted,
  partnersIntegrations,
  anomalies,
  lookingAhead,
  asks,
  qaHighlights,
];

const SECTION_BY_ID: Record<string, ReportSection> = Object.fromEntries(
  SECTION_LIBRARY.map((s) => [s.id, s])
);

/** Library position by id — the canonical order a stored config deviates from. */
const SECTION_LIBRARY_INDEX: ReadonlyMap<string, number> = new Map(
  SECTION_LIBRARY.map((s, i) => [s.id, i])
);

/**
 * Plain-data view of the library. Safe to ship to the client (no closures,
 * no server-only deps). The constructor UI iterates this; the resolver +
 * prompt builders stay server-side and consume the full `SECTION_LIBRARY`.
 */
export interface ReportSectionMeta {
  id: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
  /** Static fallback hint surfaced when readiness data isn't loaded yet. */
  notReadyHint?: string;
}

export const SECTION_LIBRARY_META: readonly ReportSectionMeta[] =
  SECTION_LIBRARY.map(({ id, title, description, defaultEnabled, notReadyHint }) => ({
    id,
    title,
    description,
    defaultEnabled,
    notReadyHint,
  }));

/** Per-section readiness verdict for the constructor UI. */
export interface SectionReadiness {
  id: string;
  ready: boolean;
  /** Human reason — present when `ready` is false. */
  reason?: string;
}

/**
 * Run every section's `requires(ctx)` against the current data and
 * pair the verdict with a human-readable reason. Powers the editor's
 * status chips ("Ready", "Needs ≥2 chains", "Coming soon"). The
 * editor itself can't run requires() — those closures live in the
 * server module — so the readiness map flows through tRPC.
 */
export function evaluateReadiness(
  ctx: ReportSectionContext
): SectionReadiness[] {
  return SECTION_LIBRARY.map((s) => {
    const ready = s.requires(ctx);
    return {
      id: s.id,
      ready,
      reason: ready ? undefined : s.notReadyHint ?? "Not yet ready",
    };
  });
}

export function getSectionById(id: string): ReportSection | undefined {
  return SECTION_BY_ID[id];
}

/** Stored config shape — what `projects.reportSections` JSONB holds. */
export interface SectionConfigEntry {
  id: string;
  enabled: boolean;
}

/**
 * Where a library section that the stored config never mentioned belongs in
 * an already-resolved list. Walks backwards from the section's library
 * position to the nearest neighbour that is actually present and returns the
 * slot just after it; the front of the list when nothing precedes it.
 *
 * Anchoring on a neighbour — rather than sorting the result by library index —
 * is what leaves a deliberate reorder alone. The founder's own sequence is
 * never rewritten; the new section just slots in beside the section it
 * follows in the library.
 */
function insertionPointFor(
  section: ReportSection,
  result: ReportSection[]
): number {
  const libIdx = SECTION_LIBRARY_INDEX.get(section.id) ?? 0;
  for (let i = libIdx - 1; i >= 0; i--) {
    const at = result.findIndex((r) => r.id === SECTION_LIBRARY[i].id);
    if (at !== -1) return at + 1;
  }
  return 0;
}

/**
 * Resolve the effective section list for a project. When the stored
 * config is null (legacy projects + freshly created), use the library
 * defaults. When stored, walk the stored array in its order, drop
 * disabled entries, ignore unknown ids (forward/backward-compat).
 *
 * Sections in the library that aren't in the stored config are spliced
 * back in at the position the library implies, honoring their default
 * enabled flag — so adding a new section to the library doesn't silently
 * disappear from existing reports, and doesn't land at the bottom of them
 * either. Order is load-bearing: `buildSystemPrompt` joins fragments in
 * sequence and instructs the model to emit sections "in the order shown",
 * so a section that belongs right under the Executive Summary must not
 * surface below Q&A Highlights for every founder who has ever hit Save.
 */
export function resolveSections(
  stored: SectionConfigEntry[] | null
): ReportSection[] {
  if (!stored || stored.length === 0) {
    return SECTION_LIBRARY.filter((s) => s.defaultEnabled);
  }
  const seenIds = new Set<string>();
  const result: ReportSection[] = [];
  for (const entry of stored) {
    if (!entry.enabled) {
      seenIds.add(entry.id);
      continue;
    }
    const section = SECTION_BY_ID[entry.id];
    if (!section) continue; // ignore unknown ids (e.g. removed in a deploy)
    seenIds.add(entry.id);
    result.push(section);
  }
  // Splice in library sections the stored config doesn't mention, honoring
  // their defaultEnabled. Walking the library in order matters: each section
  // inserted here becomes an anchor for the next one, so a run of consecutive
  // new sections keeps its relative order instead of stacking up backwards.
  for (const s of SECTION_LIBRARY) {
    if (seenIds.has(s.id) || !s.defaultEnabled) continue;
    result.splice(insertionPointFor(s, result), 0, s);
  }
  return result;
}

export function buildSystemPrompt(enabled: ReportSection[]): string {
  const sectionRules = enabled
    .map((s) => s.systemPromptFragment)
    .filter(Boolean)
    .join("\n\n");
  return `You are Vault Brief AI, a financial analyst for Web3 projects.

Generate a monthly investor report in Markdown format from the provided treasury data.

## Report Structure (only render the sections below, in the order shown):

${sectionRules}

## Rules:
- Use ONLY the provided data. Never invent numbers.
- **Silence beats placeholders.** If a data point is missing, OMIT the bullet/row/sub-section entirely. Never write "Not available", "N/A", "—", "(no data)", "TBD", or any equivalent filler in the final report. Investors should not see traces of missing data — they should see a tighter report instead.
- The only exception: top-level numbered KPIs (treasury total, monthly burn) where dropping the number would leave the section blank. In that one case, write "Not yet available — first sync" with a brief explanation.
- Keep the tone professional but accessible. Write for a VC partner, not an accountant.
- **Never include cents.** No ".00", no ".50". Round and abbreviate:
  - Amounts >= $1,000,000 → "$1.2M" (one decimal)
  - Amounts >= $1,000 → "$48K" (no decimals, K-suffix)
  - Amounts < $1,000 → "$420" (whole dollars)
  Inputs in this prompt are already pre-formatted — copy that style verbatim.
- Compare to previous month whenever data is available.
- Do not use excessive formatting. Clean, readable paragraphs.
- Total length: 600-1200 words.`;
}

export function buildUserPrompt(
  ctx: ReportSectionContext,
  enabled: ReportSection[]
): string {
  // Project context comes first regardless of section order — the model
  // needs to know who it's writing about before reading any data.
  const ctxLines: string[] = [`- Project: ${ctx.project.name}`];
  // teamSize intentionally NOT emitted. The "Development Activity" block
  // already gives the model `Active contributors: N` — a live signal that
  // a) reflects who's actually shipping, and b) updates each cycle. The
  // legacy `projects.team_size` column may hold stale headcount left over
  // from before we removed the form field; surfacing it would let that
  // stale number leak into LLM reports. Manual override path: write to
  // the column directly via `projects.update`, then re-add a line here.
  if (ctx.project.foundedDate) ctxLines.push(`- Founded: ${ctx.project.foundedDate}`);
  if (ctx.project.lastFundingRound) {
    ctxLines.push(`- Last funding round: ${ctx.project.lastFundingRound}`);
  }
  if (ctx.project.lastFundingAmount) {
    ctxLines.push(
      `- Amount raised: ${formatUsd(Number(ctx.project.lastFundingAmount))}`
    );
  }
  ctxLines.push(`- Report period: ${formatDate(ctx.snapshot.snapshotDate)}`);

  const dataBlocks = enabled
    .filter((s) => s.requires(ctx))
    .map((s) => s.userPromptFragment(ctx))
    .filter((s) => s && s.trim().length > 0);

  return `\n## Project Context\n${ctxLines.join("\n")}${dataBlocks.join("")}

Generate the investor report now.`;
}
