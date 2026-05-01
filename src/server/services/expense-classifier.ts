import OpenAI from "openai";

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export type ExpenseCategory =
  | "payroll"
  | "infrastructure"
  | "marketing"
  | "grants"
  | "legal"
  | "token_sale"
  | "operational"
  | "other";

export interface RawTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  token: string;
  valueUsd: number;
  timestamp: number;
  direction: "in" | "out";
}

export interface ClassifiedTransaction extends RawTransaction {
  category: ExpenseCategory;
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

function ruleBasedClassify(tx: RawTransaction): ExpenseCategory | null {
  const toLower = tx.to?.toLowerCase();
  if (KNOWN_EXCHANGE_ADDRESSES.has(toLower)) return "token_sale";
  if (KNOWN_PAYROLL_CONTRACTS.has(toLower)) return "payroll";
  if (tx.valueUsd < 500) return "operational";
  return null;
}

export async function classifyTransactions(
  transactions: RawTransaction[]
): Promise<ClassifiedTransaction[]> {
  const results: ClassifiedTransaction[] = [];
  const needsAI: RawTransaction[] = [];

  // First pass: rule-based classification
  for (const tx of transactions) {
    const category = ruleBasedClassify(tx);
    if (category) {
      results.push({ ...tx, category, confidence: 0.9 });
    } else {
      needsAI.push(tx);
    }
  }

  // Second pass: AI classification for ambiguous transactions
  if (needsAI.length > 0) {
    const aiClassified = await classifyWithAI(needsAI);
    results.push(...aiClassified);
  }

  return results;
}

async function classifyWithAI(
  transactions: RawTransaction[]
): Promise<ClassifiedTransaction[]> {
  const txList = transactions
    .map(
      (tx, i) =>
        `${i + 1}. Hash: ${tx.hash.slice(0, 10)}... | To: ${tx.to?.slice(0, 10)}... | Token: ${tx.token} | Amount: $${tx.valueUsd.toFixed(2)}`
    )
    .join("\n");

  const prompt = `Classify these crypto transactions into expense categories.
Categories: payroll, infrastructure, marketing, grants, legal, token_sale, operational, other

Transactions:
${txList}

Return ONLY a JSON array with this exact format (no markdown, no explanation):
[{"index": 1, "category": "payroll", "confidence": 0.85}, ...]`;

  const response = await openrouter.chat.completions.create({
    model: "google/gemini-2.5-flash",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0]?.message?.content ?? "[]";

  let classifications: Array<{
    index: number;
    category: ExpenseCategory;
    confidence: number;
  }> = [];

  try {
    classifications = JSON.parse(text);
  } catch {
    // Fallback: classify all as "other"
    return transactions.map((tx) => ({
      ...tx,
      category: "other" as ExpenseCategory,
      confidence: 0.5,
    }));
  }

  return transactions.map((tx, i) => {
    const classification = classifications.find((c) => c.index === i + 1);
    return {
      ...tx,
      category: classification?.category ?? "other",
      confidence: classification?.confidence ?? 0.5,
    };
  });
}
