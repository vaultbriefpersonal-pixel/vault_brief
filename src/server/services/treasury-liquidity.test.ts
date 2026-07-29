import { describe, it, expect } from "vitest";
import {
  analyzeTreasuryLiquidity,
  liquidReservesUsd,
} from "./treasury-liquidity";

const STETH = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
const WSTETH_ARBITRUM = "0x5979D7b546E38E414F7E9822514be443A4800529";
const WSTETH_BASE = "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452";
const OWN_CONTRACT = "0x1111111111111111111111111111111111111111";

/** One wallet's worth of `balances_detail`, in the stored shape. */
function wallet(chain: string, tokens: unknown[]) {
  return { walletAddress: "0xwallet", chain, tokens };
}

const PROJECT = { tokenSymbol: "TEST", tokenContract: OWN_CONTRACT };

describe("analyzeTreasuryLiquidity — malformed and legacy input", () => {
  it("returns zeros and never throws on unusable payloads", () => {
    for (const input of [null, undefined, {}, "garbage", 7, [], [null], [{}]]) {
      const liq = analyzeTreasuryLiquidity(input, PROJECT);
      expect(liq.liquidStableUsd).toBe(0);
      expect(liq.liquidCryptoUsd).toBe(0);
      expect(liq.concentratedUsd).toBe(0);
      expect(liq.otherUsd).toBe(0);
      expect(liq.btcUsd).toBe(0);
      expect(liq.totalUsd).toBe(0);
      expect(liq.concentrationPct).toBe(0);
      // The distinction that stops a report asserting a liquidity finding
      // from an absence of data.
      expect(liq.derived).toBe(false);
    }
  });

  it("tolerates a missing project identity", () => {
    const liq = analyzeTreasuryLiquidity(
      [wallet("ethereum", [{ symbol: "USDC", valueUsd: 100 }])],
      null
    );
    expect(liq.liquidStableUsd).toBe(100);
    expect(liq.concentratedUsd).toBe(0);
  });

  it("skips unpriced, zero, negative and non-numeric holdings", () => {
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          { symbol: "USDC", valueUsd: 0 },
          { symbol: "DAI", valueUsd: -500 },
          { symbol: "WETH", valueUsd: "not a number" },
          { symbol: "USDT" },
          { symbol: "USDC", valueUsd: 250 },
        ]),
      ],
      PROJECT
    );
    expect(liq.liquidStableUsd).toBe(250);
    expect(liq.totalUsd).toBe(250);
  });
});

describe("analyzeTreasuryLiquidity — the project's own token", () => {
  it("matches on contract address even when the symbol differs", () => {
    // Contract is authoritative: a project that renamed its ticker, or a
    // provider reporting a stale symbol, must still be excluded from runway.
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          { symbol: "OLDTICKER", contractAddress: OWN_CONTRACT, valueUsd: 900 },
        ]),
      ],
      PROJECT
    );
    expect(liq.concentratedUsd).toBe(900);
    expect(liq.otherUsd).toBe(0);
  });

  it("matches on contract address case-insensitively", () => {
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          {
            symbol: "TEST",
            contractAddress: OWN_CONTRACT.toUpperCase(),
            valueUsd: 400,
          },
        ]),
      ],
      PROJECT
    );
    expect(liq.concentratedUsd).toBe(400);
  });

  it("falls back to symbol when the project has no contract configured", () => {
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          { symbol: "test", contractAddress: "0xsomewhere", valueUsd: 700 },
        ]),
      ],
      { tokenSymbol: "TEST" }
    );
    expect(liq.concentratedUsd).toBe(700);
  });

  it("falls back to symbol when the holding carries no contract address", () => {
    const liq = analyzeTreasuryLiquidity(
      [wallet("solana", [{ symbol: "TEST", valueUsd: 120 }])],
      PROJECT
    );
    expect(liq.concentratedUsd).toBe(120);
  });

  it("never counts the own token toward liquid reserves", () => {
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          { symbol: "TEST", contractAddress: OWN_CONTRACT, valueUsd: 9_000 },
          { symbol: "USDC", valueUsd: 1_000 },
        ]),
      ],
      PROJECT
    );
    expect(liquidReservesUsd(liq)).toBe(1_000);
    expect(liq.concentrationPct).toBeCloseTo(90, 6);
  });

  it("classifies an own token that is itself a stablecoin as concentrated", () => {
    // Own-token beats every other rule. A stablecoin issuer holding its own
    // stable unwinds for the same reason any own-token position does.
    const liq = analyzeTreasuryLiquidity(
      [wallet("ethereum", [{ symbol: "FRAX", valueUsd: 5_000 }])],
      { tokenSymbol: "FRAX" }
    );
    expect(liq.concentratedUsd).toBe(5_000);
    expect(liq.liquidStableUsd).toBe(0);
  });
});

describe("analyzeTreasuryLiquidity — bucketing", () => {
  it("buckets BTC and its wrappers as liquid crypto, broken out separately", () => {
    // The live failure this fixes: a $1.02B BTC treasury rendered as ~100%
    // "Other assets" because BTC has no stored bucket.
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          { symbol: "WBTC", valueUsd: 600_000 },
          { symbol: "cbBTC", valueUsd: 300_000 },
          { symbol: "tBTC", valueUsd: 100_000 },
        ]),
      ],
      PROJECT
    );
    expect(liq.btcUsd).toBe(1_000_000);
    expect(liq.liquidCryptoUsd).toBe(1_000_000);
    expect(liq.otherUsd).toBe(0);
    // btcUsd is a slice of liquidCryptoUsd, never a fifth bucket.
    expect(liq.totalUsd).toBe(1_000_000);
  });

  it("buckets stablecoins by uppercased symbol", () => {
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("base", [
          { symbol: "usdc", valueUsd: 500 },
          { symbol: "DAI", valueUsd: 500 },
        ]),
      ],
      PROJECT
    );
    expect(liq.liquidStableUsd).toBe(1_000);
  });

  it("buckets ETH and WETH as liquid crypto", () => {
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          { symbol: "ETH", valueUsd: 300 },
          { symbol: "WETH", valueUsd: 200 },
        ]),
      ],
      PROJECT
    );
    expect(liq.liquidCryptoUsd).toBe(500);
    expect(liq.btcUsd).toBe(0);
  });

  it("recognises a mainnet LSD by contract address", () => {
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          { symbol: "stETH", contractAddress: STETH, valueUsd: 250_000 },
        ]),
      ],
      PROJECT
    );
    expect(liq.liquidCryptoUsd).toBe(250_000);
  });

  it("recognises L2 liquid-staking deployments that the mainnet-only table misses", () => {
    // Without the L2 addresses these fall to `otherUsd`, understating liquid
    // reserves and therefore the runway.
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("arbitrum", [
          {
            symbol: "unrecognised-ticker",
            contractAddress: WSTETH_ARBITRUM,
            valueUsd: 40_000,
          },
        ]),
        wallet("base", [
          {
            symbol: "unrecognised-ticker",
            contractAddress: WSTETH_BASE,
            valueUsd: 10_000,
          },
        ]),
      ],
      PROJECT
    );
    expect(liq.liquidCryptoUsd).toBe(50_000);
    expect(liq.otherUsd).toBe(0);
  });

  it("recognises a liquid-staking token by symbol on an unknown contract", () => {
    // Bucketing-only fallback: enough to call the position liquid, never
    // enough to print a protocol name next to it.
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("optimism", [
          { symbol: "rETH", contractAddress: "0xnot-in-any-table", valueUsd: 12_000 },
        ]),
      ],
      PROJECT
    );
    expect(liq.liquidCryptoUsd).toBe(12_000);
  });

  it("puts an unrecognised token in otherUsd — illiquid is the safe default", () => {
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          { symbol: "RANDOMDAO", contractAddress: "0xabc", valueUsd: 75_000 },
        ]),
      ],
      PROJECT
    );
    expect(liq.otherUsd).toBe(75_000);
    expect(liquidReservesUsd(liq)).toBe(0);
  });

  it("aggregates across wallets and chains into four buckets that sum to the total", () => {
    const liq = analyzeTreasuryLiquidity(
      [
        wallet("ethereum", [
          { symbol: "USDC", valueUsd: 2_000_000 },
          { symbol: "WBTC", valueUsd: 1_000_000 },
          { symbol: "TEST", contractAddress: OWN_CONTRACT, valueUsd: 6_000_000 },
        ]),
        wallet("arbitrum", [
          { symbol: "wstETH", contractAddress: WSTETH_ARBITRUM, valueUsd: 500_000 },
          { symbol: "MYSTERY", valueUsd: 500_000 },
        ]),
      ],
      PROJECT
    );
    expect(liq.liquidStableUsd).toBe(2_000_000);
    expect(liq.liquidCryptoUsd).toBe(1_500_000);
    expect(liq.concentratedUsd).toBe(6_000_000);
    expect(liq.otherUsd).toBe(500_000);
    expect(liq.btcUsd).toBe(1_000_000);
    expect(liq.totalUsd).toBe(10_000_000);
    expect(
      liq.liquidStableUsd +
        liq.liquidCryptoUsd +
        liq.concentratedUsd +
        liq.otherUsd
    ).toBe(liq.totalUsd);
    expect(liq.concentrationPct).toBeCloseTo(60, 6);
    expect(liquidReservesUsd(liq)).toBe(3_500_000);
    expect(liq.derived).toBe(true);
  });
});
