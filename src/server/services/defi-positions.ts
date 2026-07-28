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
