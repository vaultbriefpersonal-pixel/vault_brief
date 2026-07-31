import type { Wallet } from "@/server/db/schema";
import {
  classifyTransactions,
  INCOME_CATEGORIES,
  INTERNAL_TRANSFER_CATEGORY,
  type ClassifiedTransaction,
  type IncomeCategory,
  type RawTransaction,
} from "./expense-classifier";
import { tokenAmountToUsd } from "./price-resolver";
import { monthsInDateRange } from "./report-period";
import { fetchSolanaTransfers } from "./solana-sync";
import {
  MAX_TRANSFER_PAGES,
  TRANSFERS_PER_PAGE_HEX,
  maxReasonableTxUsd,
  transferCategoriesFor,
} from "./transfer-fetch-policy";

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
  /**
   * `hash:log:N` — Alchemy's identifier for one transfer LEG, returned on
   * every `alchemy_getAssetTransfers` row and, until 2026-07, thrown away.
   * It is the only field that distinguishes the eight legs of a batch
   * distribution from each other; `hash` is shared by all of them.
   */
  uniqueId?: string;
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

export type IncomeSummary = Record<IncomeCategory, number>;

export interface SyncWarning {
  walletAddress: string;
  chain: string;
  error: string;
}

export interface TransactionSyncResult {
  transactions: ClassifiedTransaction[];
  totalInflowsUsd: number;
  totalOutflowsUsd: number;
  netFlowUsd: number;
  burnRateUsd: number;
  runwayMonths: number | null;
  expensesByCategory: ExpenseSummary;
  incomeByCategory: IncomeSummary;
  warnings: SyncWarning[];
}

/**
 * One wallet-direction's transfer history, plus anything that went wrong
 * getting it.
 *
 * The warnings are the point. This used to return a bare array and answer
 * three very different situations with the same empty one: the chain is not
 * supported, the RPC call failed, and the wallet genuinely had no transfers.
 * Downstream those read identically — as zero burn and zero inflows, which is
 * a finding, and a wrong one. Every path that cannot return complete history
 * now says so out loud, and `fetchAndClassify` surfaces it through the
 * `SyncWarning` channel the dashboard already renders.
 */
interface TransferFetchResult {
  transfers: AlchemyTransfer[];
  warnings: SyncWarning[];
}

/**
 * Every transfer for one wallet, in one direction, over one period.
 *
 * Pages to exhaustion rather than taking Alchemy's first 1000 and stopping —
 * the previous single-request version silently dropped everything past the
 * first page, which on a busy treasury is most of the period. `MAX_TRANSFER_PAGES`
 * bounds a pathological address, and hitting it is reported as truncation
 * rather than absorbed.
 *
 * Never throws: a failure here must not lose the OTHER direction's data, which
 * is fetched in parallel by the caller. Failures come back as warnings
 * alongside whatever was successfully retrieved before the failure.
 */
async function fetchAlchemyTransfers(
  walletAddress: string,
  chain: string,
  periodStart: Date,
  periodEnd: Date,
  direction: "from" | "to"
): Promise<TransferFetchResult> {
  const warn = (error: string): SyncWarning => ({
    walletAddress,
    chain,
    error,
  });

  const rpcUrl = CHAIN_ALCHEMY_URLS[chain];
  if (!rpcUrl) {
    return {
      transfers: [],
      warnings: [
        warn(
          `No Alchemy endpoint is configured for chain "${chain}", so no transfer history could be read. Figures derived from transactions (burn, inflows, outflows) do not include this wallet.`
        ),
      ],
    };
  }

  // Convert period bounds to block numbers so Alchemy doesn't scan the full chain.
  // Resolved in parallel — both calls hit the same RPC and benefit from the cache.
  const [fromBlock, toBlock] = await Promise.all([
    getBlockByTimestamp(chain, periodStart),
    getBlockByTimestamp(chain, periodEnd),
  ]);

  const categories = transferCategoriesFor(chain);
  const transfers: AlchemyTransfer[] = [];
  const warnings: SyncWarning[] = [];
  let pageKey: string | undefined;
  let pages = 0;

  while (pages < MAX_TRANSFER_PAGES) {
    const body = {
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [
        {
          [direction === "from" ? "fromAddress" : "toAddress"]: walletAddress,
          fromBlock,
          toBlock,
          category: categories,
          withMetadata: true,
          excludeZeroValue: true,
          maxCount: TRANSFERS_PER_PAGE_HEX,
          ...(pageKey ? { pageKey } : {}),
        },
      ],
    };

    let data: {
      result?: { transfers?: AlchemyTransfer[]; pageKey?: string };
      error?: { message?: string };
    };
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        warnings.push(
          warn(
            `Alchemy returned HTTP ${res.status} while reading ${direction === "from" ? "outgoing" : "incoming"} transfers${
              pages > 0 ? ` (after ${pages} page(s) succeeded)` : ""
            }. Transaction-derived figures for this wallet are incomplete.`
          )
        );
        break;
      }
      data = await res.json();
    } catch (err) {
      warnings.push(
        warn(
          `Could not reach Alchemy while reading ${direction === "from" ? "outgoing" : "incoming"} transfers: ${
            err instanceof Error ? err.message : String(err)
          }. Transaction-derived figures for this wallet are incomplete.`
        )
      );
      break;
    }

    // A JSON-RPC error carries HTTP 200. The most likely cause here is a
    // category this network does not serve — Alchemy scopes `internal` to
    // Ethereum and Polygon mainnet, and `transferCategoriesFor` encodes that,
    // but the mapping is ours and could go stale against their support matrix.
    // Say which categories were asked for so the cause is diagnosable rather
    // than a bare "request failed".
    if (data.error) {
      warnings.push(
        warn(
          `Alchemy rejected the transfer query (categories: ${categories.join(
            ", "
          )}): ${data.error.message ?? "unknown error"}. Transaction-derived figures for this wallet are incomplete.`
        )
      );
      break;
    }

    transfers.push(...(data.result?.transfers ?? []));
    pages += 1;
    pageKey = data.result?.pageKey;
    if (!pageKey) break;
  }

  // Reached the cap with more pages still waiting. This is the one case where
  // we have a lot of data and it is still not all of it — the least visible
  // failure mode and therefore the one most worth stating.
  if (pageKey && pages >= MAX_TRANSFER_PAGES) {
    warnings.push(
      warn(
        `More than ${MAX_TRANSFER_PAGES * 1000} ${direction === "from" ? "outgoing" : "incoming"} transfers in this period; reading stopped at the page cap. Transaction-derived figures for this wallet are a partial view.`
      )
    );
  }

  // Alchemy's block-range bounds are inclusive of whole blocks, so the edges
  // can carry transfers a few seconds outside the period. Filter to the real
  // window.
  return {
    transfers: transfers.filter((t) => {
      const ts = t.metadata?.blockTimestamp
        ? new Date(t.metadata.blockTimestamp).getTime()
        : 0;
      return ts >= periodStart.getTime() && ts <= periodEnd.getTime();
    }),
    warnings,
  };
}

/**
 * `maxTxUsd` is the caller's treasury-scaled sanity ceiling (see
 * `maxReasonableTxUsd`). Passed in rather than read from a module constant
 * because it depends on the project's own balance: a flat ceiling silently
 * zeroed a legitimate $60M transfer on a $1.06B treasury.
 */
async function transferToRaw(
  t: AlchemyTransfer,
  direction: "in" | "out",
  maxTxUsd: number
): Promise<RawTransaction> {
  const symbol = (t.asset ?? "ETH").toUpperCase();
  const amount = parseFloat(t.value ?? "0");
  const blockTs = t.metadata?.blockTimestamp
    ? new Date(t.metadata.blockTimestamp)
    : new Date();

  // Resolve USD value at the actual block time. Caller can still see the raw
  // token amount via the `value` field — `valueUsd` is now the real number.
  const { usd, priceUnknown } = await tokenAmountToUsd(symbol, amount, blockTs);
  const capped = usd > maxTxUsd;
  const cleanUsd = capped ? 0 : usd;

  // A zeroed transfer used to leave no trace at all — the row simply read $0
  // and nothing said why. Log it: on a real treasury this fires for spoofed
  // scam tickers, and on a large one it is the first sign the ceiling needs
  // revisiting.
  if (capped) {
    console.warn(
      `[sync] transfer ${t.hash} (${symbol}) priced at $${usd.toFixed(0)}, above the $${maxTxUsd.toFixed(0)} sanity cap — zeroed and flagged priceUnknown`
    );
  }

  return {
    // Spread-when-present rather than `uniqueId: t.uniqueId`: an explicit
    // `undefined` would survive into the stored JSONB as a key, and a row
    // that HAS the field set to nothing is harder to reason about later than
    // a row that simply lacks it (which is what every legacy row looks like).
    ...(typeof t.uniqueId === "string" && t.uniqueId
      ? { uniqueId: t.uniqueId }
      : {}),
    hash: t.hash,
    from: t.from,
    to: t.to ?? "",
    value: t.value ?? "0",
    token: symbol,
    valueUsd: cleanUsd,
    timestamp: blockTs.getTime(),
    direction,
    // Flag suspiciously-priced rows as priceUnknown so they don't poison
    // burn-rate downstream and can be inspected separately.
    priceUnknown: priceUnknown || capped,
  };
}

export async function fetchAndClassify(
  wallets: Wallet[],
  period: { start: Date; end: Date },
  totalBalanceUsd: number
): Promise<TransactionSyncResult> {
  const allOutgoing: RawTransaction[] = [];
  const allIncoming: RawTransaction[] = [];
  const warnings: SyncWarning[] = [];

  // Scaled off the treasury rather than a flat ceiling — see maxReasonableTxUsd.
  const maxTxUsd = maxReasonableTxUsd(totalBalanceUsd);

  // allSettled instead of all — one bad wallet (RPC down, bogus address)
  // shouldn't kill the whole snapshot. Failed wallets surface as warnings.
  const walletResults = await Promise.allSettled(
    wallets.map(async (wallet) => {
      if (wallet.chain === "solana") {
        const transfers = await fetchSolanaTransfers(wallet.address, period);
        return {
          wallet,
          outgoing: [] as RawTransaction[],
          incoming: [] as RawTransaction[],
          solana: transfers,
          fetchWarnings: [] as SyncWarning[],
        };
      }
      const [outgoing, incoming] = await Promise.all([
        fetchAlchemyTransfers(wallet.address, wallet.chain, period.start, period.end, "from"),
        fetchAlchemyTransfers(wallet.address, wallet.chain, period.start, period.end, "to"),
      ]);
      const [outgoingRaw, incomingRaw] = await Promise.all([
        Promise.all(outgoing.transfers.map((t) => transferToRaw(t, "out", maxTxUsd))),
        Promise.all(incoming.transfers.map((t) => transferToRaw(t, "in", maxTxUsd))),
      ]);
      return {
        wallet,
        outgoing: outgoingRaw,
        incoming: incomingRaw,
        solana: null as RawTransaction[] | null,
        // Incomplete history is not a failed wallet — we have data, just not
        // all of it. Carried out separately from the allSettled rejection path
        // so a partial read is disclosed rather than passing as complete.
        fetchWarnings: [...outgoing.warnings, ...incoming.warnings],
      };
    })
  );
  walletResults.forEach((res, i) => {
    const wallet = wallets[i];
    if (res.status === "rejected") {
      warnings.push({
        walletAddress: wallet.address,
        chain: wallet.chain,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
      console.warn(`[sync] wallet ${wallet.address} (${wallet.chain}) failed:`, res.reason);
      return;
    }
    warnings.push(...res.value.fetchWarnings);
    for (const w of res.value.fetchWarnings) {
      console.warn(`[sync] ${w.walletAddress} (${w.chain}): ${w.error}`);
    }
    if (res.value.solana) {
      for (const t of res.value.solana) {
        if (t.direction === "out") allOutgoing.push(t);
        else allIncoming.push(t);
      }
    } else {
      allOutgoing.push(...res.value.outgoing);
      allIncoming.push(...res.value.incoming);
    }
  });

  // Internal transfers — wallets that belong to this same project. Tx between
  // them are treasury movements (hot→cold, payroll multisig→ops) and must
  // never inflate burn or inflows. Classified pre-LLM by exact address match,
  // skipping the AI fallback entirely.
  const internalAddressSet = new Set(
    wallets.map((w) => w.address.toLowerCase())
  );
  const isInternal = (tx: RawTransaction) =>
    internalAddressSet.has((tx.from ?? "").toLowerCase()) &&
    internalAddressSet.has((tx.to ?? "").toLowerCase());

  const internalOut = allOutgoing.filter(isInternal);
  const externalOut = allOutgoing.filter((t) => !isInternal(t));
  const internalIn = allIncoming.filter(isInternal);
  const externalIn = allIncoming.filter((t) => !isInternal(t));

  // Classify both directions. classifyTransactions splits internally and uses
  // direction-aware rules + prompts (see expense-classifier.ts).
  const externalClassified = await classifyTransactions([
    ...externalOut,
    ...externalIn,
  ]);
  const internalClassified: ClassifiedTransaction[] = [
    ...internalOut.map((t) => ({
      ...t,
      category: INTERNAL_TRANSFER_CATEGORY,
      confidence: 1,
    })),
    ...internalIn.map((t) => ({
      ...t,
      category: INTERNAL_TRANSFER_CATEGORY,
      confidence: 1,
    })),
  ];
  const allClassified = [...externalClassified, ...internalClassified];
  // Burn / inflows / category breakdowns are computed from EXTERNAL only.
  const classifiedOutgoing = externalClassified.filter((t) => t.direction === "out");
  const classifiedIncoming = externalClassified.filter((t) => t.direction === "in");

  const totalOutflowsUsd = classifiedOutgoing.reduce(
    (sum, t) => sum + t.valueUsd,
    0
  );
  const totalInflowsUsd = classifiedIncoming.reduce(
    (sum, t) => sum + t.valueUsd,
    0
  );
  const netFlowUsd = totalInflowsUsd - totalOutflowsUsd;

  // Burn rate excludes token sales (treasury management, not expenses).
  // Internal transfers are already filtered out via externalClassified above.
  const burnRateUsd = classifiedOutgoing
    .filter((t) => t.category !== "token_sale")
    .reduce((sum, t) => sum + t.valueUsd, 0);

  // `runwayMonths` is stored in a column called `runway_months`, charted on
  // the dashboard tile and read as months by anomalies.ts. It has to actually
  // be months.
  //
  // `burnRateUsd` above is this PERIOD's total operating outflows, not a rate —
  // it has no denominator of its own. `balance / burnRateUsd` therefore yields
  // "how many of THIS PERIOD the balance covers", which equals months only
  // while the period is one month long. Over a 181-day grant window the naive
  // division would store runway in 181-day units under a name that says months,
  // understating it roughly six-fold with nothing in the output to say so.
  //
  // Dividing by the monthly-normalised burn fixes the unit. `monthsInDateRange`
  // returns EXACTLY 1 for a calendar month — which is every period this
  // product has ever synced — so the stored figure is bit-for-bit unchanged
  // for existing behaviour, and only a genuinely non-monthly window is scaled.
  const periodMonths = monthsInDateRange(period);
  const burnPerMonthUsd = burnRateUsd / periodMonths;
  const runwayMonths =
    burnRateUsd > 0 ? totalBalanceUsd / burnPerMonthUsd : null;

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
    if (t.category in expensesByCategory) {
      expensesByCategory[t.category as keyof ExpenseSummary] += t.valueUsd;
    }
  }

  const incomeByCategory: IncomeSummary = INCOME_CATEGORIES.reduce(
    (acc, c) => ({ ...acc, [c]: 0 }),
    {} as IncomeSummary
  );
  for (const t of classifiedIncoming) {
    if (INCOME_CATEGORIES.includes(t.category as IncomeCategory)) {
      incomeByCategory[t.category as IncomeCategory] += t.valueUsd;
    } else {
      incomeByCategory.other_income += t.valueUsd;
    }
  }

  return {
    transactions: allClassified,
    totalInflowsUsd,
    totalOutflowsUsd,
    netFlowUsd,
    burnRateUsd,
    runwayMonths,
    expensesByCategory,
    incomeByCategory,
    warnings,
  };
}
