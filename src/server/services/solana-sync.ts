/**
 * Solana wallet sync via Helius.
 *
 * Helius gives us two things in one provider:
 *   - searchAssets RPC for SPL token balances with USD prices (via DAS API)
 *   - Enhanced Transactions REST API for parsed token + native transfers
 *
 * Native SOL balance comes from a vanilla `getBalance` RPC and is priced
 * through our existing CoinGecko-backed price-resolver. Anything else routes
 * through expense-classifier just like EVM transfers — same RawTransaction shape.
 */

import { STABLECOIN_SYMBOLS } from "@/lib/chains";
import type { WalletBalanceSummary, TokenBalance } from "./wallet-sync";
import type { RawTransaction } from "./expense-classifier";
import { tokenAmountToUsd, getHistoricalPrice } from "./price-resolver";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_REST_BASE = "https://api.helius.xyz/v0";

const LAMPORTS_PER_SOL = 1_000_000_000;

function ensureKey() {
  if (!HELIUS_API_KEY) {
    throw new Error(
      "HELIUS_API_KEY is not set — Solana sync requires a Helius key (https://helius.dev)"
    );
  }
}

// --- Balances ---------------------------------------------------------------

interface HeliusAsset {
  id: string;
  content?: { metadata?: { symbol?: string; name?: string } };
  token_info?: {
    symbol?: string;
    decimals?: number;
    balance?: string;
    price_info?: { price_per_token?: number; total_price?: number };
  };
}

interface HeliusSearchAssetsResult {
  items: HeliusAsset[];
}

async function rpcCall<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(HELIUS_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`Helius RPC ${method} → ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`Helius RPC ${method} error: ${JSON.stringify(data.error)}`);
  }
  return data.result as T;
}

export async function fetchSolanaBalance(
  address: string
): Promise<WalletBalanceSummary> {
  ensureKey();

  // Run native SOL balance + SPL search in parallel.
  const [nativeLamports, assetsResult] = await Promise.all([
    rpcCall<{ value: number } | number>("getBalance", [address]),
    rpcCall<HeliusSearchAssetsResult>("searchAssets", {
      ownerAddress: address,
      tokenType: "fungible",
      page: 1,
      limit: 1000,
    }),
  ]);

  const lamports =
    typeof nativeLamports === "number" ? nativeLamports : nativeLamports.value;
  const solAmount = lamports / LAMPORTS_PER_SOL;

  // Price SOL via the persistent price cache (also used for ETH/etc).
  const solPrice = (await getHistoricalPrice("SOL", new Date())) ?? 0;
  const solUsd = solAmount * solPrice;

  const tokens: TokenBalance[] = [];

  if (solAmount > 0) {
    tokens.push({
      symbol: "SOL",
      name: "Solana",
      amount: solAmount,
      priceUsd: solPrice,
      valueUsd: solUsd,
      contractAddress: null,
    });
  }

  let stablecoinsUsd = 0;
  // NOTE the semantic collision, deliberately left in place: this writes the
  // CHAIN's gas asset into `native_token_usd`, while wallet-sync.ts writes the
  // PROJECT's own token into the same column. Two incompatible meanings, one
  // column — and until P0.1 the PDF donut labelled both "Native token".
  //
  // It is now harmless rather than fixed, because those four columns are a
  // WRITE-ONLY CACHE: every report-facing surface derives its own composition
  // from `balances_detail` through `composeTreasury`, which classifies SOL as
  // liquid crypto (`CHAINS.solana.nativeToken`) and the project's own token as
  // concentrated, separately and correctly. Reconciling the column itself would
  // change what the dashboard tiles and historical charts show for every
  // existing Solana snapshot, which is a migration-shaped change, not this one.
  const nativeTokenUsd = solUsd;
  let otherAssetsUsd = 0;

  for (const asset of assetsResult.items ?? []) {
    const info = asset.token_info;
    if (!info) continue;
    const symbol = (info.symbol ?? asset.content?.metadata?.symbol ?? "").toUpperCase();
    if (!symbol) continue;
    const decimals = info.decimals ?? 0;
    const rawBalance = info.balance ? parseFloat(info.balance) : 0;
    if (rawBalance === 0) continue;
    const amount = rawBalance / Math.pow(10, decimals);
    const priceUsd = info.price_info?.price_per_token ?? 0;
    const valueUsd = info.price_info?.total_price ?? amount * priceUsd;

    tokens.push({
      symbol,
      name: asset.content?.metadata?.name ?? symbol,
      amount,
      priceUsd,
      valueUsd,
      contractAddress: asset.id,
    });

    if (STABLECOIN_SYMBOLS.has(symbol)) {
      stablecoinsUsd += valueUsd;
    } else {
      otherAssetsUsd += valueUsd;
    }
  }

  const totalUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);

  return {
    walletAddress: address,
    chain: "solana",
    tokens,
    totalUsd,
    stablecoinsUsd,
    // Solana has no concept of "ETH" — keep the field 0 so EVM/SVM rows
    // aggregate cleanly in fetchAllBalances.
    ethUsd: 0,
    nativeTokenUsd,
    otherAssetsUsd,
  };
}

// --- Transactions -----------------------------------------------------------

interface HeliusEnhancedTx {
  signature: string;
  timestamp: number; // unix seconds
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number; // lamports
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
    tokenStandard?: string;
  }>;
}

// Helius transactions endpoint is paginated by `before` (signature cursor).
// We page until the oldest tx is older than period.start, then bail.
async function fetchEnhancedTransactions(
  address: string,
  period: { start: Date; end: Date }
): Promise<HeliusEnhancedTx[]> {
  ensureKey();

  const startSec = Math.floor(period.start.getTime() / 1000);
  const endSec = Math.floor(period.end.getTime() / 1000);

  const all: HeliusEnhancedTx[] = [];
  let before: string | undefined;
  // Hard cap pages so a misconfigured period can't loop forever.
  const MAX_PAGES = 25;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(
      `${HELIUS_REST_BASE}/addresses/${address}/transactions`
    );
    url.searchParams.set("api-key", HELIUS_API_KEY!);
    url.searchParams.set("limit", "100");
    if (before) url.searchParams.set("before", before);

    const res = await fetch(url);
    if (!res.ok) break;
    const batch = (await res.json()) as HeliusEnhancedTx[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const tx of batch) {
      if (tx.timestamp < startSec) {
        // Reached older than period — stop the whole pagination.
        return all;
      }
      if (tx.timestamp <= endSec) all.push(tx);
    }

    before = batch[batch.length - 1].signature;
    if (batch.length < 100) break;
  }

  return all;
}

const SPL_TOKEN_SYMBOLS: Record<string, string> = {
  // Common SPL mints → symbols. Helius returns mint addresses; resolving each
  // via getAsset would explode the request count. We hardcode the heavy hitters
  // and fall through to "UNKNOWN" for the rest (priced as 0, flagged unknown).
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "SOL", // wrapped SOL
};

export async function fetchSolanaTransfers(
  walletAddress: string,
  period: { start: Date; end: Date }
): Promise<RawTransaction[]> {
  const txs = await fetchEnhancedTransactions(walletAddress, period);
  const result: RawTransaction[] = [];

  for (const tx of txs) {
    const blockTs = new Date(tx.timestamp * 1000);

    // Native SOL transfers
    for (const t of tx.nativeTransfers ?? []) {
      const isOut = t.fromUserAccount === walletAddress;
      const isIn = t.toUserAccount === walletAddress;
      if (!isOut && !isIn) continue;

      const amount = t.amount / LAMPORTS_PER_SOL;
      if (amount === 0) continue;

      const { usd, priceUnknown } = await tokenAmountToUsd("SOL", amount, blockTs);
      result.push({
        hash: tx.signature,
        from: t.fromUserAccount,
        to: t.toUserAccount,
        value: t.amount.toString(),
        token: "SOL",
        valueUsd: usd,
        timestamp: tx.timestamp * 1000,
        direction: isOut ? "out" : "in",
        priceUnknown,
      });
    }

    // SPL token transfers
    for (const t of tx.tokenTransfers ?? []) {
      const isOut = t.fromUserAccount === walletAddress;
      const isIn = t.toUserAccount === walletAddress;
      if (!isOut && !isIn) continue;
      if (!t.tokenAmount) continue;

      const symbol = SPL_TOKEN_SYMBOLS[t.mint] ?? "UNKNOWN";
      const { usd, priceUnknown } = await tokenAmountToUsd(
        symbol,
        t.tokenAmount,
        blockTs
      );
      result.push({
        hash: tx.signature,
        from: t.fromUserAccount,
        to: t.toUserAccount,
        value: t.tokenAmount.toString(),
        token: symbol,
        valueUsd: usd,
        timestamp: tx.timestamp * 1000,
        direction: isOut ? "out" : "in",
        priceUnknown: symbol === "UNKNOWN" ? true : priceUnknown,
      });
    }
  }

  return result;
}
