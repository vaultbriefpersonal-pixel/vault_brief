import { formatUsd, formatDate } from "@/lib/utils";
import {
  dominantDriver,
  reconcileWithNetFlow,
  type AttributionDriver,
  type TokenAttribution,
} from "./treasury-attribution";
import {
  extractMajorTransactions,
  type MajorTransaction,
} from "./major-transactions";
import { liquidReservesUsd, type TreasuryLiquidity } from "./treasury-liquidity";
import { burnTrend, liquidRunwayMonths } from "./burn-metrics";
// `anomalies.ts` is a pure module — its only import is `import type` on the
// schema, erased at build — so pulling the formatter in as a value is safe
// for the client bundle this file ships to (ReportTemplateEditor is
// "use client"). Keep it that way: no db/env/node imports over there.
import { formatAnomaliesForPrompt } from "./anomalies";
// The derived-view layer. Every figure this file prints comes from these
// accessors rather than being recomputed here, so a `requires()` gate and the
// fragment it gates can never disagree about a number. `report-evidence.ts`
// reads the same accessors; see the dependency-graph note at the top of
// report-derived.ts for why they live in their own module.
import {
  attributionOf,
  budgetComparison,
  budgetsForPeriod,
  burnBasis,
  burnBasisLabel,
  compositionOf,
  liquidityOf,
  netFlowOf,
  signedUsd,
  splitIncome,
  CONCENTRATION_PCT_FLOOR,
  DUST_FLOOR_USD,
  RECURRING_INCOME_FLOOR_USD,
  STABLE_COVER_FLOOR_MONTHS,
  TRAILING_BURN_MONTHS,
  type BudgetLine,
  type BudgetSide,
  type ReportSectionContext,
} from "./report-derived";
import type { TreasuryComposition } from "./treasury-composition";
import { decisionLedger, evidenceOf, formatEvidenceItems } from "./report-evidence";

// `ReportSectionContext` moved to report-derived.ts, which both this module
// and report-evidence.ts import. Re-exported here so every existing import
// path — prompts.ts, the tRPC routers, the tests — keeps resolving unchanged.
// The derived-view helpers are NOT re-exported: they were private to this
// file before the split and stay private to the layer now, so there is one
// obvious place to import them from.
export type { ReportSectionContext } from "./report-derived";

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
 *
 * `symbolResolved` gets the same treatment for the same reason. Such a row was
 * matched across a change in how the token was *recorded* (older snapshots
 * store no contract address, newer ones do), so its identity rests on
 * chain+symbol alone. Whatever the numbers say, the sentence has to disclose
 * that — otherwise a re-keyed holding reads as a movement the treasury never
 * made.
 */
function tokenMovement(t: TokenAttribution): string {
  if (!t.priced) return "no usable price — change left unattributed";
  const attributed =
    Math.abs(t.flowUsd) + Math.abs(t.priceEffectUsd) + Math.abs(t.crossUsd);
  if (Math.abs(t.walletSetUsd) > attributed) {
    return "wallet coverage changed — not a treasury movement";
  }
  const rekeyed = t.symbolResolved
    ? "; matched across a change in stored token identity, on chain+symbol rather than contract — do not describe this row as a transfer"
    : "";
  const qtyMoved = t.qtyCurr !== t.qtyPrev;
  const priceMoved = t.priceCurr !== t.pricePrev;
  if (qtyMoved && priceMoved) return `quantity and price both moved${rekeyed}`;
  if (qtyMoved) return `quantity moved, price unchanged${rekeyed}`;
  if (priceMoved) return `price moved, quantity unchanged${rekeyed}`;
  return `neither quantity nor price moved${rekeyed}`;
}

// ─── liquidity lines ───────────────────────────────────────────────────────

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

/**
 * Headline figures the takeaways bullets can anchor to — the two numbers an
 * investor checks first, stated once so the model does not have to reassemble
 * them out of three other sections' blocks (and cannot get a different answer
 * when it does). Every figure routes through the same accessors the sections
 * themselves use.
 */
function headlineLines(ctx: ReportSectionContext): string[] {
  const lines: string[] = [];

  if (ctx.total > 0) {
    lines.push(
      `- Total treasury (${ctx.snapshot.snapshotDate}): ${formatUsd(ctx.total)}`
    );
  }

  if (ctx.prevSnapshot) {
    const attribution = attributionOf(ctx);
    const driver = dominantDriver(attribution);
    if (attribution.tokens.length > 0 && driver.driver !== "none") {
      lines.push(
        `- Treasury change vs ${ctx.prevSnapshot.snapshotDate}: ${signedUsd(
          attribution.deltaUsd
        )} — dominant driver: ${DRIVER_LABELS[driver.driver]} (${signedUsd(
          driver.usd
        )}, ${(driver.share * 100).toFixed(0)}% of all movement)`
      );
    }
  }

  const liq = liquidityOf(ctx);
  const basis = burnBasis(ctx);
  if (liq.derived && basis.avgUsd > 0) {
    const months = liquidRunwayMonths(liquidReservesUsd(liq), basis.avgUsd);
    if (months != null) {
      lines.push(
        `- Runway (liquid reserves ${formatUsd(
          liquidReservesUsd(liq)
        )} ÷ ${burnBasisLabel(basis)} ${formatUsd(
          basis.avgUsd
        )}): ${months.toFixed(1)} months`
      );
    }
  }

  return lines;
}

const keyTakeaways: ReportSection = {
  id: "key_takeaways",
  title: "Key Takeaways",
  description:
    "3-5 bullets an investor could read instead of the whole report. Each one anchored to a figure from the period's own data — never a summary of the summary.",
  defaultEnabled: true,
  // Always offered, like Wins and Lows: the fragment is what decides whether
  // there is anything to say, and an empty fragment is a silent skip.
  requires: () => true,
  userPromptFragment: (ctx) => {
    const headline = headlineLines(ctx);
    const { positives, negatives } = evidenceOf(ctx);
    if (headline.length === 0 && positives.length === 0 && negatives.length === 0) {
      return "";
    }

    const blocks: string[] = [];
    if (headline.length > 0) {
      blocks.push(`Headline figures:\n${headline.join("\n")}`);
    }
    if (positives.length > 0) {
      blocks.push(
        `Verified positives (complete — nothing else qualified):\n${formatEvidenceItems(
          positives
        )}`
      );
    }
    if (negatives.length > 0) {
      blocks.push(
        `Verified concerns (complete — nothing else qualified):\n${formatEvidenceItems(
          negatives
        )}`
      );
    }

    return `\n## Key takeaways evidence (${ctx.snapshot.snapshotDate})\n${blocks.join(
      "\n\n"
    )}`;
  },
  systemPromptFragment: `### Key Takeaways (CONDITIONAL)
- Only render when the input contains a "## Key takeaways evidence" block. Render it directly under the Executive Summary, as 3-5 bullets — no prose paragraph.
- **Every bullet must carry a figure copied from that block.** A takeaway without a number is an opinion; this section does not carry opinions. If the block supports only three bullets, write three.
- Draw from the headline figures and both evidence lists. Do NOT introduce an item that is not in the block, and do NOT restate a figure with a different value, a different denominator, or a different period than the block gives it.
- **This is not a summary of the sections below.** Do not write "as detailed below", do not preview section names, and do not repeat the Executive Summary's sentences in bullet form. Each bullet states a fact and its number, and stands alone.
- Give the concerns the same weight as the positives. A takeaways list that quietly drops every negative item from a block that contains them is a misrepresentation of the period, not an editorial choice.
- State what the numbers are, not a verdict on how the quarter "went". Operational commentary belongs in the Recommendations section, not here.`,
};

const wins: ReportSection = {
  id: "wins",
  title: "Wins this period",
  description:
    "2-3 bullets calling out positive developments — milestones hit, key partnerships, dev velocity. Treasury increases only count when actual inflows caused them.",
  defaultEnabled: true,
  requires: () => true,
  userPromptFragment: (ctx) => {
    const { positives } = evidenceOf(ctx);
    if (positives.length === 0) return "";
    return `\n## Verified positive evidence (${ctx.snapshot.snapshotDate})\nEvery item below was computed from this report's input and carries the figure behind it. This is the complete set of positives the data supports.\n${formatEvidenceItems(
      positives
    )}`;
  },
  systemPromptFragment: `### Wins
2-3 bullet points of positive developments this period.
- **When the input contains a "## Verified positive evidence" block, select ONLY from that list.** Each bullet must correspond to one listed item and quote its figure. Do NOT introduce a win that is not on the list, and do NOT combine two items into a claim neither one makes. The list is the complete set of positives the data supports; if it holds fewer items than you have bullets, write fewer bullets.
- If no such block appears in the input, pull from milestones completed, dev activity spikes, or partnerships that the input does state — and if it states none, write nothing rather than assembling a win out of figures that were not offered as one.
- Be specific: name the thing, the date, the counterparty, the number. "Shipped v2 mainnet on 12 April" beats "strong development progress."
- Specificity means precise facts, NOT invented explanations. State what happened. Attach a cause only when the input states that cause. Never pair a real number with a reason the input does not contain — a plausible-sounding cause you inferred is a fabrication, and it is indistinguishable from a real one to the investor reading it.
- Do NOT list a treasury increase as a win unless the input attributes that increase to net asset flows — money that actually arrived. An increase the input attributes to price movement of assets already held, to newly-tracked wallets, or to unattributed change is NOT a win: a token appreciating is a market event, not something the team achieved, and an investor who reads it as an achievement has been misled. A treasury rise absent from the evidence block failed that test and must not be reinstated from figures elsewhere in the input.
- A token price rise is never a win, in any section, under any wording.`,
};

const lowsConcerns: ReportSection = {
  id: "lows_concerns",
  title: "Lows / Concerns",
  description:
    "1-2 bullets honestly naming risks, missed targets, or unexplained metric movements.",
  defaultEnabled: true,
  requires: () => true,
  userPromptFragment: (ctx) => {
    const { negatives } = evidenceOf(ctx);
    if (negatives.length === 0) return "";
    return `\n## Verified concerns (${ctx.snapshot.snapshotDate})\nEvery item below was computed from this report's input and carries the figure behind it. This is the complete set of concerns the data supports.\n${formatEvidenceItems(
      negatives
    )}`;
  },
  systemPromptFragment: `### Lows / Concerns
1-2 bullet points naming real concerns: missed milestones (status='delayed'), runway shrinking, unexplained outflows, anomaly hits with negative direction. If there's nothing material to flag, write a single sentence acknowledging it ("No material concerns this period — burn and runway tracking to plan."). Don't manufacture a concern.
- **When the input contains a "## Verified concerns" block, select ONLY from that list**, quoting each item's figure. Do NOT introduce a concern that is not on the list. The list is the complete set the data supports, so fewer items means fewer bullets — and an absent block means the data supports none, which is the "nothing material to flag" case above, not an invitation to find one elsewhere.
- Items labelled a data-quality caveat (diverging estimates, unattributed change, a changed wallet set) are exactly that: statements about what could be measured, not about how the business performed. Report them as measurement limits and never as losses, outflows, or mismanagement.
- **No alarmism.** State the concern and its figure. Do not write "critical", "dangerous", "urgent", or a survival timeline. Operational commentary — what to do about a concern — belongs in the Recommendations section, not here.`,
};

// ─── treasury composition (buckets + per-asset rows) ───────────────────────

/**
 * How many holdings get named individually. Ten is the point past which a
 * composition table stops informing and starts burying: the reader has already
 * seen everything that moves the total, and row eleven onward is a long tail
 * that the rollup line summarises more honestly than eleven near-zero rows do.
 */
const MAX_NAMED_ASSET_ROWS = 10;

/**
 * The four buckets, as prompt bullets, gated on `DUST_FLOOR_USD`.
 *
 * NOT `ctx.minSignificant`: that floor is 0.1% of the treasury, which on a
 * $1.06B balance sheet is ~$1.06M, and it is what suppressed a $1,136
 * stablecoin bullet and a $440 ETH bullet from a shipped report. Those two
 * figures are the most important thing that report could have said about
 * liquidity. See the floor comments in report-derived.ts.
 *
 * Every figure comes from `compositionOf(ctx)` — the shared read-time
 * classifier — never from the frozen `stablecoins_usd` / `eth_usd` /
 * `native_token_usd` / `other_assets_usd` snapshot columns. Those are a
 * write-only cache computed against whatever the project had entered at sync
 * time, and on this fixture they read "Other 100.0%".
 */
function compositionBucketLines(
  c: TreasuryComposition,
  ctx: ReportSectionContext
): string[] {
  const lines: string[] = [];

  if (c.liquidStableUsd > DUST_FLOOR_USD) {
    lines.push(`- Stablecoins: ${formatUsd(c.liquidStableUsd)}`);
  }
  if (c.liquidCryptoUsd > DUST_FLOOR_USD) {
    const slices: string[] = [];
    if (c.ethUsd > DUST_FLOOR_USD) slices.push(`ETH and WETH ${formatUsd(c.ethUsd)}`);
    if (c.btcUsd > DUST_FLOOR_USD) {
      slices.push(`BTC and wrapped BTC ${formatUsd(c.btcUsd)}`);
    }
    const detail = slices.length > 0 ? ` (of which ${slices.join("; ")})` : "";
    lines.push(
      `- Liquid crypto — ETH, BTC, chain gas assets and liquid-staking tokens: ${formatUsd(
        c.liquidCryptoUsd
      )}${detail}`
    );
  }
  if (c.concentratedUsd > DUST_FLOOR_USD) {
    const tokenName = ctx.project.tokenSymbol
      ? `${ctx.project.tokenSymbol}, the project's own token`
      : "The project's own token";
    lines.push(
      `- ${tokenName}: ${formatUsd(c.concentratedUsd)} (${c.concentrationPct.toFixed(
        1
      )}% of the treasury)`
    );
  }
  if (c.otherUsd > DUST_FLOOR_USD) {
    lines.push(
      `- Other assets, unrecognised and treated as illiquid: ${formatUsd(c.otherUsd)}`
    );
  }

  return lines;
}

/**
 * The per-asset table: the largest holdings named individually, then one line
 * for everything else, then one line for what could not be priced.
 *
 * This did not exist anywhere in the product before. Every section emitted
 * aggregate buckets only, while `balances_detail` sat on 53 individual
 * holdings — so a reader could see "Other assets $1.06B / 100%" and had no way
 * to learn that the $1.06B was one position in a single token.
 *
 * Three rules the arithmetic has to obey, and each one is a way the table
 * could lie:
 *   • Named rows plus the rollup line always equal the per-token total. A row
 *     dropped for being small must still be counted somewhere.
 *   • Dust is aggregated, never named. A $0.00 spam airdrop must not be able
 *     to buy itself a line in an investor report by existing.
 *   • Unpriced holdings are named separately and counted in NO total. Folding
 *     them in at $0 understates the treasury while looking complete.
 */
function assetRowLines(c: TreasuryComposition): string[] {
  if (c.assets.length === 0) return [];

  const named = c.assets
    .filter((a) => a.valueUsd >= DUST_FLOOR_USD)
    .slice(0, MAX_NAMED_ASSET_ROWS);
  const lines = named.map(
    (a) =>
      `- ${a.symbol} on ${a.chain || "unknown chain"}: ${formatUsd(
        a.valueUsd
      )} (${a.sharePct.toFixed(1)}% of the per-token total)`
  );

  const namedUsd = named.reduce((sum, a) => sum + a.valueUsd, 0);
  const remainderCount = c.assets.length - named.length;
  if (remainderCount > 0) {
    // Derived by subtraction, so this line and the named rows are guaranteed
    // to add up to `totalUsd` no matter how the split above is tuned.
    const remainderUsd = c.totalUsd - namedUsd;
    lines.push(
      `- ${remainderCount} smaller holding${
        remainderCount === 1 ? "" : "s"
      } not listed individually, totalling ${formatUsd(remainderUsd)}`
    );
  }

  if (c.unpriced.count > 0) {
    lines.push(
      `- ${c.unpriced.count} holding${
        c.unpriced.count === 1 ? "" : "s"
      } with no price feed — excluded from every total above`
    );
  }

  return lines;
}

/**
 * Shared by `requires()` and `userPromptFragment()` so the readiness gate and
 * the content it gates can never disagree — the discipline
 * `concentrationOrThinCoverTriggered` below established after the two halves of
 * that section drifted apart.
 *
 * Either source of truth is enough to render: `ctx.total` alone still supports
 * the total-balance line on a legacy snapshot that carries no per-token detail,
 * and per-token detail alone still supports the whole table on a snapshot whose
 * stored total is missing.
 */
function treasuryOverviewHasContent(ctx: ReportSectionContext): boolean {
  return ctx.total > 0 || compositionOf(ctx).totalUsd > 0;
}

const treasuryOverview: ReportSection = {
  id: "treasury_overview",
  title: "Treasury Overview",
  description:
    "Asset breakdown: stablecoins, liquid crypto, the project's own token and unrecognised holdings — plus the largest individual positions.",
  defaultEnabled: true,
  requires: (ctx) => treasuryOverviewHasContent(ctx),
  userPromptFragment: (ctx) => {
    if (!treasuryOverviewHasContent(ctx)) return "";
    const c = compositionOf(ctx);

    const lines: string[] = [];
    if (ctx.total > 0) lines.push(`- Total balance: ${formatUsd(ctx.total)}`);
    if (c.derived) {
      // Stated separately from the headline total because the two legitimately
      // differ: unpriced holdings count toward neither, and only this one is
      // the denominator the rows below share.
      lines.push(`- Total across priced holdings: ${formatUsd(c.totalUsd)}`);
      lines.push(...compositionBucketLines(c, ctx));
    }

    const rows = assetRowLines(c);
    const blocks = [lines.join("\n")];
    if (rows.length > 0) {
      blocks.push(
        `Individual holdings, largest first (derived from per-token balances stored with this snapshot):\n${rows.join(
          "\n"
        )}`
      );
    }

    return `\n## Current Treasury (${ctx.snapshot.snapshotDate})\n${blocks.join(
      "\n\n"
    )}`;
  },
  systemPromptFragment: `### Treasury Overview
- Table: Asset | Balance | % of Total. Render the bucket lines the input gives you (stablecoins, liquid crypto, the project's own token, other assets), then a second table of the individual holdings when the input lists them.
- **Only include rows where Balance > $0.** Skip categories the project does not currently hold — do NOT emit "$0 / 0%" placeholder rows. If the input doesn't list a balance for an asset, that asset doesn't exist in this treasury; pretend it's not even on the menu.
- **Every figure here is derived at read time from the per-token holdings stored with the snapshot.** It is an approximation at the margins, not an audited balance sheet. Never call it audited, verified or exact.
- **A holding rolled into the "smaller holdings not listed individually" line must never be named.** Do not guess what is in it, do not itemise it, do not describe it. It is a long tail of small and often worthless positions, and naming any of them gives a spam airdrop the same standing as a real position.
- **Holdings with no price feed are reported as a count and nothing else.** They are excluded from every total in the input, so never add them to one, never estimate their value, and never imply the treasury is larger because of them. State the count and that they are unpriced.
- Report a small figure as the small figure it is. If the input says stablecoins are $1,136 against a treasury of $1.06B, say exactly that — a treasury holding almost no stablecoins is a material fact about its liquidity, not a rounding error to omit.
- Total treasury value.
- Change vs previous month (absolute and percentage) — only if a Previous Month section appears in the input.`,
  notReadyHint: "Run a sync to fetch wallet balances first.",
};

const treasuryByChain: ReportSection = {
  id: "treasury_by_chain",
  title: "Treasury by Chain",
  description:
    "How balances split across Ethereum, L2s, Solana, etc. Auto-skips for single-chain projects.",
  defaultEnabled: true,
  // `DUST_FLOOR_USD`, not `ctx.minSignificant`: this asks "does the project
  // hold anything on this chain?", which is a composition question. At 0.1% of
  // a $1.06B treasury the proportional floor is ~$1.06M, so a chain holding a
  // real six-figure position would be silently dropped from the split — and if
  // that dropped it below two chains, the whole section would vanish with it.
  requires: (ctx) => {
    const byChain =
      (ctx.snapshot.balancesByChain as Record<string, number> | null) ?? null;
    if (!byChain) return false;
    return (
      Object.values(byChain).filter((v) => Number(v) > DUST_FLOOR_USD).length >= 2
    );
  },
  userPromptFragment: (ctx) => {
    const byChain =
      (ctx.snapshot.balancesByChain as Record<string, number> | null) ?? null;
    if (!byChain) return "";
    const entries = Object.entries(byChain).filter(
      ([, v]) => Number(v) > DUST_FLOOR_USD
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

// Two independent triggers, because they describe two different problems: a
// treasury that is mostly a bet on its own token, and a treasury without
// enough price-stable cash to pay next quarter's bills. Either alone is
// worth a paragraph.
//
// The `derived` gate comes first and is not optional. Without per-token
// detail every bucket is zero, which reads as "zero months of stablecoin
// cover" and would fire this section on every legacy snapshot in the
// database — asserting a liquidity finding from an absence of data.
//
// Shared by `requires()` and `userPromptFragment()` below so the readiness
// gate and the content it gates can never drift apart again — this predicate
// used to be duplicated (loosely) between the two, and the copy in
// `userPromptFragment` had rotted to just the `derived`/`totalUsd` half,
// which meant the section fired for every treasury with parseable balances
// regardless of whether either trigger condition actually held.
function concentrationOrThinCoverTriggered(ctx: ReportSectionContext): boolean {
  const liq = liquidityOf(ctx);
  if (!liq.derived || liq.totalUsd <= 0) return false;
  if (liq.concentrationPct > CONCENTRATION_PCT_FLOOR) return true;
  const basis = burnBasis(ctx);
  if (basis.avgUsd <= 0) return false;
  return liq.liquidStableUsd / basis.avgUsd < STABLE_COVER_FLOOR_MONTHS;
}

const treasuryConcentration: ReportSection = {
  id: "treasury_concentration",
  title: "Treasury Concentration",
  description:
    "Fires when the treasury leans on the project's own token, or when stablecoins cover under three months of burn. States the split and why own-token holdings don't behave like reserves.",
  defaultEnabled: true,
  requires: (ctx) => concentrationOrThinCoverTriggered(ctx),
  userPromptFragment: (ctx) => {
    if (!concentrationOrThinCoverTriggered(ctx)) return "";
    const liq = liquidityOf(ctx);
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
- **No alarmism.** Do not write "critical", "dangerous", "at risk", "urgent", or a survival timeline. State the position and the mechanism — operational commentary such as diversifying, hedging, or extending runway belongs in the Recommendations section, not here. **Never**, in any section including Recommendations, advise the reader to buy, sell, or hold the token itself — that ban is absolute and untouched by this relaxation.
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

    const attribution = attributionOf(ctx);
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
    const netFlowUsd = netFlowOf(ctx);
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

// ─── plan vs actual ────────────────────────────────────────────────────────

/** One budget row as a prompt bullet, with its own materiality verdict. */
function budgetLineBullet(line: BudgetLine, kind: "expense" | "income"): string {
  const pct =
    line.variancePct === null
      ? "percentage not meaningful — nothing was planned for this line"
      : `${line.variancePct >= 0 ? "+" : ""}${line.variancePct.toFixed(1)}%`;
  // Direction is stated as plain fact and never as good or bad news. Which of
  // the four combinations (expense over/under, income above/below) is welcome
  // depends on why, and the input carries no whys.
  const direction =
    line.varianceUsd === 0
      ? "exactly on plan"
      : kind === "expense"
        ? line.varianceUsd > 0
          ? "spent more than planned"
          : "spent less than planned"
        : line.varianceUsd > 0
          ? "earned more than planned"
          : "earned less than planned";
  const verdict = line.material
    ? "MATERIAL — clears both the 20% and the $5K floor"
    : "within tolerance — do NOT call this out";
  const planned = line.unplanned
    ? "not in the plan"
    : formatUsd(line.plannedUsd);
  const notes = line.notes ? ` — founder's note: ${line.notes}` : "";
  return `- ${line.label}: planned ${planned}, actual ${formatUsd(
    line.actualUsd
  )}, variance ${signedUsd(line.varianceUsd)} (${pct}) — ${direction} — ${verdict}${notes}`;
}

function budgetSideBlock(side: BudgetSide): string[] {
  const heading =
    side.kind === "expense"
      ? "Operating expenses — plan vs actual"
      : "Income — plan vs actual";
  const lines: string[] = [];
  if (side.totalOnly) {
    lines.push(
      `${heading} (the founder planned ONE total for the period, not a per-category plan — there is no category detail to report):`,
      budgetLineBullet(side.total, side.kind)
    );
  } else {
    lines.push(
      `${heading} by category:`,
      ...side.lines.map((l) => budgetLineBullet(l, side.kind)),
      "",
      budgetLineBullet(side.total, side.kind)
    );
  }
  if (side.kind === "expense") {
    lines.push(
      "The actual above is operating spend only. Treasury reallocation (the token_sale bucket) is excluded, exactly as it is in Operating Expenses, unless the founder budgeted for it by name."
    );
  }
  return lines;
}

const actualVsBudget: ReportSection = {
  id: "actual_vs_budget",
  title: "Plan vs Actual",
  description:
    "The founder's own budget for the period next to what the treasury actually did — per category, with variances.",
  // The one section in the library that is OFF by default, and deliberately:
  // it renders nothing at all until a founder types a plan in. A section that
  // ships enabled and then silently never appears teaches the founder that
  // the toggle means nothing; one they opt into does what they asked.
  defaultEnabled: false,
  requires: (ctx) => budgetsForPeriod(ctx).length > 0,
  userPromptFragment: (ctx) => {
    const cmp = budgetComparison(ctx);
    const blocks: string[] = [];
    if (cmp.expense) blocks.push(...budgetSideBlock(cmp.expense));
    if (cmp.income) {
      if (blocks.length > 0) blocks.push("");
      blocks.push(...budgetSideBlock(cmp.income));
    }
    if (blocks.length === 0) return "";

    const revised = cmp.planUpdatedAt
      ? `\nThe plan was last revised ${formatDate(cmp.planUpdatedAt)}.`
      : "";
    return `\n## Plan vs actual (${ctx.period})\nPlanned figures are the founder's own budget for this period, entered by hand. Actual figures are measured from synced on-chain activity. Every line below carries its own MATERIAL / within-tolerance verdict — that verdict is the input's, not yours to re-derive.${revised}\n\n${blocks.join(
      "\n"
    )}`;
  },
  systemPromptFragment: `### Plan vs Actual (CONDITIONAL)
- Only render when the input includes a "## Plan vs actual" block.
- Render as a table with one row per line the input gives you — Category, Planned, Actual, Variance $, Variance % — followed by the total row. When the input says the founder planned one total rather than a per-category plan, render the single total row and say plainly that the plan was not itemised. Do NOT invent category rows to fill the table out.
- **Report the variance; do not editorialise it.** State what was planned, what happened, and the gap. No "impressively disciplined", no "concerning blowout", no grades.
- **Call out ONLY the lines the input marks MATERIAL.** Lines marked "within tolerance" belong in the table and nowhere else — no sentence, no mention. A 200% overrun on a $50 line is noise, and naming it costs the reader the attention the real variance needed.
- **Under-spend is not automatically good news, and must never be framed as a win, a saving, efficiency, or discipline.** Spending less than planned frequently means a hire that did not happen, an audit that stalled, a program that never launched — outcomes that show up as *lower* spend and *worse* execution. Report it as a gap between plan and actual, in the same neutral register you use for an overspend. If the input does not say why the money went unspent, say nothing about why.
- Do not attribute any variance to a cause. The input carries planned figures, actual figures and the founder's own notes — nothing else. A cause that does not appear verbatim in this input is fabrication, including plausible ones.
- Where a line is marked "not in the plan", say the spend fell outside the budget rather than quoting a percentage — a percentage against a zero base is not a number.
- Do not project the variance forward. Operational commentary — what to do about a variance — belongs in the Recommendations section, not here.`,
  notReadyHint:
    "Click Edit data to enter a budget for this period — one total, or a figure per category.",
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
  // before the model writes a word.
  //
  // The floor is `RECURRING_INCOME_FLOOR_USD` ($5K absolute), NOT
  // `ctx.minSignificant`. Revenue is measured against burn, not against the
  // balance sheet: at 0.1% of a $1.06B treasury the proportional floor is
  // ~$1.06M, so a protocol earning a real $500K/month would have its revenue
  // section suppressed for being small relative to assets it is not spending.
  requires: (ctx) =>
    splitIncome(ctx.snapshot.incomeByCategory).recurring.totalUsd >
    RECURRING_INCOME_FLOOR_USD,
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
  // The transfer count is a column rather than prose because the model
  // otherwise has no way to know that one row covers eight transfers, and
  // "eight transactions" is exactly the sentence this section must not
  // produce. The asterisk marks a value that is a floor.
  const transfers = `${tx.legCount} transfer${tx.legCount === 1 ? "" : "s"}${
    tx.partial ? "*" : ""
  }`;
  return [
    tx.date || "unknown",
    direction,
    formatUsd(tx.valueUsd),
    tx.token,
    tx.category || "unclassified",
    tx.counterparty || "unidentified address",
    transfers,
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
      )} (the larger of $25,000 and 0.5% of treasury), largest first. One row is one TRANSACTION, not one transfer: a single transaction that paid eight recipients is one row whose Transfers column reads 8, and the threshold was applied to the transaction's total after its transfers were summed. Transfers between the project's own wallets are excluded — they move nothing. Transfers whose USD value could not be priced are excluded from the totals — their value is not known.`,
      "",
      "Date | Direction | Amount | Asset | Category | Counterparty | Transfers",
      ...result.rows.map((tx) => `- ${majorTxRow(tx)}`),
    ];

    // A row whose value omits an unpriceable transfer is a floor, and the
    // report has to say so — the alternative is a number that reads exact and
    // is not.
    if (result.rows.some((tx) => tx.partial)) {
      lines.push(
        "",
        "* This transaction included at least one transfer with no resolvable price, which is excluded from the amount shown. That amount is a FLOOR — the transaction moved at least this much, possibly more."
      );
    }

    if (result.qualifyingCount > result.rows.length) {
      lines.push(
        "",
        `Showing the ${result.rows.length} largest of ${result.qualifyingCount} transactions that cleared the threshold.`
      );
    }

    // The stored-vs-rendered gap, stated rather than left dangling. Without
    // this, a snapshot holding ten legs that renders one row looks like nine
    // transactions went missing.
    const excludedClauses = [
      result.excluded.internal > 0
        ? `${result.excluded.internal.toLocaleString()} internal (between the project's own wallets)`
        : "",
      result.excluded.priceUnknown > 0
        ? `${result.excluded.priceUnknown.toLocaleString()} with no resolvable price`
        : "",
    ].filter(Boolean);
    if (excludedClauses.length > 0 || result.excluded.belowThreshold > 0) {
      const parts = [
        `ACCOUNTING: the snapshot stored ${result.sampleSize.toLocaleString()} transfer${
          result.sampleSize === 1 ? "" : "s"
        } for this period.`,
      ];
      if (excludedClauses.length > 0) {
        parts.push(`Excluded before grouping: ${excludedClauses.join(", ")}.`);
      }
      const grouped = result.qualifyingCount + result.excluded.belowThreshold;
      const below =
        result.excluded.belowThreshold > 0
          ? `, of which ${result.excluded.belowThreshold.toLocaleString()} fell below the threshold`
          : "";
      parts.push(
        `The rest group into ${grouped.toLocaleString()} transaction${
          grouped === 1 ? "" : "s"
        }${below}.`
      );
      parts.push(
        "The table above is therefore shorter than the transfer count by construction — that is grouping and filtering, not missing data."
      );
      lines.push("", parts.join(" "));
    }

    // The truncation disclosure. The sync stores a SAMPLE of the period's
    // transfers (the largest by value plus the most recent), so once that
    // store was genuinely capped a bigger transfer may sit outside it
    // entirely. Nothing downstream can detect that, and re-sampling only helps
    // snapshots not yet taken — so the report says it out loud instead of
    // quietly presenting a partial ranking as a complete one.
    if (result.capped) {
      const of =
        result.totalCount === null
          ? ""
          : ` out of ${result.totalCount.toLocaleString()} recorded for the period`;
      // Legacy snapshots carry no `sampleBasis`, and the rule in force when
      // they were written cannot be recovered from the row. Saying so is the
      // only honest option — naming a rule we are guessing at is how the old
      // note came to claim "the N most recent" long after the sampler had
      // stopped working that way.
      const basis = result.sampleBasis
        ? ` (selection basis: ${result.sampleBasis})`
        : " (this snapshot did not record how the sample was selected)";
      lines.push(
        "",
        `SAMPLING NOTE: this snapshot stored a SAMPLE of the period's transfers${basis} — ${result.sampleSize.toLocaleString()} of them${of} — because the period held more than the sample could carry. The rows above are the largest within that sample, NOT necessarily the largest of the period: a larger transaction may have fallen outside what was stored. This caveat MUST appear in the section.`
      );
    }

    return `\n## Major transactions (${ctx.snapshot.snapshotDate})\n${lines.join("\n")}`;
  },
  systemPromptFragment: `### Major Transactions (CONDITIONAL)
- Only render when the input contains a "## Major transactions" block.
- Render a table with the columns Date | Direction | Amount | Asset | Category | Counterparty | Transfers, one row per listed transaction, values copied from the input. A row whose Date reads "unknown" has no usable timestamp in the stored data — leave that cell blank rather than guessing or inferring a date.
- **One row is one transaction.** A row whose Transfers column reads 8 is ONE transaction comprising eight transfers — say it that way, or say nothing about the count. Writing "8 transactions", counting it eight times in any total, or listing the transfers as separate rows all misstate what happened. An asset shown as "multiple assets" or a counterparty shown as "N counterparties" is a transaction with several transfers, not several transactions.
- **An amount marked with an asterisk is a floor, and must be described as one** — "at least $X". One of its transfers had no resolvable price and is excluded from the figure. Never present that number as the transaction's exact value.
- **Never invent a purpose for a transfer.** The input records what moved, when, and to or from whom. It does not record why. Commentary is allowed only where the category and counterparty in the row already carry it: "a $1.2M USDC transfer to Binance, classified as a token sale" is supportable because every element of it is in the input. "Sold treasury assets to fund operations", "paid down vendor obligations", "deployed capital into the ecosystem", "took profit" are NOT supportable — each asserts an intent the data cannot show.
- A counterparty shown as a truncated address ("0x1234…abcd") is an address and nothing else. Do not name an entity, a relationship, or a category of business for it. A row marked "unclassified" or "unidentified address" gets stated plainly, with no inference attached.
- At most two sentences of commentary in total, and only if a row genuinely supports it. A bare table with no commentary is a correct, complete answer here.
- **If the input carries a SAMPLING NOTE, the rendered section MUST carry that caveat** — one short sentence stating the list is drawn from a stored sample of the period's transfers and may not include the period's largest transaction. Do not present the table as the definitive list of the largest transactions. Dropping this caveat misrepresents what the numbers are; it is not a stylistic trim. When there is no SAMPLING NOTE, do NOT invent one: nothing was truncated, and inventing doubt is as wrong as hiding it.
- An ACCOUNTING line in the input explains why the table is shorter than the stored transfer count. Use it if you say anything about coverage, and never describe those exclusions as missing or failed data.
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
  requires: (ctx) => ctx.anomalies.length > 0,
  userPromptFragment: (ctx) => formatAnomaliesForPrompt(ctx.anomalies),
  systemPromptFragment: `### Anomalies (CONDITIONAL)
- If the input contains an "Anomalies" section listing metric deltas vs trailing average, mention each one in the Executive Summary with one short sentence per anomaly.
- Don't fabricate causes — if no contextual reason is available, write "warrants investigation" or "see breakdown below". Never invent reasons.
- Critical-severity anomalies (>100% change) deserve a sentence in their own; minor anomalies can be combined ("payroll up 35%, marketing down 40%").
- If no Anomalies section is provided in input, do NOT add this commentary.`,
  notReadyHint:
    "Runs at report time against the trailing snapshots — not computed for this preview.",
};

/**
 * Trailing average of the transaction-derived net flow, over the same window
 * as the burn average so the two halves of the projection describe the same
 * stretch of history.
 *
 * Contrast with `trailingAverageBurn`, which drops zero months: a burn of zero
 * is missing data (see burn-metrics.ts), but a NET FLOW of exactly zero is a
 * real measurement — money moved both ways and cancelled, or nothing moved at
 * all. So zeros are kept here and only nulls are dropped. Getting this
 * backwards would bias the projection toward whichever direction the non-zero
 * months happened to point.
 */
function trailingNetFlow(ctx: ReportSectionContext): {
  avgUsd: number;
  monthsUsed: number;
} {
  const window = ctx.trailing.slice(0, TRAILING_BURN_MONTHS);
  const values = window
    .map((s) => (s?.netFlowUsd == null ? null : Number(s.netFlowUsd)))
    .filter((n): n is number => n !== null && Number.isFinite(n));
  if (values.length === 0) return { avgUsd: 0, monthsUsed: 0 };
  return {
    avgUsd: values.reduce((a, b) => a + b, 0) / values.length,
    monthsUsed: values.length,
  };
}

const nextPeriodForecast: ReportSection = {
  id: "next_period_forecast",
  title: "Next Period Projection",
  description:
    "A mechanical roll-forward of the trailing average net flow and burn, one period out. Arithmetic, not a prediction — it assumes prices hold and spending continues unchanged.",
  defaultEnabled: true,
  // Two prior periods is the floor at which "trailing average" means anything
  // at all. One period is not an average, and projecting it forward would
  // dress a single month up as a trend.
  requires: (ctx) => ctx.trailing.length >= 2,
  userPromptFragment: (ctx) => {
    const liq = liquidityOf(ctx);
    const basis = burnBasis(ctx);
    const flow = trailingNetFlow(ctx);

    // Nothing to roll forward without a liquid base AND a trailing burn to
    // divide by. Silent skip rather than a header with a caveat under it.
    if (!liq.derived || basis.source !== "trailing" || basis.avgUsd <= 0) {
      return "";
    }
    if (flow.monthsUsed === 0) return "";

    const reserves = liquidReservesUsd(liq);
    const projectedReserves = reserves + flow.avgUsd;
    const monthsNow = liquidRunwayMonths(reserves, basis.avgUsd);
    // Reserves can project negative when the trailing net flow is steeply
    // negative. Clamped at zero for the runway line only, because a negative
    // runway is not a shorter runway — it is the projection running past the
    // point where its own assumptions stop holding.
    const monthsThen = liquidRunwayMonths(
      Math.max(projectedReserves, 0),
      basis.avgUsd
    );

    const lines: string[] = [
      `- Trailing average net flow (inflows minus outflows): ${signedUsd(
        flow.avgUsd
      )} per period, averaged over the ${flow.monthsUsed} prior period${
        flow.monthsUsed === 1 ? "" : "s"
      } that recorded a net flow figure`,
      `- Burn basis — ${burnBasisLabel(basis)}: ${formatUsd(basis.avgUsd)}`,
      `- Spendable liquid reserves today (${ctx.snapshot.snapshotDate}): ${formatUsd(
        reserves
      )}`,
      `- MECHANICAL PROJECTION — spendable liquid reserves one period out, IF that same average net flow repeats: ${formatUsd(
        projectedReserves
      )}`,
    ];

    if (monthsNow != null && monthsThen != null) {
      lines.push(
        `- MECHANICAL PROJECTION — liquid runway at that point, at the same average burn: ${monthsThen.toFixed(
          1
        )} months (today: ${monthsNow.toFixed(1)} months)`
      );
    }

    if (projectedReserves < 0) {
      lines.push(
        `- The projected reserve figure is negative. That does not mean the project runs out — it means the trailing average cannot be extended this far without something changing. Say the projection breaks down; do not report a negative balance or a date of insolvency.`
      );
    }

    lines.push(
      "",
      "ASSUMPTIONS — every figure above holds only while ALL of these do, and each fails routinely:",
      "- Asset prices stay exactly where they were on the snapshot date. No price movement is modelled in either direction.",
      "- Spending continues at the trailing average, with no new hires, no annual invoices, no one-off costs.",
      "- Inflows repeat at the trailing average, with no funding round, no token sale, and no revenue change.",
      "- The wallet set stays the same, and the classifier keeps categorising the same way.",
      "",
      "NOT PROJECTED, and not to be projected: token price, market cap, holder count, treasury total, or any figure that depends on where a market goes. This block extends two averages forward by one period and does nothing else."
    );

    return `\n## Mechanical projection for the next period (arithmetic, NOT a forecast)\n${lines.join(
      "\n"
    )}`;
  },
  systemPromptFragment: `### Next Period Projection (CONDITIONAL)
- Only render when the input contains a "## Mechanical projection for the next period" block. Three sentences, maximum, plus at most two figures.
- **Open by naming what this is: a mechanical projection, not a prediction.** The first sentence must carry both the label and the assumptions — prices flat and spending continuing at the trailing average — in the same breath as the number. A projected figure quoted before its assumptions has already misled the reader; a caveat in a later sentence does not undo that.
- **Forbidden verbs and phrasings, without exception:** "will", "expects to", "is on track to", "is projected to reach", "should", "anticipates", "forecasts", "by year end". Use conditional framing only: "if the trailing average net flow repeats and prices hold, reserves would sit near $X". "Would", "if", and "at this rate" are the register.
- **Never project, mention, or imply a future token price, market cap, or valuation** — not as a number, not as a direction, not as a range. The input contains no price projection because a price projection cannot be made honestly, and inventing one is the single worst error available in this section.
- Do not attach a probability, a confidence level, or a word like "likely", "conservative", "comfortable" or "healthy" to the projection. It is arithmetic with no error bars.
- If the input says the projection breaks down or the projected figure is negative, say that the trailing average cannot be extended this far — never report a negative balance, a runway of zero, or a date the project runs out of money.
- State the extended figures only. Operational commentary — whether to raise, cut, extend, or diversify anything — belongs in the Recommendations section, not here.`,
  notReadyHint: "Needs at least two prior snapshots to average.",
};

const recommendations: ReportSection = {
  id: "recommendations",
  title: "Recommendations",
  description:
    "2-4 bullets of operational commentary for the treasury's own operators, each grounded in a figure from this report. Never investment advice about the project's token.",
  defaultEnabled: true,
  requires: (ctx) => decisionLedger(ctx).length > 0,
  userPromptFragment: (ctx) => {
    const ledger = decisionLedger(ctx);
    if (ledger.length === 0) return "";
    return `\n## Decision ledger (${ctx.snapshot.snapshotDate})\nEvery recommendation below MUST cite one of these findings, quoting its figure exactly as given. Do not cite a figure that is not on this list.\n${ledger
      .map((e) => `- ${e.finding}: ${e.figure}`)
      .join("\n")}`;
  },
  systemPromptFragment: `### Recommendations
- 2-4 bullets of operational commentary for the TREASURY'S OWN OPERATORS — the team managing this treasury — never advice to the reader as an outside investor deciding whether to buy, sell, or hold the project's token.
- **Every recommendation must cite a figure from the "## Decision ledger" block, quoted exactly as given.** A recommendation with no citable figure is an opinion this section does not carry. If the ledger holds only one item, write one bullet; never pad to reach four.
- **Absolute, non-negotiable: never mention, project, or imply a future token price, market cap, or valuation** — this ban is not relaxed anywhere in this report, and this section is not an exception.
- **Absolute, non-negotiable: never advise the reader to buy, sell, or hold the token**, in any wording, at any confidence.
- Each bullet is a recommendation ABOUT the treasury's own management — e.g. "Given concentration of 91% in [token], consider a diversification policy" or "Given a liquid runway of 4.2 months, consider building stablecoin reserves before the next raise." A bare restatement of a ledger figure with no recommendation attached belongs in the section that figure came from, not here.
- If the decision ledger is empty, this section produces nothing — never invent a recommendation to fill space.`,
  notReadyHint:
    "Needs at least one verified finding (liquidity, concentration, budget variance, or a named holding) to ground a recommendation.",
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
  keyTakeaways,
  wins,
  lowsConcerns,
  treasuryOverview,
  treasuryByChain,
  treasuryConcentration,
  previousMonthComparison,
  financialHealth,
  expenseBreakdown,
  actualVsBudget,
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
  nextPeriodForecast,
  recommendations,
  lookingAhead,
  asks,
  qaHighlights,
];

const SECTION_BY_ID: Record<string, ReportSection> = Object.fromEntries(
  SECTION_LIBRARY.map((s) => [s.id, s])
);

// Sections whose system rule must reach the model even when their own
// userPromptFragment is empty this period — because they are designed to
// write something regardless: a graceful "nothing material" sentence
// (Lows/Concerns), or content assembled implicitly from the whole context
// rather than a dedicated data block (Executive Summary). Every other
// section must go silent — rule and all — when its own fragment produces
// nothing, or the model can (and did, in production) reconstruct that
// section's narrative from figures that belong to a different section,
// obeying the letter of "use only the provided data" while violating the
// point of it.
const ALWAYS_INCLUDE_RULE = new Set(["executive_summary", "lows_concerns"]);

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

export function buildSystemPrompt(
  enabled: ReportSection[],
  ctx: ReportSectionContext
): string {
  const sectionRules = enabled
    .filter(
      (s) =>
        ALWAYS_INCLUDE_RULE.has(s.id) ||
        s.userPromptFragment(ctx).trim().length > 0
    )
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
- **Never write your own disclaimer, risk warning, or "not financial advice" notice.** The platform renders one automatically on every surface this report reaches. Writing your own duplicates it and risks contradicting its exact wording.
- Do not use excessive formatting. Clean, readable paragraphs.
- Total length: 800-1600 words.
- **The budget is shared across every section above, and it is not a target to fill.** If the input is thin, write a short report — padding is the failure mode this whole prompt is built to avoid. But the ceiling is not permission to drop a section either: when the word count is under pressure, tighten prose everywhere before removing anything the input supports. A section silently omitted because the budget ran out is indistinguishable, to the reader, from a section the data could not support.`;
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
