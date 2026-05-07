/**
 * Pull project metadata from public crypto data sources.
 *
 * Lookup chain:
 *   1. CoinGecko `/coins/{platform}/contract/{address}` — primary source.
 *      Free tier, no key, ~30 req/min globally. Most listed tokens hit
 *      here.
 *   2. CoinMarketCap `/v1/cryptocurrency/info?address=…` — fallback when
 *      CG returns null. Requires `COINMARKETCAP_API_KEY` env (free Basic
 *      plan: 333 calls/day). Skipped silently when the key is absent.
 *
 * Every error path returns null / undefined for that field — the caller
 * always falls through to manual entry. We never block the form on a
 * third-party hiccup.
 *
 * Why funding-round autofill is NOT here:
 *   - DefiLlama paywalled `/raises` (the all-projects funding feed).
 *   - DefiLlama `/protocol/{slug}` is free but returns the full TVL
 *     history per project — practical response time can run 30s+ for
 *     established projects, which we can't sit on inside an autofill
 *     click. A separate background-enriched flow would be the right
 *     home for funding data; not in scope for this form.
 *   - CG/CMC don't expose structured funding data.
 *   - Founders fill the funding fields manually for now.
 */

const COINGECKO_PLATFORMS: Record<string, string> = {
  ethereum: "ethereum",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
  base: "base",
  optimism: "optimistic-ethereum",
  solana: "solana",
};

// CMC uses different platform slugs. Their `address` lookup needs the
// platform implicit in the contract format, but they accept queries
// without it on Pro tier; on Basic we filter the response by chain.
const COINMARKETCAP_PLATFORMS: Record<string, string> = {
  ethereum: "Ethereum",
  polygon: "Polygon",
  arbitrum: "Arbitrum",
  base: "Base",
  optimism: "Optimism",
  solana: "Solana",
};

export interface ProjectAutofillResult {
  name?: string;
  symbol?: string;
  description?: string;
  website?: string;
  githubOrg?: string;
  foundedDate?: string; // YYYY-MM-DD
  category?: string;
  /** Where the metadata came from — surfaced in the form's "Prefilled
   *  from X" note so the user can sanity-check accuracy. */
  source: "coingecko" | "coinmarketcap";
}

// ─── CoinGecko ────────────────────────────────────────────────────────

interface CoinGeckoCoin {
  name?: string;
  symbol?: string;
  description?: { en?: string };
  links?: {
    homepage?: string[];
    repos_url?: { github?: string[] };
  };
  genesis_date?: string | null;
  categories?: (string | null)[];
}

async function fetchFromCoinGecko(args: {
  chain: string;
  contract: string;
}): Promise<ProjectAutofillResult | null> {
  const platform = COINGECKO_PLATFORMS[args.chain];
  if (!platform) return null;

  const normalized =
    args.chain === "solana" ? args.contract : args.contract.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${encodeURIComponent(normalized)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let data: CoinGeckoCoin;
  try {
    data = (await res.json()) as CoinGeckoCoin;
  } catch {
    return null;
  }

  const descRaw = data.description?.en?.trim();
  const description = descRaw ? cleanDescription(descRaw) : undefined;

  const homepage = data.links?.homepage?.find(
    (h) => typeof h === "string" && h.trim().length > 0
  );
  const repoUrl = data.links?.repos_url?.github?.find(
    (r) => typeof r === "string" && r.trim().length > 0
  );
  const githubOrg = repoUrl ? parseGithubOrg(repoUrl) : undefined;
  const category = data.categories?.find(
    (c): c is string => typeof c === "string" && c.trim().length > 0
  );

  return {
    name: data.name?.trim() || undefined,
    symbol: data.symbol ? data.symbol.toUpperCase() : undefined,
    description: description || undefined,
    website: homepage?.trim() || undefined,
    githubOrg,
    foundedDate: data.genesis_date || undefined,
    category,
    source: "coingecko",
  };
}

// ─── CoinMarketCap fallback ───────────────────────────────────────────

interface CmcInfoEntry {
  name?: string;
  symbol?: string;
  description?: string;
  category?: string;
  date_added?: string;
  urls?: {
    website?: string[];
    source_code?: string[];
  };
  platform?: { name?: string } | null;
}

interface CmcInfoResponse {
  data?: Record<string, CmcInfoEntry | CmcInfoEntry[]>;
}

async function fetchFromCoinMarketCap(args: {
  chain: string;
  contract: string;
}): Promise<ProjectAutofillResult | null> {
  const apiKey = process.env.COINMARKETCAP_API_KEY;
  if (!apiKey) return null; // silent skip when not configured

  const platformName = COINMARKETCAP_PLATFORMS[args.chain];

  const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/info?address=${encodeURIComponent(args.contract.trim())}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-CMC_PRO_API_KEY": apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let body: CmcInfoResponse;
  try {
    body = (await res.json()) as CmcInfoResponse;
  } catch {
    return null;
  }

  // CMC returns `data` as an object keyed by either symbol or contract
  // address depending on plan tier. Walk the values, prefer entries
  // matching our chain when more than one comes back.
  const entries: CmcInfoEntry[] = Object.values(body.data ?? {})
    .flat()
    .filter((v): v is CmcInfoEntry => Boolean(v));

  if (entries.length === 0) return null;

  const matched = platformName
    ? entries.find((e) => e.platform?.name === platformName) ?? entries[0]
    : entries[0];

  const description = matched.description
    ? cleanDescription(matched.description)
    : undefined;
  const website = matched.urls?.website?.find(
    (u) => typeof u === "string" && u.trim().length > 0
  );
  const repoUrl = matched.urls?.source_code?.find(
    (u) => typeof u === "string" && u.trim().length > 0
  );
  const githubOrg = repoUrl ? parseGithubOrg(repoUrl) : undefined;

  // CMC `date_added` is ISO-8601 timestamp; reduce to YYYY-MM-DD.
  const foundedDate = matched.date_added
    ? matched.date_added.slice(0, 10)
    : undefined;

  return {
    name: matched.name?.trim() || undefined,
    symbol: matched.symbol ? matched.symbol.toUpperCase() : undefined,
    description,
    website: website?.trim(),
    githubOrg,
    foundedDate,
    category: matched.category?.trim() || undefined,
    source: "coinmarketcap",
  };
}

// ─── shared helpers ───────────────────────────────────────────────────

function cleanDescription(raw: string): string {
  const noLinks = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const noHtml = noLinks.replace(/<[^>]+>/g, "");
  const collapsed = noHtml.replace(/\s+/g, " ").trim();
  return collapsed.length > 500 ? `${collapsed.slice(0, 497)}…` : collapsed;
}

function parseGithubOrg(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return undefined;
    const seg = u.pathname.split("/").filter(Boolean);
    return seg[0] || undefined;
  } catch {
    return undefined;
  }
}

// ─── public entrypoint ────────────────────────────────────────────────

export async function fetchTokenMetadata(args: {
  chain: string;
  contract: string;
}): Promise<ProjectAutofillResult | null> {
  const contract = args.contract.trim();
  if (!contract) return null;

  // 1. CoinGecko (primary)
  let result = await fetchFromCoinGecko({ chain: args.chain, contract });

  // 2. CoinMarketCap fallback when CG misses entirely
  if (!result) {
    result = await fetchFromCoinMarketCap({ chain: args.chain, contract });
  }

  return result;
}
