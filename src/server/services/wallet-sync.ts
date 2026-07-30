import { CHAINS, STABLECOIN_SYMBOLS } from "@/lib/chains";
import type { Wallet } from "@/server/db/schema";
import { fetchSolanaBalance } from "./solana-sync";

const DUNE_API_BASE = "https://api.sim.dune.com/v1/evm";
const DUNE_API_KEY = process.env.DUNE_API_KEY!;

function evmChainId(chain: string): number | null {
  const cfg = CHAINS[chain as keyof typeof CHAINS];
  return cfg?.id ?? null;
}

// In-memory cache: key → { data, expiresAt }
const cache = new Map<string, { data: DuneBalanceResponse; expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Field names are Dune Sim's, verified against a live
// GET /v1/evm/balances/{address}?chain_ids=1 response. The contract address
// comes back as `address` — NOT `contract_address`, which this interface used
// to declare. Nothing failed loudly: `b.contract_address` read as `undefined`,
// JSON.stringify dropped the key, and every stored token silently lost its
// contract. That disabled contract-first own-token matching
// (treasury-liquidity.ts), LSD address matching (defi-positions.ts) and token
// identity in treasury-attribution.ts. Do not "tidy" this name.
//
// `pool_size` is also present on real responses and is deliberately NOT
// captured: it is absent for USDC and USDT while present for spam tokens, so
// as a spam signal it is worse than useless.
interface DuneTokenBalance {
  symbol: string;
  name: string;
  amount: string;
  decimals: number;
  price_usd: number | null;
  value_usd: number | null;
  address: string | null;
  chain?: string;
  chain_id?: number;
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

export interface BalanceWarning {
  walletAddress: string;
  chain: string;
  error: string;
}

export interface ProjectBalanceSummary {
  totalBalanceUsd: number;
  stablecoinsUsd: number;
  ethUsd: number;
  nativeTokenUsd: number;
  otherAssetsUsd: number;
  balancesDetail: WalletBalanceSummary[];
  warnings: BalanceWarning[];
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
    // `?? null` rather than a bare read: an absent key must persist as an
    // explicit null, not vanish from the stored JSON the way `undefined` does.
    contractAddress: b.address ?? null,
  }));

  const totalUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);
  // fetchWalletBalance is only ever called for EVM wallets — Solana routes
  // through fetchSolanaBalance in solana-sync.ts, which classifies natively
  // and never calls classifyTokens. So there is no native symbol to branch on
  // here beyond ETH/WETH.
  const classified = classifyTokens(duneData.balances, projectTokenSymbol);

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
  // allSettled: Solana (Helius) and EVM (Dune Sim) both can timeout or 5xx
  // independently. Failed wallet → warning, snapshot still has partial data
  // from the others.
  const settled = await Promise.allSettled(
    wallets.map((w) =>
      w.chain === "solana"
        ? fetchSolanaBalance(w.address)
        : fetchWalletBalance(w, projectTokenSymbol)
    )
  );

  const results: WalletBalanceSummary[] = [];
  const warnings: BalanceWarning[] = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") {
      results.push(res.value);
    } else {
      const w = wallets[i];
      warnings.push({
        walletAddress: w.address,
        chain: w.chain,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
      console.warn(`[balances] wallet ${w.address} (${w.chain}) failed:`, res.reason);
    }
  });

  const summary: ProjectBalanceSummary = {
    totalBalanceUsd: 0,
    stablecoinsUsd: 0,
    ethUsd: 0,
    nativeTokenUsd: 0,
    otherAssetsUsd: 0,
    balancesDetail: results,
    warnings,
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
    // Sim wraps data in `tokens[]` (one entry per chain queried). For our
    // single-chain query we always read tokens[0].
    const payload = (await res.json()) as {
      tokens?: Array<{
        price_usd?: number;
        total_supply?: string | number;
        fully_diluted_value?: number;
        decimals?: number;
      }>;
    };
    const data = payload.tokens?.[0];
    if (!data) return EMPTY_METRICS;

    // total_supply comes back as a raw integer string in base units; divide
    // by 10^decimals to get the human-readable circulating figure.
    const rawSupply =
      typeof data.total_supply === "string"
        ? parseFloat(data.total_supply)
        : typeof data.total_supply === "number"
          ? data.total_supply
          : null;
    const decimals = typeof data.decimals === "number" ? data.decimals : 0;
    const adjustedSupply =
      rawSupply !== null && Number.isFinite(rawSupply)
        ? rawSupply / Math.pow(10, decimals)
        : null;

    return {
      tokenPriceUsd: typeof data.price_usd === "number" ? data.price_usd : null,
      tokenMarketCapUsd:
        typeof data.fully_diluted_value === "number"
          ? data.fully_diluted_value
          : null,
      tokenCirculatingSupply: adjustedSupply,
      // Holders count requires paginating /token-holders — too expensive for
      // a monthly sync. Left null until we add a dedicated holder-count job.
      tokenHoldersCount: null,
    };
  } catch {
    return EMPTY_METRICS;
  }
}
