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

export type AnyCategory = ExpenseCategory | IncomeCategory;

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

// Known contract address patterns
const KNOWN_EXCHANGE_ADDRESSES = new Set([
  "0xd551234ae421e3bcba99a0da6d736074f22192ff", // Binance
  "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be", // Binance
  "0xa09871aeadf4994ca12f5c0b6056bbd1d343c029", // dYdX
]);

const KNOWN_PAYROLL_CONTRACTS = new Set([
  "0xc5a076cad94176c2996b32d8466be1ce757faa27", // Multisend
  "0x8d29be29923b68abfdd21e541b9374737b36aa0f", // Disperse.app
]);

function ruleBasedClassifyOutgoing(tx: RawTransaction): ExpenseCategory | null {
  const toLower = tx.to?.toLowerCase();
  if (KNOWN_EXCHANGE_ADDRESSES.has(toLower)) return "token_sale";
  if (KNOWN_PAYROLL_CONTRACTS.has(toLower)) return "payroll";
  if (tx.valueUsd < 500) return "operational";
  return null;
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
  transactions: RawTransaction[]
): Promise<ClassifiedTransaction[]> {
  // Split by direction so we can apply direction-aware rules and prompts.
  // Outflows get expense categories; inflows get income categories.
  const outgoing: RawTransaction[] = [];
  const incoming: RawTransaction[] = [];
  for (const tx of transactions) {
    if (tx.direction === "in") incoming.push(tx);
    else outgoing.push(tx);
  }

  const [outResults, inResults] = await Promise.all([
    classifyByDirection(outgoing, "out"),
    classifyByDirection(incoming, "in"),
  ]);

  return [...outResults, ...inResults];
}

async function classifyByDirection(
  transactions: RawTransaction[],
  direction: "in" | "out"
): Promise<ClassifiedTransaction[]> {
  if (transactions.length === 0) return [];

  const results: ClassifiedTransaction[] = [];
  const needsAI: RawTransaction[] = [];

  for (const tx of transactions) {
    const category =
      direction === "out"
        ? ruleBasedClassifyOutgoing(tx)
        : ruleBasedClassifyIncoming(tx);
    if (category) {
      results.push({ ...tx, category, confidence: 0.9 });
    } else {
      needsAI.push(tx);
    }
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
