import { describe, it, expect } from "vitest";
import { STABLECOIN_SYMBOLS } from "@/lib/chains";
import {
  bucketsToLegacyColumns,
  classifyHolding,
  composeTreasury,
  compositionSlices,
  isDustHolding,
  isOwnToken,
  DUST_FLOOR_USD,
  type ProjectTokenIdentity,
  type StoredTokenBalance,
} from "./treasury-composition";

const OWN_CONTRACT = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
const SPOOF_CONTRACT = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const STETH = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

/** One wallet's worth of `balances_detail`, in the stored shape. */
function wallet(chain: string, tokens: unknown[]) {
  return { walletAddress: "0xwallet", chain, tokens };
}

// ─── isDustHolding — the exported, single-source-of-truth predicate ────────

describe("isDustHolding", () => {
  it("is true for a $50 holding — below the floor", () => {
    expect(isDustHolding({ valueUsd: 50 })).toBe(true);
  });

  it("is false for exactly $100 — the floor is exclusive-below", () => {
    expect(isDustHolding({ valueUsd: DUST_FLOOR_USD })).toBe(false);
    expect(isDustHolding({ valueUsd: 100 })).toBe(false);
  });

  it("is false for a $1000 holding", () => {
    expect(isDustHolding({ valueUsd: 1000 })).toBe(false);
  });
});

// ─── classifyHolding — the single predicate ────────────────────────────────

describe("classifyHolding — check order", () => {
  it("puts the project's own token first, ahead of the stablecoin rule", () => {
    // A stablecoin issuer holding its own stable is still holding its own
    // token: it unwinds badly for the same reason any own-token position does,
    // and the runway denominator must not include it. This is why own-token is
    // checked FIRST rather than somewhere convenient.
    expect(STABLECOIN_SYMBOLS.has("FRAX")).toBe(true);
    expect(
      classifyHolding({ symbol: "FRAX", valueUsd: 5_000 }, { tokenSymbol: "FRAX" }, "ethereum")
    ).toBe("own_token");
    // And the same symbol for a project that does NOT own it stays a stable.
    expect(
      classifyHolding({ symbol: "FRAX", valueUsd: 5_000 }, { tokenSymbol: "UNI" }, "ethereum")
    ).toBe("stable");
  });

  it("puts the own token ahead of the ETH rule too", () => {
    expect(
      classifyHolding({ symbol: "WETH", valueUsd: 10 }, { tokenSymbol: "WETH" }, "ethereum")
    ).toBe("own_token");
  });

  it("classifies stablecoins, BTC, ETH and liquid-staking tokens", () => {
    const none: ProjectTokenIdentity = {};
    expect(classifyHolding({ symbol: "usdc" }, none, "base")).toBe("stable");
    expect(classifyHolding({ symbol: "WBTC" }, none, "ethereum")).toBe("liquid_crypto");
    expect(classifyHolding({ symbol: "cbBTC" }, none, "ethereum")).toBe("liquid_crypto");
    expect(classifyHolding({ symbol: "WETH" }, none, "ethereum")).toBe("liquid_crypto");
    expect(
      classifyHolding({ symbol: "whatever", contractAddress: STETH }, none, "ethereum")
    ).toBe("liquid_crypto");
  });

  it("falls back to `other` for anything unrecognised — illiquid is the safe default", () => {
    expect(classifyHolding({ symbol: "RANDOMDAO" }, {}, "ethereum")).toBe("other");
    expect(classifyHolding({ symbol: "henlo" }, {}, "ethereum")).toBe("other");
    expect(classifyHolding({}, {}, "ethereum")).toBe("other");
  });
});

describe("classifyHolding — the chain's own gas asset (Cause C)", () => {
  // Before this, `analyzeTreasuryLiquidity` had no bucket for a non-ETH gas
  // asset, so SOL/MATIC fell through to `otherUsd` — understating liquid
  // reserves, and therefore runway, for every non-Ethereum treasury.
  it("recognises SOL on solana, MATIC on polygon and ETH on the L2s", () => {
    expect(classifyHolding({ symbol: "SOL" }, {}, "solana")).toBe("liquid_crypto");
    expect(classifyHolding({ symbol: "MATIC" }, {}, "polygon")).toBe("liquid_crypto");
    expect(classifyHolding({ symbol: "ETH" }, {}, "arbitrum")).toBe("liquid_crypto");
    expect(classifyHolding({ symbol: "ETH" }, {}, "optimism")).toBe("liquid_crypto");
    expect(classifyHolding({ symbol: "ETH" }, {}, "base")).toBe("liquid_crypto");
  });

  it("does not credit a gas asset held on the wrong chain", () => {
    // MATIC on Ethereum mainnet is an ERC-20, not that chain's gas asset. The
    // rule is per-chain on purpose; it must not become a global symbol list.
    expect(classifyHolding({ symbol: "MATIC" }, {}, "ethereum")).toBe("other");
    expect(classifyHolding({ symbol: "SOL" }, {}, "ethereum")).toBe("other");
  });

  it("skips the gas-asset rule on an unknown or missing chain without throwing", () => {
    expect(classifyHolding({ symbol: "SOL" }, {}, "not-a-chain")).toBe("other");
    expect(classifyHolding({ symbol: "SOL" }, {})).toBe("other");
    expect(classifyHolding({ symbol: "SOL" }, {}, null)).toBe("other");
  });
});

describe("isOwnToken — contract beats symbol", () => {
  const project: ProjectTokenIdentity = {
    tokenSymbol: "UNI",
    tokenContract: OWN_CONTRACT,
  };

  it("matches on contract even when the symbol differs", () => {
    expect(
      isOwnToken({ symbol: "OLDTICKER", contractAddress: OWN_CONTRACT }, project)
    ).toBe(true);
  });

  it("matches the contract case-insensitively", () => {
    expect(
      isOwnToken({ symbol: "x", contractAddress: OWN_CONTRACT.toUpperCase() }, project)
    ).toBe(true);
  });

  it("does NOT match a spoofed ticker sitting on a different contract", () => {
    // The fixture treasury holds spam deliberately spoofing real tickers, so
    // this is the case the contract check exists for: same symbol, different
    // contract, must classify as an unrelated asset.
    expect(
      isOwnToken({ symbol: "UNI", contractAddress: SPOOF_CONTRACT }, project)
    ).toBe(false);
    expect(
      classifyHolding(
        { symbol: "UNI", contractAddress: SPOOF_CONTRACT, valueUsd: 1 },
        project,
        "ethereum"
      )
    ).toBe("other");
  });

  it("falls back to symbol when the project configured no contract", () => {
    expect(isOwnToken({ symbol: "uni" }, { tokenSymbol: "UNI" })).toBe(true);
  });

  it("falls back to symbol when the HOLDING carries no contract", () => {
    // Every snapshot written before contractAddress was persisted is this case.
    expect(isOwnToken({ symbol: "UNI" }, project)).toBe(true);
  });

  it("matches nothing when the project has no token identity at all", () => {
    expect(isOwnToken({ symbol: "UNI", contractAddress: OWN_CONTRACT }, {})).toBe(false);
  });
});

// ─── the stored-shape compatibility guarantee ──────────────────────────────
//
// The exact shape of the 53 tokens stored on the fixture snapshot
// (306f5550-ac28-4beb-aacd-cdc79b96e757, June 2026): name/amount/symbol/
// priceUsd/valueUsd and NO `contractAddress` key at all, because wallet-sync
// read the wrong Dune field. New syncs carry the contract; not one existing
// snapshot ever will. Both shapes have to classify correctly, forever.

function storedToken(
  name: string,
  symbol: string,
  amount: number,
  priceUsd: number
): StoredTokenBalance {
  const token = { name, amount, symbol, priceUsd, valueUsd: amount * priceUsd };
  expect("contractAddress" in token).toBe(false);
  return token;
}

/** The fixture's real top holdings, verbatim values, in the stored shape. */
function fixtureBalancesDetail() {
  return [
    wallet("ethereum", [
      storedToken("Uniswap", "UNI", 267_134_858.4790704, 3.952232120812),
      storedToken("Tether USD", "USDT", 1_000.96, 1),
      storedToken("henlo", "henlo", 2_100_000_000_000, 709.12 / 2_100_000_000_000),
      storedToken("Ethereum", "ETH", 0.1234, 439.57 / 0.1234),
      storedToken("USD Coin", "USDC", 135.38, 1),
      storedToken("Artificial Liquid Intelligence", "ALI", 931_800, 0.0001),
      // The long tail: below the dust floor, and one with no price at all.
      storedToken("Spam Token", "ZIK", 5_000, 0.001),
      storedToken("More Spam", "SAITAMA", 12_000, 0.002),
      storedToken("Unpriceable", "AQ0", 146_000_000, 0),
    ]),
  ];
}

describe("composeTreasury — symbol-only fallback on the real stored shape", () => {
  const project: ProjectTokenIdentity = {
    tokenSymbol: "UNI",
    tokenContract: OWN_CONTRACT,
  };

  it("classifies every holding correctly with ZERO contractAddress keys", () => {
    const c = composeTreasury(fixtureBalancesDetail(), project);

    // The whole point: the own-token position is found by SYMBOL, because the
    // stored tokens have no contract to match on. Before this, the frozen
    // `native_token_usd` column read $0.00 and this $1.06B landed in "Other".
    expect(c.concentratedUsd).toBeCloseTo(1_055_778_968.2695498, 4);
    expect(c.concentrationPct).toBeGreaterThan(99.9);

    // The two figures a ~$1.06M proportional floor suppressed from the report.
    expect(c.liquidStableUsd).toBeCloseTo(1_136.34, 2);
    expect(c.ethUsd).toBeCloseTo(439.57, 2);
    expect(c.liquidCryptoUsd).toBeCloseTo(439.57, 2);
    expect(c.btcUsd).toBe(0);

    expect(c.derived).toBe(true);
  });

  it("names the big holdings, rolls up the dust, and counts the unpriced separately", () => {
    const c = composeTreasury(fixtureBalancesDetail(), project);

    // Sorted descending, own token first.
    expect(c.assets[0].symbol).toBe("UNI");
    expect(c.assets[0].cls).toBe("own_token");
    expect(c.assets.map((a) => a.valueUsd)).toEqual(
      [...c.assets.map((a) => a.valueUsd)].sort((a, b) => b - a)
    );

    // Dust is the sub-$100 tail — never named, always counted.
    expect(c.dust.count).toBeGreaterThan(0);
    for (const row of c.assets.filter((a) => a.valueUsd >= DUST_FLOOR_USD)) {
      expect(row.valueUsd).toBeGreaterThanOrEqual(DUST_FLOOR_USD);
    }

    // AQ0: 146M units at a price of 0. Held, unvaluable, named separately and
    // counted in no total — never folded in at $0.
    expect(c.unpriced.count).toBe(1);
    expect(c.assets.some((a) => a.symbol === "AQ0")).toBe(false);
  });
});

// ─── the arithmetic must not lose a cent ───────────────────────────────────

describe("composeTreasury — reconciliation of buckets, rows, dust and unpriced", () => {
  const project: ProjectTokenIdentity = { tokenSymbol: "OWN" };

  const multiToken = [
    wallet("ethereum", [
      { symbol: "USDC", valueUsd: 2_000_000.11, amount: 2_000_000, priceUsd: 1 },
      { symbol: "WBTC", valueUsd: 1_000_000.22, amount: 10, priceUsd: 100_000 },
      { symbol: "OWN", valueUsd: 6_000_000.33, amount: 100, priceUsd: 60_000 },
      { symbol: "MYSTERY", valueUsd: 500_000.44, amount: 5, priceUsd: 100_000 },
      // Dust, and an unpriced holding.
      { symbol: "DUSTY", valueUsd: 12.34, amount: 1_000, priceUsd: 0.01234 },
      { symbol: "ALSODUST", valueUsd: 87.66, amount: 2, priceUsd: 43.83 },
      { symbol: "NOFEED", valueUsd: 0, amount: 999_999, priceUsd: 0 },
    ]),
    wallet("polygon", [
      { symbol: "MATIC", valueUsd: 250_000.55, amount: 500_000, priceUsd: 0.5 },
    ]),
  ];

  it("sums the four buckets to totalUsd, to the cent", () => {
    const c = composeTreasury(multiToken, project);
    expect(
      c.liquidStableUsd + c.liquidCryptoUsd + c.concentratedUsd + c.otherUsd
    ).toBeCloseTo(c.totalUsd, 2);
    expect(c.totalUsd).toBeCloseTo(9_750_101.65, 2);
  });

  it("keeps btcUsd and ethUsd as SLICES of liquidCryptoUsd, never extra buckets", () => {
    const c = composeTreasury(multiToken, project);
    // WBTC + MATIC (polygon gas asset) are the liquid crypto; no ETH here.
    expect(c.liquidCryptoUsd).toBeCloseTo(1_250_000.77, 2);
    expect(c.btcUsd).toBeCloseTo(1_000_000.22, 2);
    expect(c.ethUsd).toBe(0);
    expect(c.btcUsd + c.ethUsd).toBeLessThanOrEqual(c.liquidCryptoUsd);
  });

  it("reconciles asset rows, dust and unpriced against totalUsd, to the cent", () => {
    const c = composeTreasury(multiToken, project);

    // NOTE on the identity being asserted. Dust is NOT a fifth bucket — its
    // dollars are already inside the four, because the floor gates NAMING, not
    // summing. Excluding dust from the totals would make the rows stop adding
    // up to the treasury, which is a worse lie than a long tail. So the
    // no-value-lost identity has three parts:
    //   1. every priced row sums to totalUsd;
    //   2. named rows + dust rows sum to totalUsd (the display split);
    //   3. unpriced holdings carry NO usd at all — they are a count, and they
    //      are excluded from totalUsd rather than added at zero.
    const rowsTotal = c.assets.reduce((sum, a) => sum + a.valueUsd, 0);
    expect(rowsTotal).toBeCloseTo(c.totalUsd, 2);

    const named = c.assets.filter((a) => a.valueUsd >= DUST_FLOOR_USD);
    const namedTotal = named.reduce((sum, a) => sum + a.valueUsd, 0);
    expect(namedTotal + c.dust.totalUsd).toBeCloseTo(c.totalUsd, 2);

    expect(c.dust.count).toBe(2);
    expect(c.dust.totalUsd).toBeCloseTo(100, 2);
    expect(c.unpriced.count).toBe(1);

    // Shares are computed against the same denominator the rows sum to.
    expect(c.assets.reduce((sum, a) => sum + a.sharePct, 0)).toBeCloseTo(100, 6);
  });

  it("aggregates the same token held in several wallets into one row", () => {
    // Three $40 positions in one token are a $120 holding, not three pieces of
    // dust — measuring dust on raw holdings would hide a real position.
    const c = composeTreasury(
      [
        wallet("ethereum", [{ symbol: "USDC", contractAddress: "0xA", valueUsd: 40 }]),
        wallet("ethereum", [{ symbol: "USDC", contractAddress: "0xa", valueUsd: 40 }]),
        wallet("ethereum", [{ symbol: "USDC", contractAddress: "0xA", valueUsd: 40 }]),
      ],
      {}
    );
    expect(c.assets).toHaveLength(1);
    expect(c.assets[0].valueUsd).toBeCloseTo(120, 6);
    expect(c.dust.count).toBe(0);
  });

  it("does NOT merge a spoofed ticker into the real position it imitates", () => {
    const c = composeTreasury(
      [
        wallet("ethereum", [
          { symbol: "USDC", contractAddress: "0xreal", valueUsd: 1_000 },
          { symbol: "USDC", contractAddress: "0xfake", valueUsd: 9_000 },
        ]),
      ],
      {}
    );
    expect(c.assets).toHaveLength(2);
  });

  it("keeps the same token on two chains as two distinguishable rows", () => {
    const c = composeTreasury(
      [
        wallet("ethereum", [{ symbol: "USDC", valueUsd: 600 }]),
        wallet("base", [{ symbol: "USDC", valueUsd: 400 }]),
      ],
      {}
    );
    expect(c.assets).toHaveLength(2);
    expect(c.assets.map((a) => a.chain)).toEqual(["ethereum", "base"]);
    expect(c.liquidStableUsd).toBe(1_000);
  });
});

describe("composeTreasury — malformed, legacy and null payloads", () => {
  it("returns an underived empty composition and never throws", () => {
    for (const input of [null, undefined, {}, "garbage", 7, [], [null], [{}], [{ tokens: 3 }]]) {
      const c = composeTreasury(input, { tokenSymbol: "OWN" });
      expect(c.derived).toBe(false);
      expect(c.totalUsd).toBe(0);
      expect(c.assets).toEqual([]);
      expect(c.dust).toEqual({ count: 0, totalUsd: 0 });
      expect(c.unpriced).toEqual({ count: 0 });
      expect(c.concentrationPct).toBe(0);
    }
  });

  it("tolerates a missing project identity", () => {
    const c = composeTreasury([wallet("ethereum", [{ symbol: "USDC", valueUsd: 100 }])], null);
    expect(c.liquidStableUsd).toBe(100);
    expect(c.concentratedUsd).toBe(0);
  });

  it("skips zero, negative and non-numeric values without bucketing them", () => {
    const c = composeTreasury(
      [
        wallet("ethereum", [
          { symbol: "USDC", valueUsd: 0 },
          { symbol: "DAI", valueUsd: -500 },
          { symbol: "WETH", valueUsd: "not a number" },
          { symbol: "USDT" },
          { symbol: "USDC", valueUsd: 250 },
        ]),
      ],
      { tokenSymbol: "OWN" }
    );
    expect(c.liquidStableUsd).toBe(250);
    expect(c.totalUsd).toBe(250);
    // A corrupt negative and an empty position are neither priced holdings nor
    // unpriced ones — none of them carries a positive quantity.
    expect(c.unpriced.count).toBe(0);
  });

  it("counts a positive quantity with no price as unpriced, not as dust", () => {
    const c = composeTreasury(
      [wallet("ethereum", [{ symbol: "AQ0", amount: 146_000_000, priceUsd: 0, valueUsd: 0 }])],
      {}
    );
    expect(c.unpriced.count).toBe(1);
    expect(c.dust.count).toBe(0);
    expect(c.totalUsd).toBe(0);
    // `derived` stays false: no priced holding was seen, so the split was not
    // computed — distinct from a treasury that genuinely holds nothing.
    expect(c.derived).toBe(false);
  });
});

// ─── legacy columns: the reconciliation that fails the build ────────────────

/**
 * The classifier `wallet-sync.ts` used to carry, verbatim, kept here as the
 * reference implementation this refactor must reproduce. Symbol-only, four
 * branches, stablecoin checked BEFORE the project's own token, and no filter on
 * value at all.
 */
function legacyClassifyTokens(
  tokens: { symbol: string; value_usd: number | null }[],
  projectTokenSymbol?: string | null
) {
  let stablecoinsUsd = 0;
  let ethUsd = 0;
  let nativeTokenUsd = 0;
  let otherAssetsUsd = 0;
  for (const t of tokens) {
    const value = t.value_usd ?? 0;
    const symbol = t.symbol?.toUpperCase() ?? "";
    if (STABLECOIN_SYMBOLS.has(symbol)) stablecoinsUsd += value;
    else if (symbol === "ETH" || symbol === "WETH") ethUsd += value;
    else if (projectTokenSymbol && symbol === projectTokenSymbol.toUpperCase())
      nativeTokenUsd += value;
    else otherAssetsUsd += value;
  }
  return { stablecoinsUsd, ethUsd, nativeTokenUsd, otherAssetsUsd };
}

describe("bucketsToLegacyColumns — reconciles with the classifier it replaced", () => {
  // A realistic single-chain EVM wallet: stables, ETH, the project's own token,
  // a BTC wrapper, an LSD and long-tail spam.
  const realistic = [
    { symbol: "UNI", value_usd: 1_055_778_968.2695498 },
    { symbol: "USDT", value_usd: 1_000.96 },
    { symbol: "USDC", value_usd: 135.38 },
    { symbol: "ETH", value_usd: 439.57 },
    { symbol: "WETH", value_usd: 120.5 },
    { symbol: "WBTC", value_usd: 250_000 },
    { symbol: "stETH", value_usd: 90_000 },
    { symbol: "henlo", value_usd: 709.12 },
    { symbol: "ALI", value_usd: 93.18 },
  ];

  const asStored = realistic.map((t) => ({
    symbol: t.symbol,
    valueUsd: t.value_usd ?? 0,
  }));

  it("produces the SAME stablecoin, ETH and other-assets columns as the legacy classifier", () => {
    // This is the test that fails the build if someone edits one classification
    // path and not the other. Only the three buckets that MUST agree are
    // asserted — see the next test for why `nativeTokenUsd` is excluded.
    const legacy = legacyClassifyTokens(realistic, "UNI");
    const derived = bucketsToLegacyColumns(
      composeTreasury([{ chain: "ethereum", tokens: asStored }], { tokenSymbol: "UNI" })
    );

    expect(derived.stablecoinsUsd).toBeCloseTo(legacy.stablecoinsUsd, 6);
    expect(derived.ethUsd).toBeCloseTo(legacy.ethUsd, 6);
    // BTC and the LSD have no bucket in the legacy schema, so both land in
    // `otherAssetsUsd` — `liquidCryptoUsd - ethUsd` is exactly that remainder.
    expect(derived.otherAssetsUsd).toBeCloseTo(legacy.otherAssetsUsd, 6);
    expect(derived.otherAssetsUsd).toBeCloseTo(709.12 + 93.18 + 250_000 + 90_000, 6);
  });

  it("EXCLUDES nativeTokenUsd from that guarantee, and here is why", () => {
    // `nativeTokenUsd` is the one column the new classifier deliberately
    // computes differently, because computing it the old way is the bug being
    // fixed. Two divergences, both intended:
    //
    //   (a) the own token is now matched CONTRACT-FIRST, so a project whose
    //       ticker changed — or whose provider reports a stale symbol — is
    //       recognised where the symbol-only classifier missed it entirely;
    //   (b) the own-token check now runs BEFORE the stablecoin check, so a
    //       stablecoin issuer's own stable counts as concentrated rather than
    //       as spendable reserves.
    //
    // In the happy path where the symbol matches and is not a stable, the two
    // still agree — asserted here so the divergence stays a known, narrow one.
    const legacy = legacyClassifyTokens(realistic, "UNI");
    const derived = bucketsToLegacyColumns(
      composeTreasury([{ chain: "ethereum", tokens: asStored }], { tokenSymbol: "UNI" })
    );
    expect(derived.nativeTokenUsd).toBeCloseTo(legacy.nativeTokenUsd, 6);

    // (a) Contract match under a renamed ticker: legacy calls it "other".
    const renamed = [{ symbol: "OLDTICKER", contractAddress: OWN_CONTRACT, valueUsd: 900 }];
    const derivedRenamed = bucketsToLegacyColumns(
      composeTreasury([{ chain: "ethereum", tokens: renamed }], {
        tokenSymbol: "UNI",
        tokenContract: OWN_CONTRACT,
      })
    );
    const legacyRenamed = legacyClassifyTokens(
      [{ symbol: "OLDTICKER", value_usd: 900 }],
      "UNI"
    );
    expect(derivedRenamed.nativeTokenUsd).toBe(900);
    expect(legacyRenamed.nativeTokenUsd).toBe(0);
    expect(legacyRenamed.otherAssetsUsd).toBe(900);

    // (b) An own token that is itself a stablecoin.
    const ownStable = [{ symbol: "FRAX", valueUsd: 5_000 }];
    const derivedStable = bucketsToLegacyColumns(
      composeTreasury([{ chain: "ethereum", tokens: ownStable }], { tokenSymbol: "FRAX" })
    );
    expect(derivedStable.nativeTokenUsd).toBe(5_000);
    expect(derivedStable.stablecoinsUsd).toBe(0);
    expect(legacyClassifyTokens([{ symbol: "FRAX", value_usd: 5_000 }], "FRAX").stablecoinsUsd)
      .toBe(5_000);
  });

  it("reproduces the frozen-column bug when the project token symbol is absent", () => {
    // The fixture's actual sync-time state: `projects.token_symbol` was NULL,
    // so the own-token bucket froze at $0.00 and $1.06B of UNI was written into
    // `other_assets_usd`. Both classifiers agree on that, which is precisely
    // why the fix had to move to READ time — no column recomputation can
    // recover data the project had not entered yet.
    const legacy = legacyClassifyTokens(realistic, null);
    const derived = bucketsToLegacyColumns(
      composeTreasury([{ chain: "ethereum", tokens: asStored }], { tokenSymbol: null })
    );
    expect(derived.nativeTokenUsd).toBe(0);
    expect(legacy.nativeTokenUsd).toBe(0);
    expect(derived.otherAssetsUsd).toBeCloseTo(legacy.otherAssetsUsd, 6);
    expect(derived.otherAssetsUsd).toBeGreaterThan(1_000_000_000);

    // ...and the read-time classifier gets it right on the same stored bytes
    // once the symbol exists, with no re-sync.
    const fixed = composeTreasury([{ chain: "ethereum", tokens: asStored }], {
      tokenSymbol: "UNI",
    });
    expect(fixed.concentratedUsd).toBeCloseTo(1_055_778_968.2695498, 4);
  });

  it("routes a non-ETH gas asset to otherAssetsUsd, matching the legacy schema", () => {
    // The legacy columns have no bucket for MATIC, so the projection must put
    // it in `otherAssetsUsd` even though the classifier now calls it liquid.
    const c = composeTreasury(
      [{ chain: "polygon", tokens: [{ symbol: "MATIC", valueUsd: 250_000 }] }],
      {}
    );
    expect(c.liquidCryptoUsd).toBe(250_000);
    expect(bucketsToLegacyColumns(c)).toEqual({
      stablecoinsUsd: 0,
      ethUsd: 0,
      nativeTokenUsd: 0,
      otherAssetsUsd: 250_000,
    });
  });
});

// ─── the shared donut slices ───────────────────────────────────────────────

describe("compositionSlices", () => {
  it("labels the own-token slice with the project's ticker", () => {
    const c = composeTreasury(
      [wallet("ethereum", [{ symbol: "UNI", valueUsd: 100 }])],
      { tokenSymbol: "UNI" }
    );
    expect(compositionSlices(c, { tokenSymbol: "UNI" }).map((s) => s.label)).toEqual([
      "Stablecoins",
      "Liquid crypto",
      "UNI",
      "Other assets",
    ]);
  });

  it("falls back to a generic label when the project tracks no token", () => {
    const c = composeTreasury([], null);
    expect(compositionSlices(c, null)[2].label).toBe("Own token");
    expect(compositionSlices(c, { tokenSymbol: "   " })[2].label).toBe("Own token");
  });

  it("returns slices unfiltered so each surface keeps its own zero policy", () => {
    const c = composeTreasury(
      [wallet("ethereum", [{ symbol: "USDC", valueUsd: 100 }])],
      null
    );
    expect(compositionSlices(c, null)).toHaveLength(4);
    expect(compositionSlices(c, null).filter((s) => s.value > 0)).toHaveLength(1);
  });
});
