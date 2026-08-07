import OpenAI from "openai";
import {
  KNOWN_EXCHANGE_ADDRESSES,
  KNOWN_PAYROLL_CONTRACTS,
  KNOWN_AUDIT_FIRMS,
  KNOWN_INFRASTRUCTURE_ADDRESSES,
} from "./counterparty-labels";

let _openrouter: OpenAI | undefined;
function getOpenrouter() {
  if (!_openrouter) {
    _openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }
  return _openrouter;
}

export type ExpenseCategory =
  | "payroll"
  | "infrastructure"
  | "marketing"
  | "grants"
  | "legal"
  | "token_sale"
  | "operational"
  | "other";

export type IncomeCategory =
  | "revenue" // Product/protocol revenue (fees, subscriptions, etc.)
  | "funding_round" // Investor inbound (seed/series A/etc.)
  | "token_sale_inflow" // Stablecoins received from selling project tokens
  | "staking_reward" // Yield from staking, LP rewards
  | "airdrop" // Tokens received from external airdrops
  | "grant_received" // Funds received from an ecosystem grant program
  | "other_income"; // Catch-all for unclassified inflows

/**
 * Direction-agnostic category for transfers between wallets owned by the
 * same project. Excluded from burn rate, expense breakdown, and inflows —
 * these are treasury movements, not real spend or income.
 */
export const INTERNAL_TRANSFER_CATEGORY = "internal_transfer" as const;
export type InternalCategory = typeof INTERNAL_TRANSFER_CATEGORY;

export type AnyCategory = ExpenseCategory | IncomeCategory | InternalCategory;

export const INCOME_CATEGORIES: IncomeCategory[] = [
  "revenue",
  "funding_round",
  "token_sale_inflow",
  "staking_reward",
  "airdrop",
  "grant_received",
  "other_income",
];

/**
 * The `ExpenseCategory` union as a runtime list. Server-only consumers that
 * need to validate a category string against the real set — the
 * project-budgets router's Zod input — read this rather than re-typing the
 * names. Nothing in the client bundle may import it: this module opens with
 * `import OpenAI from "openai"`.
 */
export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "payroll",
  "infrastructure",
  "marketing",
  "grants",
  "legal",
  "token_sale",
  "operational",
  "other",
];

export interface RawTransaction {
  /**
   * Alchemy's per-LEG identifier (`hash:log:N`). One transaction produces
   * several legs — a batch payout, both sides of a swap — and they all share
   * `hash`, so `hash` alone cannot identify a row. Optional: Solana rows
   * (Helius has no equivalent) and every row written before 2026-07 have
   * none, which is why transaction-sample.ts carries a composite fallback.
   */
  uniqueId?: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  token: string;
  valueUsd: number;
  timestamp: number;
  direction: "in" | "out";
  /** True when no historical price could be resolved — valueUsd is 0 in that case. */
  priceUnknown?: boolean;
}

export interface ClassifiedTransaction extends RawTransaction {
  category: AnyCategory;
  confidence: number;
  /** True when a rule identified this as likely spam rather than genuine income. Absent (not false) everywhere else. */
  spamSuspect?: boolean;
  /**
   * True when NO classifier produced a verdict and `category` is merely the
   * fallback — the model returned nothing for this transaction, or its
   * response could not be parsed after a retry.
   *
   * This is the difference between "we judged this miscellaneous" and "we
   * could not tell what this was", which `category: "other"` alone cannot
   * express: `other` is also a legitimate, founder-budgetable category. Read
   * by `transaction-sync.ts` to route the amount into
   * `ExpenseSummary.unclassified` instead of `other`, which is what lets the
   * report disclose the gap rather than present it as a spending decision.
   *
   * Absent (not false) on every classified transaction.
   */
  unclassified?: true;
}

// The known-address sets live in ./counterparty-labels — a deliberately
// import-free module, because report sections need the same lookup and they
// ship to the browser. See that file's header before moving anything back.

function ruleBasedClassifyOutgoing(tx: RawTransaction): ExpenseCategory | null {
  const toLower = tx.to?.toLowerCase();
  if (!toLower) return null;
  if (KNOWN_EXCHANGE_ADDRESSES.has(toLower)) return "token_sale";
  if (KNOWN_PAYROLL_CONTRACTS.has(toLower)) return "payroll";
  if (KNOWN_AUDIT_FIRMS.has(toLower)) return "legal";
  if (KNOWN_INFRASTRUCTURE_ADDRESSES.has(toLower)) return "infrastructure";
  if (tx.valueUsd < 500) return "operational";
  return null;
}

// ─── Recurring-transfer signal ─────────────────────────────────────────────
//
// If a project sends roughly the same amount to the same address multiple
// months in a row, that pattern is almost always payroll / retainer. Catch
// it before falling through to the LLM — saves an API call and gives a
// strong signal that "$42K to 0xabc... again" is salary, not "operational".

interface RecurrenceSnapshot {
  /** Map<lowercase-to-address, list of valueUsd amounts> over the lookback window. */
  history: Map<string, number[]>;
}

/**
 * Build a per-counterparty history map from prior transactions. Caller is
 * expected to pass the previous N months of outgoing transactions for the
 * project. Returns an opaque snapshot that detectRecurringPayroll consults.
 */
export function buildRecurrenceSnapshot(
  priorOutgoing: RawTransaction[]
): RecurrenceSnapshot {
  const history = new Map<string, number[]>();
  for (const tx of priorOutgoing) {
    const k = tx.to?.toLowerCase();
    if (!k || !tx.valueUsd) continue;
    const arr = history.get(k) ?? [];
    arr.push(tx.valueUsd);
    history.set(k, arr);
  }
  return { history };
}

/**
 * Recurring detection: at least 3 prior transfers to the same `to`-address
 * within ±15% of the current tx amount. Returns confidence in [0, 0.95].
 * 0 means "no recurrence pattern" — caller falls back to other heuristics
 * or the LLM.
 */
export function detectRecurringPayroll(
  tx: RawTransaction,
  snap: RecurrenceSnapshot
): number {
  const k = tx.to?.toLowerCase();
  if (!k) return 0;
  const past = snap.history.get(k);
  if (!past || past.length < 2) return 0;
  const tolerance = 0.15;
  const target = tx.valueUsd;
  const matches = past.filter(
    (v) => v > 0 && Math.abs(v - target) / target <= tolerance
  ).length;
  if (matches >= 2) return Math.min(0.95, 0.7 + matches * 0.05);
  return 0;
}

function ruleBasedClassifyIncoming(tx: RawTransaction): IncomeCategory | null {
  const fromLower = tx.from?.toLowerCase();
  // Stablecoins arriving from a known exchange typically = proceeds from a token sale.
  // Stablecoins (USDC/USDT/DAI) by themselves can't be airdrops or staking rewards.
  if (KNOWN_EXCHANGE_ADDRESSES.has(fromLower)) {
    const stables = ["USDC", "USDT", "DAI", "FRAX"];
    if (stables.includes(tx.token.toUpperCase())) return "token_sale_inflow";
  }
  // Tiny inflows are noise — dust transfers, refunds, gas top-ups.
  if (tx.valueUsd > 0 && tx.valueUsd < 100) return "other_income";
  // Deliberately no rule for `grant_received`: there is no reliable address
  // list for grant-program treasuries, and a wrong hard-coded rule here would
  // beat the LLM's judgement at 0.9 confidence. The hook for one already
  // exists in the plan — the grant-awards table records a `grantor` per award,
  // and those addresses could later seed a known-set the way
  // KNOWN_EXCHANGE_ADDRESSES does above. Until that data exists, the prompt
  // hint does the work.
  return null;
}

export async function classifyTransactions(
  transactions: RawTransaction[],
  /**
   * Optional history of prior outgoing transactions. When supplied, the
   * recurring-transfer detector promotes "looks like salary" txs to
   * `payroll` before they hit the LLM. Pass an empty array (or omit) for
   * first-month sync — recurrence kicks in on snapshot 2+.
   */
  priorOutgoing: RawTransaction[] = []
): Promise<ClassifiedTransaction[]> {
  // Split by direction so we can apply direction-aware rules and prompts.
  // Outflows get expense categories; inflows get income categories.
  const outgoing: RawTransaction[] = [];
  const incoming: RawTransaction[] = [];
  for (const tx of transactions) {
    if (tx.direction === "in") incoming.push(tx);
    else outgoing.push(tx);
  }

  const recurrence = buildRecurrenceSnapshot(priorOutgoing);

  const [outResults, inResults] = await Promise.all([
    classifyByDirection(outgoing, "out", recurrence),
    classifyByDirection(incoming, "in", undefined),
  ]);

  return [...outResults, ...inResults];
}

async function classifyByDirection(
  transactions: RawTransaction[],
  direction: "in" | "out",
  recurrence: RecurrenceSnapshot | undefined
): Promise<ClassifiedTransaction[]> {
  if (transactions.length === 0) return [];

  const results: ClassifiedTransaction[] = [];
  const needsAI: RawTransaction[] = [];

  for (const tx of transactions) {
    // 1) Hard-coded address match wins immediately.
    const ruleCategory =
      direction === "out"
        ? ruleBasedClassifyOutgoing(tx)
        : ruleBasedClassifyIncoming(tx);
    if (ruleCategory) {
      results.push({ ...tx, category: ruleCategory, confidence: 0.9 });
      continue;
    }

    // 2) Inbound, unpriceable, and recorded at exactly zero — an unsolicited
    //    spam airdrop, not a judgment call. Never sent to the LLM: that call
    //    previously came back with a fabricated 0.95 confidence for "airdrop",
    //    which is both wrong (it's a guess, not a fact) and wasted tokens on an
    //    unambiguous case. 0.3 confidence is deliberately low — high enough to
    //    still slot into `airdrop`'s existing category handling, low enough
    //    that nothing downstream mistakes this for a confident classification.
    if (direction === "in" && tx.priceUnknown === true && tx.valueUsd === 0) {
      results.push({ ...tx, category: "airdrop", confidence: 0.3, spamSuspect: true });
      continue;
    }

    // 3) Recurring-transfer signal. Outflows only — investors don't tend
    //    to pay the project the same amount three months in a row, but
    //    contributors do. Bypasses the LLM with high confidence when
    //    confirmed.
    if (direction === "out" && recurrence) {
      const recurConf = detectRecurringPayroll(tx, recurrence);
      if (recurConf >= 0.7) {
        results.push({ ...tx, category: "payroll", confidence: recurConf });
        continue;
      }
    }

    // 4) Fall through to the LLM batch.
    needsAI.push(tx);
  }

  if (needsAI.length > 0) {
    const aiClassified = await classifyWithAI(needsAI, direction);
    results.push(...aiClassified);
  }

  return results;
}

/**
 * How many transactions go into one classification prompt.
 *
 * THIS EXISTS BECAUSE OF A REAL INCIDENT. `classifyWithAI` used to send every
 * transaction in a single prompt under a flat `max_tokens: 1000`. Each
 * returned entry costs ~35-45 tokens, so a period with ~25 transactions
 * overran the budget, the JSON array came back truncated, `JSON.parse` threw,
 * and EVERY transaction silently took the fallback category. Observed in
 * production: 21 of 22 outgoing transactions became `other` at confidence
 * 0.5, which swept a $567,447.64 token sale into operating burn and
 * understated runway roughly fourfold.
 *
 * Twelve keeps a batch's worst-case response far inside its budget while
 * keeping the request count small.
 */
export const CLASSIFY_BATCH_SIZE = 12;

/** Split into fixed-size batches, preserving order. Exported for tests. */
export function chunkForClassification<T>(items: T[], size: number): T[][] {
  if (size <= 0) return items.length > 0 ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Output budget for one batch, sized from the batch rather than fixed.
 *
 * 80 tokens per entry is roughly double the observed ~35-45 an entry costs,
 * so a batch cannot truncate the way the old flat ceiling did. The 400 floor
 * covers a one- or two-item batch, where per-item scaling alone would be
 * tighter than the model's own preamble.
 */
export function maxTokensForBatch(count: number): number {
  return Math.max(400, count * 80);
}

async function classifyWithAI(
  transactions: RawTransaction[],
  direction: "in" | "out"
): Promise<ClassifiedTransaction[]> {
  if (transactions.length === 0) return [];
  const batches = chunkForClassification(transactions, CLASSIFY_BATCH_SIZE);
  const results = await Promise.all(
    batches.map((batch) => classifyBatch(batch, direction))
  );
  return results.flat();
}

async function classifyBatch(
  transactions: RawTransaction[],
  direction: "in" | "out"
): Promise<ClassifiedTransaction[]> {
  const isOutgoing = direction === "out";
  const validCategories = isOutgoing
    ? "payroll, infrastructure, marketing, grants, legal, token_sale, operational, other"
    : "revenue, funding_round, token_sale_inflow, staking_reward, airdrop, grant_received, other_income";

  const fallbackCategory: AnyCategory = isOutgoing ? "other" : "other_income";

  const counterpartyLabel = isOutgoing ? "To" : "From";
  const txList = transactions
    .map((tx, i) => {
      const counterparty = isOutgoing ? tx.to : tx.from;
      return `${i + 1}. Hash: ${tx.hash.slice(0, 10)}... | ${counterpartyLabel}: ${counterparty?.slice(0, 10)}... | Token: ${tx.token} | Amount: $${tx.valueUsd.toFixed(2)}`;
    })
    .join("\n");

  const directionLabel = isOutgoing ? "outgoing (expenses)" : "incoming (income)";
  const directionHints = isOutgoing
    ? `Hints: payroll = recurring transfers to multiple EOAs; infrastructure = SaaS/cloud (often USDC); grants = one-off larger transfers to single recipients; token_sale = stablecoins to a CEX/OTC; operational = small misc spend.`
    : `Hints: funding_round = large stablecoin transfer from a known investor wallet (often >$500K); revenue = recurring smaller stablecoin inflows from many sources; token_sale_inflow = stablecoins from a CEX in exchange for project tokens; staking_reward = recurring tokens from a known protocol; airdrop = unsolicited tokens from a contract; grant_received = an award paid out of a foundation, DAO or ecosystem-program treasury — the sender is a program multisig that funds many unrelated teams and typically pays in scheduled tranches, and nothing is given back for the money. Decide grant_received vs funding_round on the counterparty, not the amount: a program/foundation treasury paying against a public award is grant_received; a single investor or fund wallet buying equity or a token warrant is funding_round.`;

  const prompt = `Classify these ${directionLabel} crypto transactions.
Categories: ${validCategories}
${directionHints}

Transactions:
${txList}

Return ONLY a JSON array (no markdown, no explanation):
[{"index": 1, "category": "...", "confidence": 0.85}, ...]`;

  type Classification = {
    index: number;
    category: AnyCategory;
    confidence: number;
  };

  // Two attempts, then give up and mark the batch unclassified. A parse
  // failure is usually a one-off formatting wobble, and re-asking is far
  // cheaper than mislabelling a whole period's spending — the failure this
  // whole function was rewritten to stop hiding.
  let classifications: Classification[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let text = "";
    try {
      const response = await getOpenrouter().chat.completions.create({
        model: "google/gemini-2.5-flash",
        // Sized from the batch, never flat — see `maxTokensForBatch`.
        max_tokens: maxTokensForBatch(transactions.length),
        // Labelling, not writing. The same transactions classified correctly
        // on one sync and not the next; pinning this removes that coin flip.
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      });
      text = response.choices[0]?.message?.content ?? "";
    } catch {
      // LLM unreachable — retry once, then fall through to the marker below.
      continue;
    }

    try {
      // Strip code fences if the model wrapped them despite instructions.
      const cleaned = text.replace(/^```(?:json)?|```$/g, "").trim();
      const parsed: unknown = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        classifications = parsed as Classification[];
        break;
      }
    } catch {
      // Malformed or truncated JSON — retry once, then fall through.
    }
  }

  return transactions.map((tx, i) => {
    const classification = classifications.find((c) => c.index === i + 1);
    if (!classification) {
      // NOT a category — the absence of one. `unclassified` is what stops
      // this from being indistinguishable downstream from a transaction the
      // model genuinely judged to be miscellaneous spend. See
      // `ExpenseSummary.unclassified` in transaction-sync.ts.
      return {
        ...tx,
        category: fallbackCategory,
        confidence: 0.5,
        unclassified: true as const,
      };
    }
    return {
      ...tx,
      category: classification.category,
      confidence: classification.confidence,
    };
  });
}
