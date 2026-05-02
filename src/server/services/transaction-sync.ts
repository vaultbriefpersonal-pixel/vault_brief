import type { Wallet } from "@/server/db/schema";
import {
  classifyTransactions,
  type ClassifiedTransaction,
  type RawTransaction,
} from "./expense-classifier";
import { tokenAmountToUsd } from "./price-resolver";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY!;

const CHAIN_ALCHEMY_URLS: Record<string, string> = {
  ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  polygon: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  optimism: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
};

// Average block time per chain (seconds). Used to estimate target block before refining.
const CHAIN_BLOCK_TIME_S: Record<string, number> = {
  ethereum: 12,
  polygon: 2,
  arbitrum: 0.25,
  base: 2,
  optimism: 2,
};

// In-memory cache: `${chain}:${unixSec}` -> blockNumber. Historic blocks never change,
// so this can live for the full process lifetime. Keeps cold-start ~5-7 RPC calls per
// (chain, period) tuple; warm syncs are free.
const blockCache = new Map<string, number>();

async function rpcCall<T = unknown>(
  rpcUrl: string,
  method: string,
  params: unknown[]
): Promise<T | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.result ?? null) as T | null;
  } catch {
    return null;
  }
}

interface RpcBlock {
  number: string;
  timestamp: string;
}

/**
 * Convert a wall-clock timestamp to the block number whose timestamp is the
 * largest one <= target. Strategy: estimate via average block time, then
 * bisect a small window to refine. Caches per (chain, second) so monthly
 * syncs only pay for the first run.
 */
async function getBlockByTimestamp(
  chain: string,
  target: Date
): Promise<string> {
  const rpcUrl = CHAIN_ALCHEMY_URLS[chain];
  if (!rpcUrl) return "0x0";

  const targetSec = Math.floor(target.getTime() / 1000);
  const cacheKey = `${chain}:${targetSec}`;
  const cached = blockCache.get(cacheKey);
  if (cached !== undefined) return `0x${cached.toString(16)}`;

  // 1. Get latest block to anchor our estimate.
  const latest = await rpcCall<RpcBlock>(rpcUrl, "eth_getBlockByNumber", [
    "latest",
    false,
  ]);
  if (!latest) return "0x0";

  const latestNum = parseInt(latest.number, 16);
  const latestTs = parseInt(latest.timestamp, 16);

  // Target is in the future or at/after head — use latest.
  if (targetSec >= latestTs) {
    blockCache.set(cacheKey, latestNum);
    return latest.number;
  }

  const blockTime = CHAIN_BLOCK_TIME_S[chain] ?? 12;
  const deltaBlocks = Math.floor((latestTs - targetSec) / blockTime);
  let estimate = Math.max(1, latestNum - deltaBlocks);

  // 2. Refine: walk up to ~6 iterations, each time correcting by the timestamp diff.
  for (let i = 0; i < 6; i++) {
    const block = await rpcCall<RpcBlock>(rpcUrl, "eth_getBlockByNumber", [
      `0x${estimate.toString(16)}`,
      false,
    ]);
    if (!block) break;

    const ts = parseInt(block.timestamp, 16);
    const diff = ts - targetSec;
    if (Math.abs(diff) <= blockTime * 2) {
      // Close enough — within ~2 blocks. Walk back if we overshot.
      if (diff > 0) estimate = Math.max(1, estimate - 1);
      break;
    }
    const correction = Math.floor(diff / blockTime);
    const next = estimate - correction;
    if (next === estimate) break;
    estimate = Math.max(1, Math.min(latestNum, next));
  }

  blockCache.set(cacheKey, estimate);
  return `0x${estimate.toString(16)}`;
}

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

  // Convert period bounds to block numbers so Alchemy doesn't scan the full chain.
  // Resolved in parallel — both calls hit the same RPC and benefit from the cache.
  const [fromBlock, toBlock] = await Promise.all([
    getBlockByTimestamp(chain, periodStart),
    getBlockByTimestamp(chain, periodEnd),
  ]);

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

async function transferToRaw(
  t: AlchemyTransfer,
  direction: "in" | "out"
): Promise<RawTransaction> {
  const symbol = (t.asset ?? "ETH").toUpperCase();
  const amount = parseFloat(t.value ?? "0");
  const blockTs = t.metadata?.blockTimestamp
    ? new Date(t.metadata.blockTimestamp)
    : new Date();

  // Resolve USD value at the actual block time. Caller can still see the raw
  // token amount via the `value` field — `valueUsd` is now the real number.
  const { usd, priceUnknown } = await tokenAmountToUsd(symbol, amount, blockTs);

  return {
    hash: t.hash,
    from: t.from,
    to: t.to ?? "",
    value: t.value ?? "0",
    token: symbol,
    valueUsd: usd,
    timestamp: blockTs.getTime(),
    direction,
    priceUnknown,
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

      // Resolve USD prices in parallel — price-resolver caches both in-memory
      // and in Postgres, so repeated symbols on the same day cost one API call.
      const [outgoingRaw, incomingRaw] = await Promise.all([
        Promise.all(outgoing.map((t) => transferToRaw(t, "out"))),
        Promise.all(incoming.map((t) => transferToRaw(t, "in"))),
      ]);
      allOutgoing.push(...outgoingRaw);
      allIncoming.push(...incomingRaw);
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
