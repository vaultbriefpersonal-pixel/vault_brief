// Classifies known liquid-staking-derivative tokens out of the generic
// "Other assets" bucket so investors can see DeFi positions distinctly
// instead of a lumped, uninterpretable total.
//
// Deliberately derives this from `treasury_snapshots.balances_detail`
// (already stored, full per-token detail — symbol/contractAddress/valueUsd,
// see WalletBalanceSummary in wallet-sync.ts) rather than adding a new
// sync-time pipeline or schema column: the balance + USD price for these
// tokens is already fetched and stored today, just not labeled. This means
// it also works retroactively on every snapshot already in the database,
// no backfill needed.
//
// Scope (TODO-031, first slice): Ethereum mainnet liquid staking derivatives
// only — the simplest DeFi-position category to classify correctly, since
// each token has one well-known canonical contract and its market price
// already reflects the underlying staked-ETH claim (no separate valuation
// logic needed, unlike LP tokens or vesting positions). LP/vesting/RWA
// positions are explicitly out of scope here — see TODO.md for the
// planned follow-up slices.

export interface DefiPosition {
  symbol: string;
  protocol: string;
  chain: string;
  valueUsd: number;
}

interface KnownToken {
  protocol: string;
  label: string;
}

// Lowercase contract address → protocol metadata. Ethereum mainnet only.
// A wrong/missing address here just means that token stays in "Other
// assets" as it does today — a safe failure mode, never a false positive.
const KNOWN_LSD_TOKENS: Record<string, KnownToken> = {
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": {
    protocol: "Lido",
    label: "stETH",
  },
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": {
    protocol: "Lido",
    label: "wstETH",
  },
  "0xae78736cd615f374d3085123a210448e74fc6393": {
    protocol: "Rocket Pool",
    label: "rETH",
  },
  "0xbe9895146f7af43049ca1c1ae358b0541ea49704": {
    protocol: "Coinbase",
    label: "cbETH",
  },
  "0xac3e018457b222d93114458476f3e3416abbe38f": {
    protocol: "Frax",
    label: "sfrxETH",
  },
  "0x5e8422345238f34275888049021821e8e08caa1f": {
    protocol: "Frax",
    label: "frxETH",
  },
};

// ─── liquidity recognition (bucketing only, never labelling) ───────────────
//
// `KNOWN_LSD_TOKENS` above answers "what protocol is this, exactly?" and its
// answer is printed in an investor report, so it stays mainnet-only and
// address-keyed: every entry is a claim we can defend.
//
// The two tables below answer a different, weaker question — "is this position
// something the project could sell without a bespoke unwind?" — asked by
// treasury-liquidity.ts to sort a token into a liquidity bucket. That answer is
// never rendered as a protocol name, which is what makes the looser matching
// acceptable:
//
//   • Guessing "Lido" from the symbol `wstETH` on an unrecognised contract
//     would put a false, specific statement into an investor report.
//   • Guessing "this is liquid" from the same symbol is a bounded
//     approximation of a market property, and the report discloses that the
//     liquidity split is derived, not exact.
//
// So: address matches extend across L2s here, and a symbol fallback exists —
// but NEITHER feeds `extractDefiPositions`, whose output and signature are
// unchanged (defi-positions.test.ts and ReportWidgets.tsx depend on both).

/**
 * Canonical bridged deployments of the three major LSDs on the L2s this
 * product tracks. `KNOWN_LSD_TOKENS` is Ethereum-mainnet-only, so without
 * these a DAO holding wstETH on Arbitrum, Base or Optimism has that position
 * bucketed as illiquid — understating its liquid reserves and, through the
 * runway figure, its survival time.
 *
 * Chain-agnostic on purpose: the value is a Set of addresses, not a
 * chain→address map. Two different tokens colliding on the same 20-byte
 * address across chains is not a realistic failure mode, and matching without
 * the chain means a wallet synced under an unexpected chain key still resolves.
 * A wrong or missing entry degrades to the symbol fallback below, then to
 * `otherUsd` — always the safe direction.
 */
const L2_LSD_ADDRESSES: ReadonlySet<string> = new Set([
  // wstETH
  "0x5979d7b546e38e414f7e9822514be443a4800529", // Arbitrum
  "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb", // Optimism
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", // Base
  "0x03b54a6e9a984069379fae1a4fc4dbae93b3bccd", // Polygon
  // rETH
  "0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8", // Arbitrum
  "0x9bcef72be871e61ed4fbbc7630889bee758eb81d", // Optimism
  "0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c", // Base
  // cbETH
  "0x1debd73e752beaf79865fd6446b0c970eae7732f", // Arbitrum
  "0xadbb6a0412de1ba0f936dcaeb8aaa24578dcf3b2", // Optimism
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", // Base
]);

/**
 * Uppercase symbols of liquid-staking tokens with deep secondary markets.
 * Used ONLY when no address matched — a token held on a chain we have not
 * enumerated, or reported by the balance provider without a contract address,
 * would otherwise be called illiquid purely because our address table is
 * incomplete.
 *
 * The known cost: a token that merely calls itself `stETH` on some unrelated
 * contract is counted as liquid. That is a bounded error on one bucket of a
 * disclosed-as-derived breakdown — and it is emphatically NOT licence to print
 * "Lido" next to it. Bucketing only.
 */
const LIQUID_STAKING_SYMBOLS: ReadonlySet<string> = new Set([
  // ETH staking
  "STETH",
  "WSTETH",
  "RETH",
  "CBETH",
  "SFRXETH",
  "FRXETH",
  "OSETH",
  "SWETH",
  "ANKRETH",
  "METH",
  "LSETH",
  // ETH restaking wrappers — same "sell it on a DEX" liquidity profile
  "EZETH",
  "WEETH",
  "RSETH",
  // Solana staking
  "MSOL",
  "JITOSOL",
  "BSOL",
  // Polygon staking
  "STMATIC",
  "MATICX",
]);

/**
 * True when a holding is a liquid-staking derivative that could plausibly be
 * sold or redeemed at size. For LIQUIDITY BUCKETING ONLY — callers must not
 * use this to name a protocol, and must not present its verdict as exact.
 * Defensive: any input shape returns a boolean, never throws.
 */
export function isLiquidStakingToken(token: {
  symbol?: string | null;
  contractAddress?: string | null;
}): boolean {
  const address = token?.contractAddress?.toLowerCase();
  if (address && (KNOWN_LSD_TOKENS[address] || L2_LSD_ADDRESSES.has(address))) {
    return true;
  }
  const symbol = token?.symbol?.toUpperCase();
  return Boolean(symbol && LIQUID_STAKING_SYMBOLS.has(symbol));
}

interface StoredTokenBalance {
  symbol?: string;
  valueUsd?: number;
  contractAddress?: string | null;
}

interface StoredWalletBalance {
  chain?: string;
  tokens?: StoredTokenBalance[];
}

/**
 * Walks a `treasury_snapshots.balances_detail` JSON value (shape:
 * `WalletBalanceSummary[]` from wallet-sync.ts) and pulls out any token
 * matching a known liquid-staking-derivative contract. Defensive against
 * malformed/legacy/missing data — always returns an array, never throws.
 */
export function extractDefiPositions(balancesDetail: unknown): DefiPosition[] {
  if (!Array.isArray(balancesDetail)) return [];

  const positions: DefiPosition[] = [];
  for (const wallet of balancesDetail as StoredWalletBalance[]) {
    if (wallet.chain !== "ethereum" || !Array.isArray(wallet.tokens)) continue;
    for (const token of wallet.tokens) {
      const address = token.contractAddress?.toLowerCase();
      if (!address) continue;
      const known = KNOWN_LSD_TOKENS[address];
      const value = token.valueUsd ?? 0;
      if (known && value > 0) {
        positions.push({
          symbol: known.label,
          protocol: known.protocol,
          chain: wallet.chain,
          valueUsd: value,
        });
      }
    }
  }

  return positions.sort((a, b) => b.valueUsd - a.valueUsd);
}

export function totalDefiUsd(positions: DefiPosition[]): number {
  return positions.reduce((sum, p) => sum + p.valueUsd, 0);
}
