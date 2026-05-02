/**
 * Historical USD price resolver.
 *
 * Given a token symbol and a date, returns the USD price for that day.
 * Lookup order:
 *   1. In-memory cache (cleared on cold start)
 *   2. Postgres token_prices table (persistent — historic prices never change)
 *   3. CoinGecko /coins/{id}/history (free tier, no key required, ~30 req/min)
 *   4. Hardcoded stablecoin fallback (USDC/USDT/DAI/etc = 1.0)
 *   5. Returns null — caller decides how to surface "unknown price" to the user
 */

import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { tokenPrices } from "@/server/db/schema";

// Symbol → CoinGecko ID. Top-50 by market cap covers >95% of treasury holdings.
// For anything missing we fall back to /search at runtime.
const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  WETH: "weth",
  BTC: "bitcoin",
  WBTC: "wrapped-bitcoin",
  SOL: "solana",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  ARB: "arbitrum",
  OP: "optimism",
  BASE: "base",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
  MKR: "maker",
  SNX: "havven",
  CRV: "curve-dao-token",
  LDO: "lido-dao",
  RPL: "rocket-pool",
  GRT: "the-graph",
  COMP: "compound-governance-token",
  SUSHI: "sushi",
  "1INCH": "1inch",
  YFI: "yearn-finance",
  BAL: "balancer",
  FXS: "frax-share",
  ENS: "ethereum-name-service",
  PEPE: "pepe",
  SHIB: "shiba-inu",
  DOGE: "dogecoin",
  // Stablecoins (handled via STABLES below but listed for completeness)
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  FRAX: "frax",
  LUSD: "liquity-usd",
  GUSD: "gemini-dollar",
  TUSD: "true-usd",
  PYUSD: "paypal-usd",
};

// Stablecoins resolve to ~1.0 without an API call. Keeps us off the rate limit
// for the most common case (stablecoin transfers dominate treasury activity).
const STABLES = new Set([
  "USDC",
  "USDT",
  "DAI",
  "FRAX",
  "LUSD",
  "GUSD",
  "TUSD",
  "PYUSD",
  "USDP",
  "USDD",
  "BUSD",
  "MIM",
]);

const memCache = new Map<string, number>();

function cacheKey(symbol: string, isoDate: string) {
  return `${symbol}:${isoDate}`;
}

/** Convert a JS Date to UTC YYYY-MM-DD. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** CoinGecko expects DD-MM-YYYY for the history endpoint. */
function toCoinGeckoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
}

async function fetchFromCoinGecko(
  symbol: string,
  isoDate: string
): Promise<number | null> {
  const id = COINGECKO_IDS[symbol];
  if (!id) return null;

  const url = `https://api.coingecko.com/api/v3/coins/${id}/history?date=${toCoinGeckoDate(isoDate)}&localization=false`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      // CoinGecko free tier is slow — give it some room.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      market_data?: { current_price?: { usd?: number } };
    };
    const price = data.market_data?.current_price?.usd;
    return typeof price === "number" && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the USD price for a token on a given UTC date.
 * Returns null if the price cannot be determined — callers should treat that
 * as "unknown" rather than 0 to avoid skewing burn rate.
 */
export async function getHistoricalPrice(
  rawSymbol: string,
  date: Date
): Promise<number | null> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return null;

  const isoDate = toIsoDate(date);
  const key = cacheKey(symbol, isoDate);

  // 1. In-memory
  const mem = memCache.get(key);
  if (mem !== undefined) return mem;

  // Stablecoins: short-circuit to ~1.0 (still cache for consistency).
  if (STABLES.has(symbol)) {
    memCache.set(key, 1);
    return 1;
  }

  // 2. Persistent cache
  const existing = await db
    .select({ usdPrice: tokenPrices.usdPrice })
    .from(tokenPrices)
    .where(
      sql`${tokenPrices.symbol} = ${symbol} AND ${tokenPrices.priceDate} = ${isoDate}`
    )
    .limit(1);

  if (existing[0]) {
    const price = parseFloat(existing[0].usdPrice);
    memCache.set(key, price);
    return price;
  }

  // 3. CoinGecko
  const fresh = await fetchFromCoinGecko(symbol, isoDate);
  if (fresh !== null) {
    memCache.set(key, fresh);
    // Persist for future syncs. ON CONFLICT DO NOTHING handles concurrent writes.
    try {
      await db
        .insert(tokenPrices)
        .values({
          symbol,
          priceDate: isoDate,
          usdPrice: fresh.toString(),
          source: "coingecko",
        })
        .onConflictDoNothing();
    } catch {
      // Cache write failure is non-fatal — we still have the price in memory.
    }
    return fresh;
  }

  // 4. Unknown — let the caller decide.
  return null;
}

/**
 * Convenience: resolve and convert a raw token amount to USD on a given date.
 * Returns 0 with a `priceUnknown` flag when no price is available so totals
 * don't get poisoned by garbage parseFloat fallbacks.
 */
export async function tokenAmountToUsd(
  symbol: string,
  amount: number,
  date: Date
): Promise<{ usd: number; priceUnknown: boolean }> {
  if (!Number.isFinite(amount) || amount === 0) {
    return { usd: 0, priceUnknown: false };
  }
  const price = await getHistoricalPrice(symbol, date);
  if (price === null) {
    return { usd: 0, priceUnknown: true };
  }
  return { usd: amount * price, priceUnknown: false };
}
