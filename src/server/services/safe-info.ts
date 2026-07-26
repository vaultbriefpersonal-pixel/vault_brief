import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { wallets } from "@/server/db/schema";

/**
 * Reads a Gnosis Safe's signer count + threshold directly on-chain via
 * `eth_call` (no new SDK dependency — the two functions we need
 * (`getOwners()`, `getThreshold()`) take no arguments, so the calldata is
 * just the 4-byte selector; decoding only needs the array-length word and
 * a uint256, not a full ABI decoder).
 *
 * Why live, not cached: this is a small, infrequent read (only wallets
 * explicitly tagged `walletType: "gnosis_safe"`, typically one or two per
 * project) and signer sets change rarely. Caching would mean a new column
 * on `wallets` — a schema migration (Forbidden Area) for a feature this
 * small isn't worth the approval overhead. Fails open everywhere: a
 * timeout, a non-Safe address, or a missing API key all just mean this
 * wallet is silently omitted from the result, never a broken page.
 */

export interface SafeInfo {
  walletId: string;
  chain: string;
  address: string;
  label: string | null;
  ownerCount: number;
  threshold: number;
  /** Undefined when the Safe Transaction Service call failed/timed out —
   * distinct from 0, which means "we checked, nothing pending". */
  pendingCount?: number;
  oldestPendingDate?: string | null;
}

// Matches chains.ts's EVM entries (deliberately not importing that file —
// its `rpcUrl` field is unused elsewhere and one entry uses the
// deprecated eth-mainnet.alchemyapi.io domain; scoping our own map here
// avoids depending on that latent issue rather than fixing it as a
// drive-by in an unrelated task).
const ALCHEMY_SUBDOMAIN: Record<string, string> = {
  ethereum: "eth-mainnet",
  polygon: "polygon-mainnet",
  arbitrum: "arb-mainnet",
  base: "base-mainnet",
  optimism: "opt-mainnet",
};

// Exported for unit tests (safe-info.test.ts) — otherwise internal.
export function rpcUrlFor(chain: string): string | null {
  const sub = ALCHEMY_SUBDOMAIN[chain];
  const key = process.env.ALCHEMY_API_KEY;
  if (!sub || !key) return null; // solana (no Safe concept) or no key configured
  return `https://${sub}.g.alchemy.com/v2/${key}`;
}

// Safe{Wallet} (formerly Gnosis Safe) core ABI, zero-argument view functions.
const SELECTOR_GET_OWNERS = "0xa0e67e2b"; // getOwners() returns (address[])
const SELECTOR_GET_THRESHOLD = "0xe75235b8"; // getThreshold() returns (uint256)

const RPC_TIMEOUT_MS = 4000;

// Safe's own hosted Transaction Service — a separate off-chain API, not an
// RPC. Pending/queued transactions live here (proposed but not yet
// executed), not on-chain, so `eth_call` can't see them at all. Same
// chain coverage as ALCHEMY_SUBDOMAIN above.
const SAFE_TX_SERVICE_SUBDOMAIN: Record<string, string> = {
  ethereum: "mainnet",
  polygon: "polygon",
  arbitrum: "arbitrum",
  base: "base",
  optimism: "optimism",
};

function safeTxServiceUrlFor(chain: string): string | null {
  const sub = SAFE_TX_SERVICE_SUBDOMAIN[chain];
  return sub ? `https://safe-transaction-${sub}.safe.global` : null;
}

const SAFE_TX_SERVICE_TIMEOUT_MS = 4000;

export interface SafePendingInfo {
  pendingCount: number;
  /** ISO timestamp of the oldest not-yet-executed transaction, or null
   * when pendingCount is 0. */
  oldestPendingDate: string | null;
}

interface MultisigTxListResponse {
  count?: number;
  results?: Array<{ submissionDate?: string }>;
}

/**
 * Count of not-yet-executed transactions awaiting signatures, plus the
 * oldest one's submission date. Deliberately does NOT fetch full
 * transaction details/calldata — a reporting tool has no reason to
 * render what a pending transfer actually does, just that founders and
 * investors can see signatures are outstanding. `ordering=submissionDate`
 * + `limit=1` gets both the total count and the oldest row in one request.
 */
export async function getSafePendingInfo(
  address: string,
  chain: string
): Promise<SafePendingInfo | null> {
  const base = safeTxServiceUrlFor(chain);
  if (!base) return null;

  try {
    const url = `${base}/api/v1/safes/${address}/multisig-transactions/?executed=false&ordering=submissionDate&limit=1`;
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(SAFE_TX_SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as MultisigTxListResponse;
    const pendingCount = json.count ?? 0;
    return {
      pendingCount,
      oldestPendingDate:
        pendingCount > 0 ? (json.results?.[0]?.submissionDate ?? null) : null,
    };
  } catch {
    // Outage of Safe's hosted service must never break the report — this
    // is a "nice to have" addition to an already-successful owners/
    // threshold read, not something the page depends on.
    return null;
  }
}

async function ethCall(
  rpcUrl: string,
  to: string,
  data: string
): Promise<string | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string; error?: unknown };
    if (json.error || !json.result) return null;
    return json.result;
  } catch {
    // Timeout, network error, non-contract address (empty `0x` result
    // still parses below and gets rejected by the sanity check) — all
    // fail open.
    return null;
  }
}

// `getOwners()` returns a dynamic `address[]`, ABI-encoded as
// [offset(32B)][length(32B)][elements...]. We only need the count, so
// just read the length word — no need to decode individual addresses.
// Exported for unit tests.
export function decodeArrayLength(hex: string): number {
  const body = hex.slice(2);
  const lengthHex = "0x" + body.slice(64, 128);
  return Number(BigInt(lengthHex));
}

export function decodeUint256(hex: string): number {
  return Number(BigInt(hex));
}

/** Single-wallet lookup. Returns null for anything that isn't a
 * reachable Safe contract — non-Safe address, wrong chain, RPC
 * unavailable, decode failure. */
export async function getSafeInfo(
  address: string,
  chain: string
): Promise<{ ownerCount: number; threshold: number } | null> {
  const rpcUrl = rpcUrlFor(chain);
  if (!rpcUrl) return null;

  const [ownersResult, thresholdResult] = await Promise.all([
    ethCall(rpcUrl, address, SELECTOR_GET_OWNERS),
    ethCall(rpcUrl, address, SELECTOR_GET_THRESHOLD),
  ]);
  if (!ownersResult || !thresholdResult) return null;

  try {
    const ownerCount = decodeArrayLength(ownersResult);
    const threshold = decodeUint256(thresholdResult);
    // Sanity guard — a real Safe always has >=1 owner and threshold >=1.
    // Catches decode-on-garbage from a contract that isn't actually a
    // Safe but happens to respond to these selectors with something.
    if (ownerCount <= 0 || threshold <= 0 || threshold > ownerCount) {
      return null;
    }
    return { ownerCount, threshold };
  } catch {
    return null;
  }
}

/**
 * All Safe wallets for a project, with their on-chain signer info.
 * Wallets that aren't tagged `walletType: "gnosis_safe"`, or that fail
 * the on-chain read, are simply absent from the result — callers render
 * nothing extra for those, never an error state.
 */
export async function getSafeInfoForProject(
  projectId: string
): Promise<SafeInfo[]> {
  const safeWallets = await db.query.wallets.findMany({
    where: and(
      eq(wallets.projectId, projectId),
      eq(wallets.walletType, "gnosis_safe"),
      eq(wallets.isActive, true)
    ),
  });
  if (safeWallets.length === 0) return [];

  const results = await Promise.all(
    safeWallets.map(async (w) => {
      const info = await getSafeInfo(w.address, w.chain);
      if (!info) return null;
      // Best-effort — a Safe Transaction Service outage must not drop a
      // Safe that already succeeded its owners/threshold on-chain read.
      // Omit the keys entirely on failure (rather than set them to
      // undefined) so the object literal stays structurally assignable
      // to SafeInfo's optional fields.
      const pending = await getSafePendingInfo(w.address, w.chain);
      return {
        walletId: w.id,
        chain: w.chain,
        address: w.address,
        label: w.label,
        ...info,
        ...(pending
          ? {
              pendingCount: pending.pendingCount,
              oldestPendingDate: pending.oldestPendingDate,
            }
          : {}),
      };
    })
  );

  return results.filter((r): r is SafeInfo => r !== null);
}
