import type { Wallet } from "@/server/db/schema";
import {
  classifyTransactions,
  type ClassifiedTransaction,
  type RawTransaction,
} from "./expense-classifier";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY!;

const CHAIN_ALCHEMY_URLS: Record<string, string> = {
  ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  polygon: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  optimism: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
};

interface AlchemyTransfer {
  hash: string;
  from: string;
  to: string;
  value: string | null;
  asset: string | null;
  rawContract?: { value?: string; decimal?: string };
  metadata?: { blockTimestamp?: string };
}

export interface ExpenseSummary {
  payroll: number;
  infrastructure: number;
  marketing: number;
  grants: number;
  legal: number;
  token_sale: number;
  operational: number;
  other: number;
}

export interface TransactionSyncResult {
  transactions: ClassifiedTransaction[];
  totalInflowsUsd: number;
  totalOutflowsUsd: number;
  netFlowUsd: number;
  burnRateUsd: number;
  runwayMonths: number | null;
  expensesByCategory: ExpenseSummary;
}

async function fetchAlchemyTransfers(
  walletAddress: string,
  chain: string,
  periodStart: Date,
  periodEnd: Date,
  direction: "from" | "to"
): Promise<AlchemyTransfer[]> {
  const rpcUrl = CHAIN_ALCHEMY_URLS[chain];
  if (!rpcUrl) return [];

  const fromBlock = `0x0`; // Simplified — in production, convert date to block number
  const toBlock = "latest";

  const body = {
    id: 1,
    jsonrpc: "2.0",
    method: "alchemy_getAssetTransfers",
    params: [
      {
        [direction === "from" ? "fromAddress" : "toAddress"]: walletAddress,
        fromBlock,
        toBlock,
        category: ["external", "erc20"],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: "0x3e8", // 1000
      },
    ],
  };

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) return [];
  const data = await res.json();

  const transfers: AlchemyTransfer[] = data.result?.transfers ?? [];

  // Filter by date
  return transfers.filter((t) => {
    const ts = t.metadata?.blockTimestamp
      ? new Date(t.metadata.blockTimestamp).getTime()
      : 0;
    return ts >= periodStart.getTime() && ts <= periodEnd.getTime();
  });
}

function transferToRaw(
  t: AlchemyTransfer,
  direction: "in" | "out",
  estimatedUsdValue: number
): RawTransaction {
  return {
    hash: t.hash,
    from: t.from,
    to: t.to ?? "",
    value: t.value ?? "0",
    token: t.asset ?? "ETH",
    valueUsd: estimatedUsdValue,
    timestamp: t.metadata?.blockTimestamp
      ? new Date(t.metadata.blockTimestamp).getTime()
      : Date.now(),
    direction,
  };
}

export async function fetchAndClassify(
  wallets: Wallet[],
  period: { start: Date; end: Date },
  totalBalanceUsd: number
): Promise<TransactionSyncResult> {
  const allOutgoing: RawTransaction[] = [];
  const allIncoming: RawTransaction[] = [];

  await Promise.all(
    wallets.map(async (wallet) => {
      if (wallet.chain === "solana") return; // Solana uses different API

      const [outgoing, incoming] = await Promise.all([
        fetchAlchemyTransfers(wallet.address, wallet.chain, period.start, period.end, "from"),
        fetchAlchemyTransfers(wallet.address, wallet.chain, period.start, period.end, "to"),
      ]);

      for (const t of outgoing) {
        // Estimate USD value — in production, use price at block time
        const valueNum = parseFloat(t.value ?? "0");
        allOutgoing.push(transferToRaw(t, "out", valueNum));
      }
      for (const t of incoming) {
        const valueNum = parseFloat(t.value ?? "0");
        allIncoming.push(transferToRaw(t, "in", valueNum));
      }
    })
  );

  const classifiedOutgoing = await classifyTransactions(allOutgoing);

  const totalOutflowsUsd = classifiedOutgoing.reduce(
    (sum, t) => sum + t.valueUsd,
    0
  );
  const totalInflowsUsd = allIncoming.reduce((sum, t) => sum + t.valueUsd, 0);
  const netFlowUsd = totalInflowsUsd - totalOutflowsUsd;

  // Burn rate excludes token sales (treasury management, not expenses)
  const burnRateUsd = classifiedOutgoing
    .filter((t) => t.category !== "token_sale")
    .reduce((sum, t) => sum + t.valueUsd, 0);

  const runwayMonths =
    burnRateUsd > 0 ? totalBalanceUsd / burnRateUsd : null;

  const expensesByCategory: ExpenseSummary = {
    payroll: 0,
    infrastructure: 0,
    marketing: 0,
    grants: 0,
    legal: 0,
    token_sale: 0,
    operational: 0,
    other: 0,
  };
  for (const t of classifiedOutgoing) {
    expensesByCategory[t.category] += t.valueUsd;
  }

  const allClassified = [
    ...classifiedOutgoing,
    ...allIncoming.map((t) => ({ ...t, category: "other" as const, confidence: 1 })),
  ];

  return {
    transactions: allClassified,
    totalInflowsUsd,
    totalOutflowsUsd,
    netFlowUsd,
    burnRateUsd,
    runwayMonths,
    expensesByCategory,
  };
}
