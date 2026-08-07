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

// ─── does this wallet behave like a treasury? ───────────────────────────────
//
// A founder can hand this product the wrong addresses and get a confident,
// internally consistent report about 20% of their treasury. That happened:
// six Threshold Network addresses taken from the project's own documentation
// turned out to be its governance Committee Multisigs, and the real Treasury
// Guild multisig — four times larger — was never configured. Nothing in the
// product objected, because nothing failed.
//
// ── THE DISCRIMINATOR IS NOT OWN-TOKEN CONCENTRATION ───────────────────────
// The obvious rule — "mostly its own token, therefore suspicious" — is wrong,
// and checking it against real wallets is what showed that. Gitcoin's GTC
// Timelock is roughly 72% GTC and is unambiguously a real treasury: it also
// holds $266K of ETH and pays out of it. Concentration describes a treasury's
// RISK, which the report already covers at length, not its IDENTITY.
//
// What actually separates the two is whether the wallet holds anything it
// could spend. Measured across the six real wallets verified this session:
//
//   Threshold Council (the wrong one)      0.05%   <- holds $78 of $162,800
//   Gitcoin GTC Timelock                   18.4%
//   Threshold Treasury Guild (the right one) ~35%
//   Gitcoin Matching Pool                  90.6%
//   Gitcoin new Safe / Ecosystem Collective  100%
//
// The gap between the wrong wallet and the nearest right one is three orders
// of magnitude, which is what makes a threshold safe to draw here at all.

/**
 * Below this a wallet's shape says nothing. Gas floats, test wallets and dust
 * are all legitimately empty of spendable assets, and flagging them would
 * train founders to ignore the signal — the failure mode that matters more
 * than a missed detection here.
 */
export const MATERIAL_WALLET_USD = 25_000;

/**
 * Spendable share below which a material wallet is "holding nothing it could
 * spend". Set an order of magnitude above the worst real treasury observed
 * (18.4%) would be reckless; this sits an order of magnitude BELOW it, so a
 * real treasury has to be extraordinarily unusual to trip it.
 */
export const SPENDABLE_SHARE_FLOOR = 0.02;

export interface WalletProfile {
  /** Stablecoins + liquid crypto. What this wallet could actually pay with. */
  spendableUsd: number;
  /** `spendableUsd / totalUsd`, 0–1. */
  spendableShare: number;
  /**
   * Material balance, essentially none of it spendable. States an OBSERVATION,
   * not a verdict about intent: a governance or admin multisig looks like
   * this, and so does a treasury that has spent everything liquid. The product
   * cannot tell those apart and must not pretend to.
   */
  holdsNothingSpendable: boolean;
}

/**
 * Null when the wallet's shape cannot be read — never synced, read failed, or
 * too small to characterise. Null means "no opinion", never "looks fine".
 */
export function profileWallet(view: WalletBalanceView): WalletProfile | null {
  if (view.state !== "synced" && view.state !== "truncated") return null;
  const total = view.totalUsd ?? 0;
  if (total < MATERIAL_WALLET_USD) return null;

  const spendableUsd = (view.stablecoinsUsd ?? 0) + (view.liquidCryptoUsd ?? 0);
  const spendableShare = spendableUsd / total;
  return {
    spendableUsd,
    spendableShare,
    holdsNothingSpendable: spendableShare < SPENDABLE_SHARE_FLOOR,
  };
}

export interface WalletSetVerdict {
  /** Wallets big enough to characterise at all. */
  materialCount: number;
  /** Of those, how many hold essentially nothing spendable. */
  nothingSpendableCount: number;
  /** Combined value of the material wallets. */
  materialTotalUsd: number;
  /**
   * EVERY material wallet holds nothing spendable — so the configured set, as
   * a whole, has no operating capital.
   *
   * Deliberately all-or-nothing rather than "any". One own-token-heavy wallet
   * beside a funded one is an ordinary treasury structure and says nothing;
   * a set where NOTHING can be spent is either a project that cannot make
   * payroll or, far more often, a set of addresses that are not the treasury.
   * Both deserve the same sentence, because the product cannot distinguish
   * them and the founder can.
   */
  noSpendableReserves: boolean;
}

/**
 * The same verdict, straight from a stored snapshot.
 *
 * Reads the wallet list out of `balances_detail` itself rather than taking the
 * configured `wallets` rows, so a caller holding only a snapshot — the report
 * page, the send gate — can ask the question without a second query. A wallet
 * that failed to sync is absent from that payload and therefore silently
 * excluded, which is correct here: an unread wallet has no shape to judge, and
 * its absence is already disclosed through `sync_warnings`.
 *
 * `project` is optional and barely matters: the verdict is built from the
 * stablecoin and liquid-crypto buckets, and a project token that goes
 * unrecognised lands in `otherUsd`, which is not spendable either way.
 */
export function judgeStoredWalletSet(
  balancesDetail: unknown,
  project?: ProjectTokenIdentity | null
): WalletSetVerdict {
  const entries = Array.isArray(balancesDetail)
    ? (balancesDetail as StoredWalletEntry[]).filter(
        (e) => e && typeof e === "object"
      )
    : [];

  const views = viewWalletBalances({
    wallets: entries.map((e) => ({
      address: str(e.walletAddress),
      chain: str(e.chain),
    })),
    balancesDetail,
    syncWarnings: null,
    project: project ?? null,
    hasSnapshot: true,
  });

  return judgeWalletSet(views);
}

export function judgeWalletSet(
  views: readonly WalletBalanceView[]
): WalletSetVerdict {
  const profiles = views
    .map((v) => ({ view: v, profile: profileWallet(v) }))
    .filter((p): p is { view: WalletBalanceView; profile: WalletProfile } =>
      p.profile !== null
    );

  const nothingSpendableCount = profiles.filter(
    (p) => p.profile.holdsNothingSpendable
  ).length;

  return {
    materialCount: profiles.length,
    nothingSpendableCount,
    materialTotalUsd: profiles.reduce((sum, p) => sum + (p.view.totalUsd ?? 0), 0),
    noSpendableReserves:
      profiles.length > 0 && nothingSpendableCount === profiles.length,
  };
}
