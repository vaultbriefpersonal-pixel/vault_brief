// Per-wallet balances, for the one surface that never had them: the Wallets
// page. Until this module existed the product showed a founder their configured
// addresses and nothing else — no balance, no sync state, nothing. A treasury
// assembled from the wrong addresses therefore looked identical to one
// assembled from the right ones, right up until the report quoted a number
// four times too small.
//
// The distinction this module exists to preserve is "$0" versus "we could not
// read it". Those are different facts and only one of them is a finding about
// the treasury; collapsing them is the same mistake `TreasuryBuckets.derived`
// and `netFlowOf`'s deliberate null already guard against elsewhere.
//
// Like treasury-composition.ts, treasury-liquidity.ts and
// treasury-attribution.ts, every figure here derives from the already-stored
// `treasury_snapshots.balances_detail` rather than from a new column, so it
// works retroactively across all history with no backfill and no re-sync.

import {
  composeTreasury,
  type ProjectTokenIdentity,
  type StoredWalletBalance,
} from "./treasury-composition";
import { walletKey } from "./treasury-attribution";

/**
 * Where a configured wallet stood in the most recent snapshot.
 *
 * `failed` and `notInSnapshot` are both "absent from `balances_detail`" and
 * are split apart deliberately: absent-with-a-warning is a provider failure
 * the founder should retry, absent-without-one is almost always a wallet added
 * since the last sync. Presenting either as `$0` would state a treasury fact
 * that was never measured.
 */
export type WalletSyncState =
  /** Present in the snapshot, read completely. */
  | "synced"
  /** Present, but the read stopped at the page cap — figures are a FLOOR. */
  | "truncated"
  /** Absent from the snapshot, and a warning names it. Nothing was measured. */
  | "failed"
  /** Absent, with no warning. Added after the last sync ran. */
  | "notInSnapshot"
  /** The project has never been synced at all. */
  | "neverSynced";

export interface WalletBalanceView {
  chain: string;
  address: string;
  state: WalletSyncState;
  /**
   * Sum of the four classified buckets, matching what every report and the
   * dashboard quote. NULL — never 0 — whenever `state` is not `synced` or
   * `truncated`, because nothing was measured.
   *
   * Excludes unpriced holdings by construction (see `TreasuryBuckets.totalUsd`),
   * which is why `unpricedCount` travels beside it: their worth is unknown,
   * not zero, so this figure is a floor whenever that count is non-zero.
   */
  totalUsd: number | null;
  stablecoinsUsd: number | null;
  liquidCryptoUsd: number | null;
  ownTokenUsd: number | null;
  otherUsd: number | null;
  unpricedCount: number | null;
  /**
   * Warning text from `sync_warnings` naming this wallet, verbatim.
   *
   * Independent of `state`: a wallet whose BALANCE read succeeded can still
   * have had its TRANSFER read fail, which is exactly what a chain that is
   * configured but not enabled on the provider looks like. Such a wallet is
   * `synced` with a real balance AND carries a warning, and both facts matter.
   */
  warnings: string[];
}

export interface WalletRef {
  address: string;
  chain: string;
}

export interface ViewWalletBalancesInput {
  /** The project's configured wallets, in the order they should render. */
  wallets: readonly WalletRef[];
  /** `treasury_snapshots.balances_detail` — `WalletBalanceSummary[]`, or null. */
  balancesDetail: unknown;
  /** `treasury_snapshots.sync_warnings` — `SyncWarning[]`, or null. */
  syncWarnings: unknown;
  /** Own-token identity. Contract-first matching depends on both fields. */
  project: ProjectTokenIdentity | null | undefined;
  /**
   * Whether a snapshot exists at all. Passed rather than inferred from
   * `balancesDetail`, because a snapshot whose every wallet read failed stores
   * an empty array — indistinguishable from "never synced" if inferred, and
   * they warrant opposite advice ("retry" versus "run your first sync").
   */
  hasSnapshot: boolean;
}

/** A stored wallet entry, plus the fields `composeTreasury` does not read. */
interface StoredWalletEntry extends StoredWalletBalance {
  walletAddress?: string;
  truncated?: boolean;
}

interface StoredWarning {
  walletAddress?: string;
  chain?: string;
  error?: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * One view per configured wallet, in the order given.
 *
 * Driven by the CONFIGURED wallet list, not by `balances_detail`: a wallet
 * that failed to sync contributes no entry there at all, so iterating the
 * snapshot would silently drop exactly the wallets worth showing.
 */
export function viewWalletBalances(
  input: ViewWalletBalancesInput
): WalletBalanceView[] {
  const stored = new Map<string, StoredWalletEntry>();
  if (Array.isArray(input.balancesDetail)) {
    for (const entry of input.balancesDetail as StoredWalletEntry[]) {
      if (!entry || typeof entry !== "object") continue;
      stored.set(walletKey(str(entry.chain), str(entry.walletAddress)), entry);
    }
  }

  const warningsByWallet = new Map<string, string[]>();
  if (Array.isArray(input.syncWarnings)) {
    for (const w of input.syncWarnings as StoredWarning[]) {
      if (!w || typeof w !== "object") continue;
      const message = str(w.error).trim();
      if (!message) continue;
      const key = walletKey(str(w.chain), str(w.walletAddress));
      const list = warningsByWallet.get(key);
      if (list) list.push(message);
      else warningsByWallet.set(key, [message]);
    }
  }

  return input.wallets.map((w) => {
    const key = walletKey(w.chain, w.address);
    const warnings = warningsByWallet.get(key) ?? [];
    const entry = stored.get(key);

    if (!input.hasSnapshot) {
      return blank(w, "neverSynced", warnings);
    }
    if (!entry) {
      return blank(w, warnings.length > 0 ? "failed" : "notInSnapshot", warnings);
    }

    // Single-wallet composition. Deliberately NOT the four scalar columns
    // stored alongside (`stablecoinsUsd`, `ethUsd`, `nativeTokenUsd`,
    // `otherAssetsUsd`): those are a write-only legacy cache whose mapping is
    // lossy — `ethUsd` is ETH only rather than all liquid crypto, the BTC and
    // liquid-staking remainder is folded into `otherAssetsUsd`, and
    // solana-sync.ts writes the CHAIN's gas asset into the same column
    // wallet-sync.ts uses for the PROJECT's own token. Recomputing here also
    // buys contract-first own-token matching, which the sync-time path cannot
    // do: it forwards only `tokenSymbol`, never `tokenContract`.
    const buckets = composeTreasury([entry], input.project);

    return {
      chain: w.chain,
      address: w.address,
      state: entry.truncated ? "truncated" : "synced",
      totalUsd: buckets.totalUsd,
      stablecoinsUsd: buckets.liquidStableUsd,
      liquidCryptoUsd: buckets.liquidCryptoUsd,
      ownTokenUsd: buckets.concentratedUsd,
      otherUsd: buckets.otherUsd,
      unpricedCount: buckets.unpriced.count,
      warnings,
    };
  });
}

function blank(
  w: WalletRef,
  state: WalletSyncState,
  warnings: string[]
): WalletBalanceView {
  return {
    chain: w.chain,
    address: w.address,
    state,
    totalUsd: null,
    stablecoinsUsd: null,
    liquidCryptoUsd: null,
    ownTokenUsd: null,
    otherUsd: null,
    unpricedCount: null,
    warnings,
  };
}

/**
 * True when the wallet set as a whole cannot be presented as a treasury total.
 *
 * Kept beside the per-wallet view because the honest headline is a property of
 * the SET, not of any one row: one failed wallet out of seven means every
 * aggregate on the page is a floor, and the page should say so once rather
 * than leave the reader to add it up from the rows.
 */
export function walletCoverageIsPartial(
  views: readonly WalletBalanceView[]
): boolean {
  return views.some(
    (v) => v.state === "failed" || v.state === "truncated" || v.state === "notInSnapshot"
  );
}
