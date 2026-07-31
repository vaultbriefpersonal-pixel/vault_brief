// The three judgement calls in fetching transfer history, extracted so they
// can be unit-tested without a network.
//
// transaction-sync.ts does the fetching and cannot be tested at all — it
// reaches Alchemy, Helius and a price feed. The decisions ABOUT that fetching
// are pure, and they are the parts that were wrong: which transfer categories
// to ask for, when a paginated fetch has gone on long enough, and how large a
// single transfer may be before it is treated as poisoned. Same reasoning that
// put the sampling rule in transaction-sample.ts.
//
// Why this matters more than it looks: historical balance reconstruction walks
// balances BACKWARDS through this transfer history. An incomplete history does
// not produce an error, it produces a wrong opening balance — silently, with
// nothing anywhere to indicate the number is wrong. Every rule here exists to
// make incompleteness either impossible or loudly disclosed.
//
// Deliberately dependency-free: no `@/server/db`, no `openai`, no `node:*`,
// no `process.env`.

/**
 * Transfer categories to request per chain.
 *
 * `internal` — transfers initiated by a contract rather than an EOA — is the
 * one that matters here, and it is NOT universally available. Alchemy's
 * documentation is explicit: *"'internal' category is not supported on Base,
 * it is only available on Ethereum Mainnet and Polygon Mainnet."*
 *
 * Asking for it on a chain that does not support it risks failing the whole
 * request, which would take that chain's transfers from incomplete to absent.
 * So the map is conservative and per-chain rather than one global array.
 *
 * The cost of omitting it where it IS supported is severe and was measured:
 * most DAO treasuries are contracts, so contract-initiated outflows are
 * invisible without it. On the Uniswap Governance Timelock the all-time
 * outgoing count is 63 with `internal` and 47 without — a quarter of the
 * treasury's spending history simply missing.
 */
const CHAIN_TRANSFER_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  ethereum: ["external", "internal", "erc20"],
  polygon: ["external", "internal", "erc20"],
  // Alchemy documents `internal` as unsupported on Base, and scopes internal
  // transfer data to Ethereum and Polygon mainnet — so the L2s below ask for
  // what they can actually serve.
  arbitrum: ["external", "erc20"],
  base: ["external", "erc20"],
  optimism: ["external", "erc20"],
};

/** What an unknown chain gets: the subset every EVM network serves. */
export const DEFAULT_TRANSFER_CATEGORIES: readonly string[] = [
  "external",
  "erc20",
];

export function transferCategoriesFor(chain: string): string[] {
  return [...(CHAIN_TRANSFER_CATEGORIES[chain] ?? DEFAULT_TRANSFER_CATEGORIES)];
}

/** True when this chain's category list includes contract-initiated transfers. */
export function supportsInternalTransfers(chain: string): boolean {
  return transferCategoriesFor(chain).includes("internal");
}

/**
 * Alchemy's own per-page maximum, and what we ask for. Stated in hex because
 * that is what the JSON-RPC parameter takes.
 */
export const TRANSFERS_PER_PAGE_HEX = "0x3e8"; // 1000

/**
 * How many pages a single (wallet, direction, period) fetch may walk.
 *
 * 20 pages is 20,000 transfer legs for one wallet in one period — far beyond
 * any real treasury month, and chosen so the cap is effectively unreachable in
 * normal operation while still bounding a pathological address (an airdrop
 * farm, a spam magnet) that would otherwise page forever and hang the sync.
 *
 * Hitting it is TRUNCATION and must be disclosed, never absorbed: a truncated
 * history is exactly the silent-wrong-number case this module exists to stop.
 */
export const MAX_TRANSFER_PAGES = 20;

/**
 * Floor for the per-transfer sanity cap.
 *
 * The cap exists because scam airdrops spoof real tickers: a fake "USDC" with
 * a trillion-unit supply prices off the real USDC feed and blows period totals
 * into the trillions. Better to miss one real whale transfer than to publish a
 * fabricated quintillion.
 */
export const MIN_MAX_REASONABLE_TX_USD = 50_000_000;

/** Share of the treasury a single transfer may reach before it looks poisoned. */
export const MAX_TX_TREASURY_FRACTION = 0.25;

/**
 * The largest USD value a single transfer may carry before it is treated as
 * mispriced.
 *
 * A FLAT $50M ceiling was wrong in one direction only, and expensively: on a
 * $1.06B treasury a real $60M transfer was silently zeroed and dropped out of
 * burn. Scaling by a quarter of the treasury keeps the scam-token defence
 * (a spoofed ticker prices orders of magnitude above any real holding) while
 * letting a large treasury report its own large movements.
 *
 * The floor still applies, so a small or unknown treasury keeps the original
 * behaviour rather than gaining a cap of nearly zero — with a $1M treasury,
 * `0.25 * total` would be $250K and would zero perfectly ordinary transfers.
 * A missing, zero or non-finite balance falls back to the floor for the same
 * reason.
 */
export function maxReasonableTxUsd(totalBalanceUsd: number): number {
  const total = Number(totalBalanceUsd);
  if (!Number.isFinite(total) || total <= 0) return MIN_MAX_REASONABLE_TX_USD;
  return Math.max(MIN_MAX_REASONABLE_TX_USD, total * MAX_TX_TREASURY_FRACTION);
}
