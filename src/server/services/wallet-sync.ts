import { STABLECOIN_SYMBOLS } from "@/lib/chains";
import type { Wallet } from "@/server/db/schema";

const DUNE_API_BASE = "https://api.sim.dune.com/v1/evm";
const DUNE_API_KEY = process.env.DUNE_API_KEY!;

// In-memory cache: key → { data, expiresAt }
const cache = new Map<string, { data: DuneBalanceResponse; expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface DuneTokenBalance {
  symbol: string;
  name: string;
  amount: string;
  decimals: number;
  price_usd: number | null;
  value_usd: number | null;
  contract_address: string | null;
}

interface DuneBalanceResponse {
  wallet_address: string;
  balances: DuneTokenBalance[];
}

export interface TokenBalance {
  symbol: string;
  name: string;
  amount: number;
  priceUsd: number;
  valueUsd: number;
  contractAddress: string | null;
}

export interface WalletBalanceSummary {
  walletAddress: string;
  chain: string;
  tokens: TokenBalance[];
  totalUsd: number;
  stablecoinsUsd: number;
  ethUsd: number;
  nativeTokenUsd: number;
  otherAssetsUsd: number;
}

export interface ProjectBalanceSummary {
  totalBalanceUsd: number;
  stablecoinsUsd: number;
  ethUsd: number;
  nativeTokenUsd: number;
  otherAssetsUsd: number;
  balancesDetail: WalletBalanceSummary[];
}

async function fetchDuneBalances(
  address: string,
  chain: string
): Promise<DuneBalanceResponse> {
  const cacheKey = `${address}:${chain}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const chainParam = chain === "ethereum" ? "" : `?chain=${chain}`;
  const url = `${DUNE_API_BASE}/balances/${address}${chainParam}`;
  const res = await fetch(url, {
    headers: { "X-Sim-Api-Key": DUNE_API_KEY },
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { wallet_address: address, balances: [] };
    }
    throw new Error(`Dune API error: ${res.status} ${await res.text()}`);
  }

  const data: DuneBalanceResponse = await res.json();
  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

function classifyTokens(
  tokens: DuneTokenBalance[],
  nativeSymbol: string,
  projectTokenSymbol?: string | null
): { stablecoinsUsd: number; ethUsd: number; nativeTokenUsd: number; otherAssetsUsd: number } {
  let stablecoinsUsd = 0;
  let ethUsd = 0;
  let nativeTokenUsd = 0;
  let otherAssetsUsd = 0;

  for (const t of tokens) {
    const value = t.value_usd ?? 0;
    const symbol = t.symbol?.toUpperCase() ?? "";

    if (STABLECOIN_SYMBOLS.has(symbol)) {
      stablecoinsUsd += value;
    } else if (symbol === "ETH" || symbol === "WETH") {
      ethUsd += value;
    } else if (
      projectTokenSymbol &&
      symbol === projectTokenSymbol.toUpperCase()
    ) {
      nativeTokenUsd += value;
    } else {
      otherAssetsUsd += value;
    }
  }

  return { stablecoinsUsd, ethUsd, nativeTokenUsd, otherAssetsUsd };
}

export async function fetchWalletBalance(
  wallet: Wallet,
  projectTokenSymbol?: string | null
): Promise<WalletBalanceSummary> {
  const duneData = await fetchDuneBalances(wallet.address, wallet.chain);

  const tokens: TokenBalance[] = duneData.balances.map((b) => ({
    symbol: b.symbol,
    name: b.name,
    amount: Number(b.amount) / Math.pow(10, b.decimals),
    priceUsd: b.price_usd ?? 0,
    valueUsd: b.value_usd ?? 0,
    contractAddress: b.contract_address,
  }));

  const totalUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);
  const nativeSymbol = wallet.chain === "solana" ? "SOL" : "ETH";
  const classified = classifyTokens(duneData.balances, nativeSymbol, projectTokenSymbol);

  return {
    walletAddress: wallet.address,
    chain: wallet.chain,
    tokens,
    totalUsd,
    ...classified,
  };
}

export async function fetchAllBalances(
  wallets: Wallet[],
  projectTokenSymbol?: string | null
): Promise<ProjectBalanceSummary> {
  // Fetch all wallets in parallel (rate limiting: max 10 concurrent)
  const results = await Promise.all(
    wallets.map((w) => fetchWalletBalance(w, projectTokenSymbol))
  );

  const summary: ProjectBalanceSummary = {
    totalBalanceUsd: 0,
    stablecoinsUsd: 0,
    ethUsd: 0,
    nativeTokenUsd: 0,
    otherAssetsUsd: 0,
    balancesDetail: results,
  };

  for (const r of results) {
    summary.totalBalanceUsd += r.totalUsd;
    summary.stablecoinsUsd += r.stablecoinsUsd;
    summary.ethUsd += r.ethUsd;
    summary.nativeTokenUsd += r.nativeTokenUsd;
    summary.otherAssetsUsd += r.otherAssetsUsd;
  }

  return summary;
}

export async function fetchTokenMetrics(
  tokenContract: string,
  chain: string
): Promise<{
  tokenHoldersCount: number | null;
  tokenPriceUsd: number | null;
  tokenMarketCapUsd: number | null;
  tokenCirculatingSupply: number | null;
}> {
  // Dune Sim API token holders endpoint
  const url = `${DUNE_API_BASE}/token/${tokenContract}/holders/count?chain=${chain}`;
  try {
    const res = await fetch(url, {
      headers: { "X-Sim-Api-Key": DUNE_API_KEY },
    });
    if (!res.ok) return { tokenHoldersCount: null, tokenPriceUsd: null, tokenMarketCapUsd: null, tokenCirculatingSupply: null };
    const data = await res.json();
    return {
      tokenHoldersCount: data.count ?? null,
      tokenPriceUsd: data.price_usd ?? null,
      tokenMarketCapUsd: data.market_cap_usd ?? null,
      tokenCirculatingSupply: data.circulating_supply ?? null,
    };
  } catch {
    return { tokenHoldersCount: null, tokenPriceUsd: null, tokenMarketCapUsd: null, tokenCirculatingSupply: null };
  }
}
