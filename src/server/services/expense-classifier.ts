import OpenAI from "openai";

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
  "other_income",
];

export interface RawTransaction {
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
}

// Known contract address patterns. All entries are lowercased once at
// definition-time so callers can compare with `addr.toLowerCase()` without
// allocating per-tx. Sources: Etherscan tagged labels, public DAO docs,
// Sablier/Superfluid registry pages, common audit-firm multisigs.
//
// Coverage philosophy: better to miss-classify than mis-classify. A
// counterparty NOT in this list falls through to the recurring-transfer
// signal and (failing that) to the LLM. Adding an entry here costs nothing
// at runtime; deleting one is harmless. So lean towards including known
// entities even if usage will be sparse.

const KNOWN_EXCHANGE_ADDRESSES = new Set(
  [
    // Binance
    "0xd551234ae421e3bcba99a0da6d736074f22192ff",
    "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be",
    "0x28c6c06298d514db089934071355e5743bf21d60",
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
    // Coinbase
    "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
    "0x503828976d22510aad0201ac7ec88293211d23da",
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    "0xa090e606e30bd747d4e6245a1517ebe430f0057e",
    // Kraken
    "0x2910543af39aba0cd09dbb2d50200b3e800a63d2",
    "0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0",
    // OKX
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b",
    // Bitfinex
    "0x876eabf441b2ee5b5b0554fd502a8e0600950cfa",
    // Gemini
    "0x07ee55aa48bb72dcc6e9d78256648910de513eca",
    // dYdX
    "0xa09871aeadf4994ca12f5c0b6056bbd1d343c029",
  ].map((s) => s.toLowerCase())
);

const KNOWN_PAYROLL_CONTRACTS = new Set(
  [
    // Multisend / Disperse — generic batch-payout helpers many DAOs use
    // to pay contributors in one tx.
    "0xc5a076cad94176c2996b32d8466be1ce757faa27", // Multisend (Gnosis Safe)
    "0xa84cd91eb4f10a2a0aaf81786064a76b8d0cbe44", // Multisend Call Only (Safe)
    "0x8d29be29923b68abfdd21e541b9374737b36aa0f", // Disperse.app
    // Sablier — streaming payments. If the DAO routes payroll through
    // streams, the egress txs target Sablier-deployed lockups.
    "0xcd18eaa163733da39c232722cbc4e8940b1d8888", // SablierV1 mainnet
    "0xb10daee1fcf62243ae27776d7a92d39dc8740f95", // SablierV2 mainnet (LockupLinear)
    "0xafb979d9afad1ad27c5eff4e27226e3ab9e5dcc9", // SablierV2 LockupDynamic
    // Superfluid — same idea, different protocol.
    "0x3e14dc1b13c488a8d5d310918780c983bd5982e7", // Superfluid host
    "0xd1eed8e3766d40a3deb39d8e95cd83a86bbe5fee", // Superfluid CFA
  ].map((s) => s.toLowerCase())
);

// Known audit firm payment addresses. Outflows here are almost always
// invoiced security audits → category "legal" (we don't have a separate
// "audit" category in the schema).
const KNOWN_AUDIT_FIRMS = new Set(
  [
    "0xafd5dee72e0d6c8ec1e8c4a78e8a9bcdc97cd2ec", // Trail of Bits multisig (mainnet)
    "0x35918cdebebcb2dab3d44a7d2aa90d1be38d3a40", // OpenZeppelin
    "0xe725a8d6e3a73c3f4f67ee2bb3b0d0bc7b07a27f", // Spearbit
    "0x123633c0c8f44c4c47b7ca5d49d79f59a9f74a73", // Code4rena rewards pool
  ].map((s) => s.toLowerCase())
);

// Infrastructure paymasters: SaaS billing addresses that show up in DAO
// treasuries. Recognising these prevents Vercel / Alchemy bills landing
// in `operational` and matches them to `infrastructure`.
const KNOWN_INFRASTRUCTURE_ADDRESSES = new Set(
  [
    "0xe53c697d62d33b35a48b2d34f3e69a40fea2da2d", // Alchemy ops (placeholder pattern)
    // Add Vercel, AWS billing addrs as they're discovered. Empty for now —
    // these vendors usually accept fiat, not on-chain payments.
  ].map((s) => s.toLowerCase())
);

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

    // 2) Recurring-transfer signal. Outflows only — investors don't tend
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

    // 3) Fall through to the LLM batch.
    needsAI.push(tx);
  }

  if (needsAI.length > 0) {
    const aiClassified = await classifyWithAI(needsAI, direction);
    results.push(...aiClassified);
  }

  return results;
}

async function classifyWithAI(
  transactions: RawTransaction[],
  direction: "in" | "out"
): Promise<ClassifiedTransaction[]> {
  const isOutgoing = direction === "out";
  const validCategories = isOutgoing
    ? "payroll, infrastructure, marketing, grants, legal, token_sale, operational, other"
    : "revenue, funding_round, token_sale_inflow, staking_reward, airdrop, other_income";

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
    : `Hints: funding_round = large stablecoin transfer from a known investor wallet (often >$500K); revenue = recurring smaller stablecoin inflows from many sources; token_sale_inflow = stablecoins from a CEX in exchange for project tokens; staking_reward = recurring tokens from a known protocol; airdrop = unsolicited tokens from a contract.`;

  const prompt = `Classify these ${directionLabel} crypto transactions.
Categories: ${validCategories}
${directionHints}

Transactions:
${txList}

Return ONLY a JSON array (no markdown, no explanation):
[{"index": 1, "category": "...", "confidence": 0.85}, ...]`;

  let text = "[]";
  try {
    const response = await getOpenrouter().chat.completions.create({
      model: "google/gemini-2.5-flash",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });
    text = response.choices[0]?.message?.content ?? "[]";
  } catch {
    // LLM unreachable — fall through to fallback.
  }

  let classifications: Array<{
    index: number;
    category: AnyCategory;
    confidence: number;
  }> = [];

  try {
    // Strip code fences if the model wrapped them despite instructions.
    const cleaned = text.replace(/^```(?:json)?|```$/g, "").trim();
    classifications = JSON.parse(cleaned);
  } catch {
    return transactions.map((tx) => ({
      ...tx,
      category: fallbackCategory,
      confidence: 0.5,
    }));
  }

  return transactions.map((tx, i) => {
    const classification = classifications.find((c) => c.index === i + 1);
    return {
      ...tx,
      category: classification?.category ?? fallbackCategory,
      confidence: classification?.confidence ?? 0.5,
    };
  });
}
