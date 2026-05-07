/**
 * Pull project metadata from CoinGecko by token contract address.
 *
 * Single source for now (CoinGecko free tier — no key, ~30 req/min globally).
 * Future: fall back to CoinMarketCap when the token isn't on CG, and
 * DefiLlama /raises for funding round data.
 *
 * The endpoint we hit is documented at:
 *   https://docs.coingecko.com/reference/coins-contract-address
 *
 * We deliberately return null on every error path (404, 429, network) and
 * let the caller decide how to surface the failure to the user — the form
 * stays usable even when CG is down.
 */

// Maps our internal chain identifiers to CoinGecko platform IDs.
// Keep in sync with TOKEN_CHAINS in projects/new/page.tsx.
const COINGECKO_PLATFORMS: Record<string, string> = {
  ethereum: "ethereum",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
  base: "base",
  optimism: "optimistic-ethereum",
  solana: "solana",
};

export interface ProjectAutofillResult {
  name?: string;
  symbol?: string;
  description?: string;
  website?: string;
  githubOrg?: string;
  foundedDate?: string; // YYYY-MM-DD
  category?: string;
  source: "coingecko";
}

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

/**
 * Strip Markdown links and HTML out of CoinGecko's description.en (it
 * sometimes contains both) and trim to ~500 chars to match our DB column.
 */
function cleanDescription(raw: string): string {
  const noLinks = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const noHtml = noLinks.replace(/<[^>]+>/g, "");
  const collapsed = noHtml.replace(/\s+/g, " ").trim();
  return collapsed.length > 500 ? `${collapsed.slice(0, 497)}…` : collapsed;
}

/**
 * Parse "https://github.com/foo" or "https://github.com/foo/bar" → "foo".
 * Returns undefined for anything that doesn't look like a github org URL.
 */
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

export async function fetchTokenMetadata(args: {
  chain: string;
  contract: string;
}): Promise<ProjectAutofillResult | null> {
  const platform = COINGECKO_PLATFORMS[args.chain];
  if (!platform) return null;

  const contract = args.contract.trim();
  if (!contract) return null;

  // CoinGecko's contract endpoint is case-sensitive on Solana mints but
  // not on EVM addresses; lowercasing on EVM is safe and matches their
  // internal storage. Solana addresses are base58 so we keep them as-is.
  const normalized =
    args.chain === "solana" ? contract : contract.toLowerCase();

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
