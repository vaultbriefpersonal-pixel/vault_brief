import { CHAINS } from "@/lib/chains";
import type { Wallet } from "@/server/db/schema";
import { fetchSolanaBalance } from "./solana-sync";
import {
  bucketsToLegacyColumns,
  composeTreasury,
  type LegacySnapshotColumns,
} from "./treasury-composition";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY!;
const ALCHEMY_PORTFOLIO_URL = `https://api.g.alchemy.com/data/v1/${ALCHEMY_API_KEY}/assets/tokens/by-address`;

/**
 * How many Portfolio API pages one wallet may consume before we stop and
 * disclose the truncation.
 *
 * PAGINATION IS NOT OPTIONAL HERE, and the cap is not cosmetic. Alchemy does
 * NOT order this response by value — verified against a real treasury
 * (0xFafd…71C1), whose entire $240K USDC position sat on page 2 behind 91
 * rows of dust and spam on page 1. Reading only the first page would have
 * reported that treasury as ~$95. Pages hold 100 rows, so 20 pages is 2,000
 * token positions — far past any real treasury, while still bounding a wallet
 * airdropped tens of thousands of spam contracts.
 *
 * Hitting the cap does NOT throw: the pages already read are real balances and
 * are kept. It raises a `BalanceWarning` instead, which `data-sync.ts` persists
 * into `treasury_snapshots.sync_warnings` — same "warn, never silently drop"
 * contract the transfer page cap in transfer-fetch-policy.ts follows.
 */
const MAX_BALANCE_PAGES = 20;

function alchemyNetworkFor(chain: string): string | null {
  const cfg = CHAINS[chain as keyof typeof CHAINS];
  return cfg?.alchemyNetwork ?? null;
}

// In-memory cache: key → { data, expiresAt }
const cache = new Map<string, { data: WalletTokenPage; expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * One row of Alchemy's Portfolio API `data.tokens[]`, as verified against a
 * live POST /data/v1/{key}/assets/tokens/by-address response.
 *
 * Shapes worth knowing, because each one silently corrupts a balance if
 * mishandled:
 *   • `tokenBalance` is a HEX string in base units, not a decimal string.
 *   • The NATIVE token (ETH/MATIC) arrives with `tokenAddress: null` AND an
 *     all-null `tokenMetadata` — no symbol, no decimals. Its identity has to
 *     be filled in from `CHAINS[chain]`, or every treasury's gas reserve reads
 *     as an unnamed 18-decimal unknown.
 *   • `tokenPrices` is an ARRAY (empty when unpriced), not a scalar field.
 *   • Zero-balance rows ARE returned, in bulk — one real wallet came back with
 *     151 rows of which exactly one had value. They are filtered out rather
 *     than stored, so `balances_detail` stays a treasury and not a spam log.
 */
export interface AlchemyTokenRow {
  address?: string;
  network?: string;
  tokenAddress: string | null;
  tokenBalance: string;
  tokenMetadata?: {
    symbol?: string | null;
    decimals?: number | null;
    name?: string | null;
  } | null;
  tokenPrices?: Array<{ currency?: string; value?: string }> | null;
}

interface WalletTokenPage {
  walletAddress: string;
  tokens: AlchemyTokenRow[];
  /** True when MAX_BALANCE_PAGES stopped the read before Alchemy ran out of pages. */
  truncated: boolean;
}

/** Every EVM native token this product supports is 18-decimal (ETH, MATIC). */
const NATIVE_TOKEN_DECIMALS = 18;

/**
 * Alchemy rows → the `TokenBalance[]` the rest of the pipeline already speaks.
 *
 * Pure and exported so the provider swap is testable without a network call —
 * same reasoning as `transaction-sample.ts` and `transfer-fetch-policy.ts`:
 * the HTTP plumbing is integration-verified, the value-mangling arithmetic is
 * unit-tested.
 */
export function mapAlchemyTokens(
  rows: AlchemyTokenRow[],
  chain: string
): TokenBalance[] {
  const nativeSymbol = CHAINS[chain as keyof typeof CHAINS]?.nativeToken ?? "";
  const out: TokenBalance[] = [];

  for (const row of rows) {
    const isNative = row.tokenAddress == null;
    const decimals = isNative
      ? NATIVE_TOKEN_DECIMALS
      : (row.tokenMetadata?.decimals ?? NATIVE_TOKEN_DECIMALS);

    let amount: number;
    try {
      amount = Number(BigInt(row.tokenBalance)) / Math.pow(10, decimals);
    } catch {
      // A malformed hex string is one token's problem, never the wallet's.
      continue;
    }
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const usd = row.tokenPrices?.find(
      (p) => (p.currency ?? "usd").toLowerCase() === "usd"
    );
    const priceUsd = usd?.value ? Number(usd.value) : 0;
    const safePrice = Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : 0;

    out.push({
      symbol: isNative ? nativeSymbol : (row.tokenMetadata?.symbol ?? ""),
      name: isNative ? nativeSymbol : (row.tokenMetadata?.name ?? ""),
      amount,
      priceUsd: safePrice,
      // Computed, not read back from the provider: Alchemy returns no
      // value_usd, and deriving it here keeps amount × price consistent with
      // the figures every downstream section quotes.
      valueUsd: amount * safePrice,
      // `?? null` rather than a bare read: an absent key must persist as an
      // explicit null, not vanish from the stored JSON the way `undefined` does.
      // Contract-first identity matching (treasury-liquidity.ts,
      // defi-positions.ts, treasury-attribution.ts) depends on this surviving.
      contractAddress: row.tokenAddress ?? null,
    });
  }

  return out;
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
  /**
   * Set only when the balance read stopped at `MAX_BALANCE_PAGES` with pages
   * still outstanding — the figures above are then a floor, not a total.
   * `fetchAllBalances` turns this into a `BalanceWarning`; absent on every
   * normal read and on the Solana path, which does not paginate.
   */
  truncated?: boolean;
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

/**
 * Every token page for one wallet on one chain, from Alchemy's Portfolio API.
 *
 * REPLACES DUNE SIM, which was sunset on 2026-08-01 and answers every request
 * with HTTP 410. Because `fetchAllBalances` turns a thrown wallet into a
 * warning and keeps going, that failure was survivable-by-design and therefore
 * invisible: snapshots kept being written with `total_balance_usd = 0.00` and
 * an empty `balances_detail`, and the report — correctly, given its inputs —
 * said the runway was NOT COMPUTABLE. Confirmed on a live project whose real
 * treasury was ~$835K.
 */
async function fetchAlchemyBalances(
  address: string,
  chain: string
): Promise<WalletTokenPage> {
  // Solana balances go through solana-sync (Helius); this path is EVM-only.
  if (chain === "solana") {
    throw new Error("solana balances must go through solana-sync");
  }

  const network = alchemyNetworkFor(chain);
  if (!network) {
    throw new Error(`No Alchemy network configured for chain '${chain}'`);
  }

  const cacheKey = `${address}:${chain}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const tokens: AlchemyTokenRow[] = [];
  let pageKey: string | undefined;
  let pages = 0;
  let truncated = false;

  do {
    const res = await fetch(ALCHEMY_PORTFOLIO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addresses: [{ address, networks: [network] }],
        withMetadata: true,
        withPrices: true,
        includeNativeTokens: true,
        ...(pageKey ? { pageKey } : {}),
      }),
    });

    if (!res.ok) {
      // A wallet Alchemy has never seen is an empty treasury, not an outage.
      if (res.status === 404) break;
      throw new Error(`Alchemy balances error: ${res.status} ${await res.text()}`);
    }

    const payload = (await res.json()) as {
      data?: { tokens?: AlchemyTokenRow[]; pageKey?: string | null };
    };
    tokens.push(...(payload.data?.tokens ?? []));
    pageKey = payload.data?.pageKey ?? undefined;
    pages++;

    if (pageKey && pages >= MAX_BALANCE_PAGES) {
      truncated = true;
      break;
    }
  } while (pageKey);

  const page: WalletTokenPage = { walletAddress: address, tokens, truncated };
  cache.set(cacheKey, { data: page, expiresAt: Date.now() + CACHE_TTL_MS });
  return page;
}

/**
 * The four frozen snapshot columns, computed through the ONE shared classifier
 * in treasury-composition.ts.
 *
 * This used to be a second, independent, symbol-only implementation of "what
 * kind of asset is this?", and the report read its output (the frozen columns)
 * for the donut and the Treasury Overview table while reading
 * `analyzeTreasuryLiquidity`'s output for every sentence of prose. When
 * `projects.token_symbol` was NULL at sync time, this function froze
 * `native_token_usd` at $0.00 and swept a $1.06B own-token position into
 * `other_assets_usd` — so the donut said "Other 100.0%" underneath prose that
 * had the split right. One predicate, one answer, forever.
 *
 * THESE COLUMNS ARE NOW A WRITE-ONLY CACHE. Nothing report-facing reads them:
 * the PDF donut, the email donut, the report widget strip and the Treasury
 * Overview section all call `composeTreasury` at read time, which means a plain
 * regenerate repairs every snapshot already in the database. The columns are
 * still written because the project dashboard tiles, `anomalies.ts` and the
 * historical treasury charts read them straight off the row.
 *
 * Takes the already-mapped `TokenBalance[]` rather than the raw
 * `DuneTokenBalance[]`, because that is the shape `composeTreasury` consumes
 * everywhere else (it is what gets stored in `balances_detail`). Adapting at
 * the one call site beats teaching the shared classifier a second input shape.
 */
function classifyTokens(
  chain: string,
  tokens: TokenBalance[],
  projectTokenSymbol?: string | null
): LegacySnapshotColumns {
  return bucketsToLegacyColumns(
    composeTreasury([{ chain, tokens }], { tokenSymbol: projectTokenSymbol })
  );
}

export async function fetchWalletBalance(
  wallet: Wallet,
  projectTokenSymbol?: string | null
): Promise<WalletBalanceSummary> {
  const page = await fetchAlchemyBalances(wallet.address, wallet.chain);
  const tokens = mapAlchemyTokens(page.tokens, wallet.chain);

  const totalUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);
  // fetchWalletBalance is only ever called for EVM wallets — Solana routes
  // through fetchSolanaBalance in solana-sync.ts, which classifies natively
  // and never calls classifyTokens.
  //
  // The wallet's chain is passed through now: the shared classifier recognises
  // `CHAINS[chain].nativeToken`, which is what stops a Polygon treasury's MATIC
  // gas reserve reading as an unrecognised illiquid asset. `totalUsd` above
  // still sums every holding, while the four columns below sum only priced,
  // positive ones — so a corrupt negative value would show up as a gap between
  // them rather than being quietly absorbed into a bucket.
  const classified = classifyTokens(wallet.chain, tokens, projectTokenSymbol);

  return {
    walletAddress: wallet.address,
    chain: wallet.chain,
    tokens,
    totalUsd,
    ...classified,
    ...(page.truncated ? { truncated: true } : {}),
  };
}

export async function fetchAllBalances(
  wallets: Wallet[],
  projectTokenSymbol?: string | null
): Promise<ProjectBalanceSummary> {
  // allSettled: Solana (Helius) and EVM (Alchemy) both can timeout or 5xx
  // independently. Failed wallet → warning, snapshot still has partial data
  // from the others.
  //
  // NOTE the failure mode this politeness enabled once already: when the old
  // EVM provider was sunset and started 410-ing every request, ALL wallets
  // landed here as warnings and the snapshot was written with a $0 treasury
  // rather than failing. The warnings were recorded faithfully in
  // `sync_warnings` — and nothing read them. Anything triaging balance health
  // should start from that column.
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
      // Succeeded, but only partly. Kept in `results` (the balances read are
      // real) AND warned about, so the figure is never presented as a total.
      if (res.value.truncated) {
        const w = wallets[i];
        warnings.push({
          walletAddress: w.address,
          chain: w.chain,
          error: `Balance read stopped at the ${MAX_BALANCE_PAGES}-page cap — this wallet's holdings are a floor, not a complete total.`,
        });
      }
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

/** `totalSupply()` and `decimals()` — ERC-20 selectors, for `eth_call`. */
const SELECTOR_TOTAL_SUPPLY = "0x18160ddd";
const SELECTOR_DECIMALS = "0x313ce567";

async function ethCallUint(
  rpcUrl: string,
  to: string,
  data: string
): Promise<bigint | null> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { result?: string };
  if (!json.result || json.result === "0x") return null;
  try {
    return BigInt(json.result);
  } catch {
    return null;
  }
}

/**
 * Price, supply and FDV for the project's OWN token.
 *
 * Also migrated off the sunset Dune Sim `token-info` endpoint, which returned
 * all three in one call. Alchemy has no equivalent single endpoint, so this
 * composes two sources it does have: the Prices API for USD price, and two
 * plain `eth_call`s (`totalSupply()`, `decimals()`) against the chain's own
 * RPC — which is authoritative for supply in a way a provider index is not.
 *
 * FDV is then computed here rather than read from a provider. That is a real
 * definitional change worth stating: Dune returned its own
 * `fully_diluted_value`, this returns `price × totalSupply`. For a token whose
 * circulating supply is below total supply the two can differ, so the column
 * keeps its documented meaning — fully diluted, not circulating market cap.
 *
 * Still returns EMPTY_METRICS on any failure: token metrics are a nice-to-have
 * section, and a missing price must never take down a treasury sync.
 */
export async function fetchTokenMetrics(
  tokenContract: string,
  chain: string
): Promise<TokenMetrics> {
  const cfg = CHAINS[chain as keyof typeof CHAINS];
  const network = alchemyNetworkFor(chain);
  if (!network || !cfg?.rpcUrl) return EMPTY_METRICS; // SVM/unknown chains handled elsewhere.

  try {
    const [priceRes, rawSupply, rawDecimals] = await Promise.all([
      fetch(
        `https://api.g.alchemy.com/prices/v1/${ALCHEMY_API_KEY}/tokens/by-address`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            addresses: [{ network, address: tokenContract }],
          }),
        }
      ),
      ethCallUint(cfg.rpcUrl, tokenContract, SELECTOR_TOTAL_SUPPLY),
      ethCallUint(cfg.rpcUrl, tokenContract, SELECTOR_DECIMALS),
    ]);

    let tokenPriceUsd: number | null = null;
    if (priceRes.ok) {
      const payload = (await priceRes.json()) as {
        data?: Array<{ prices?: Array<{ currency?: string; value?: string }> }>;
      };
      const usd = payload.data?.[0]?.prices?.find(
        (p) => (p.currency ?? "usd").toLowerCase() === "usd"
      );
      const parsed = usd?.value ? Number(usd.value) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) tokenPriceUsd = parsed;
    }

    // A token reporting absurd decimals is malformed, not a 10^255 supply.
    const decimalsNum = rawDecimals !== null ? Number(rawDecimals) : null;
    const decimals =
      decimalsNum !== null && decimalsNum >= 0 && decimalsNum <= 36
        ? decimalsNum
        : null;
    const supply =
      rawSupply !== null && decimals !== null
        ? Number(rawSupply) / Math.pow(10, decimals)
        : null;
    const tokenCirculatingSupply =
      supply !== null && Number.isFinite(supply) ? supply : null;

    return {
      tokenPriceUsd,
      tokenMarketCapUsd:
        tokenPriceUsd !== null && tokenCirculatingSupply !== null
          ? tokenPriceUsd * tokenCirculatingSupply
          : null,
      tokenCirculatingSupply,
      // Holders count needs a dedicated indexed source; no cheap Alchemy
      // equivalent. Left null exactly as before, so nothing regressed here.
      tokenHoldersCount: null,
    };
  } catch {
    return EMPTY_METRICS;
  }
}
