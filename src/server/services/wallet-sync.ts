import { CHAINS, STABLECOIN_SYMBOLS } from "@/lib/chains";
import type { Wallet } from "@/server/db/schema";

const DUNE_API_BASE = "https://api.sim.dune.com/v1/evm";
const DUNE_API_KEY = process.env.DUNE_API_KEY!;

function evmChainId(chain: string): number | null {
  const cfg = CHAINS[chain as keyof typeof CHAINS];
  return cfg?.id ?? null;
}

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
  // Solana balances must go through solana-sync (Helius) — Dune Sim is EVM-only here.
  if (chain === "solana") {
    throw new Error("solana balances must go through solana-sync");
  }

  const cacheKey = `${address}:${chain}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Sim API expects chain_ids as a numeric chain ID. Without it the endpoint
  // returns balances across "default-tagged" chains, which is not what we want.
  const chainId = evmChainId(chain);
  const chainParam = chainId ? `?chain_ids=${chainId}` : "";
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
  // Solana goes through Helius; EVM through Dune Sim. Both produce the same
  // WalletBalanceSummary shape, so the rest of the function is chain-agnostic.
  // Lazy import keeps Helius env-var checks out of the hot path for EVM-only deployments.
  const { fetchSolanaBalance } = await import("./solana-sync");
  const results = await Promise.all(
    wallets.map((w) =>
      w.chain === "solana"
        ? fetchSolanaBalance(w.address)
        : fetchWalletBalance(w, projectTokenSymbol)
    )
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

interface TokenMetrics {
  tokenHoldersCount: number | null;
  tokenPriceUsd: number | null;
  tokenMarketCapUsd: number | null;
  tokenCirculatingSupply: number | null;
}

const EMPTY_METRICS: TokenMetrics = {
  tokenHoldersCount: null,
  tokenPriceUsd: null,
  tokenMarketCapUsd: null,
  tokenCirculatingSupply: null,
};

export async function fetchTokenMetrics(
  tokenContract: string,
  chain: string
): Promise<TokenMetrics> {
  const chainId = evmChainId(chain);
  if (!chainId) return EMPTY_METRICS; // SVM/unknown chains handled elsewhere.

  // Real Sim endpoint — the previous /token/{c}/holders/count path doesn't
  // exist. token-info covers price + supply + FDV in one shot.
  const url = `${DUNE_API_BASE}/token-info/${tokenContract}?chain_ids=${chainId}`;
  try {
    const res = await fetch(url, {
      headers: { "X-Sim-Api-Key": DUNE_API_KEY },
    });
    if (!res.ok) return EMPTY_METRICS;
    const data = (await res.json()) as {
      price_usd?: number;
      total_supply?: string | number;
      fully_diluted_value?: number;
    };

    const totalSupply =
      typeof data.total_supply === "string"
        ? parseFloat(data.total_supply)
        : typeof data.total_supply === "number"
          ? data.total_supply
          : null;

    return {
      tokenPriceUsd: typeof data.price_usd === "number" ? data.price_usd : null,
      tokenMarketCapUsd:
        typeof data.fully_diluted_value === "number"
          ? data.fully_diluted_value
          : null,
      tokenCirculatingSupply:
        totalSupply !== null && Number.isFinite(totalSupply) ? totalSupply : null,
      // Holders count requires paginating /token-holders — too expensive for
      // a monthly sync. Left null until we add a dedicated holder-count job.
      tokenHoldersCount: null,
    };
  } catch {
    return EMPTY_METRICS;
  }
}
