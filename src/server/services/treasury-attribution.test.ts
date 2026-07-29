import { describe, it, expect } from "vitest";
import {
  attributeTreasuryChange,
  dominantDriver,
  reconcileWithNetFlow,
  type TreasuryAttribution,
} from "./treasury-attribution";

const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const WALLET_A = "0xAaA1111111111111111111111111111111111111";
const WALLET_B = "0xBbB2222222222222222222222222222222222222";
const SOL_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

interface TokenFixture {
  symbol: string;
  amount: number;
  priceUsd: number;
  contractAddress?: string | null;
  /** Defaults to amount x priceUsd, matching how Dune reports it. */
  valueUsd?: number;
}

function wallet(chain: string, tokens: TokenFixture[], walletAddress = WALLET_A) {
  return {
    walletAddress,
    chain,
    tokens: tokens.map((t) => ({
      symbol: t.symbol,
      name: t.symbol,
      amount: t.amount,
      priceUsd: t.priceUsd,
      valueUsd: t.valueUsd ?? t.amount * t.priceUsd,
      contractAddress: t.contractAddress ?? null,
    })),
  };
}

/** The invariant the whole module rests on. */
function expectIdentity(a: TreasuryAttribution) {
  expect(
    a.flowUsd + a.priceEffectUsd + a.crossUsd + a.walletSetUsd + a.unpricedUsd
  ).toBeCloseTo(a.deltaUsd, 6);
  expect(a.valueCurrUsd - a.valuePrevUsd).toBeCloseTo(a.deltaUsd, 6);
  for (const t of a.tokens) {
    expect(
      t.flowUsd + t.priceEffectUsd + t.crossUsd + t.walletSetUsd + t.unpricedUsd
    ).toBeCloseTo(t.deltaUsd, 6);
    expect(t.valueCurrUsd - t.valuePrevUsd).toBeCloseTo(t.deltaUsd, 6);
  }
}

describe("attributeTreasuryChange — malformed input", () => {
  it("returns an empty result for non-array input instead of throwing", () => {
    for (const bad of [null, undefined, {}, "garbage", 42]) {
      const a = attributeTreasuryChange(bad, bad);
      expect(a.tokens).toEqual([]);
      expect(a.deltaUsd).toBe(0);
      expect(a.walletSetChanged).toBe(false);
    }
  });

  it("claims no flow when one side's payload is unusable", () => {
    // An unreadable prev has no wallet set to compare against, so nothing can
    // honestly be called an inflow — it lands in the coverage bucket instead.
    const curr = [wallet("base", [{ symbol: "USDC", amount: 100, priceUsd: 1, contractAddress: USDC }])];
    const a = attributeTreasuryChange(null, curr);
    expect(a.deltaUsd).toBeCloseTo(100, 6);
    expect(a.flowUsd).toBe(0);
    expect(a.walletSetUsd).toBeCloseTo(100, 6);
    expect(a.walletSetChanged).toBe(true);
    expectIdentity(a);
  });

  it("skips wallets with a missing or non-array tokens field", () => {
    const detail = [
      { walletAddress: WALLET_A, chain: "base" },
      { walletAddress: WALLET_A, chain: "base", tokens: null },
      null,
    ];
    expect(attributeTreasuryChange(detail, detail).tokens).toEqual([]);
  });

  it("treats missing numeric fields as zero rather than NaN", () => {
    const prev = [
      {
        walletAddress: WALLET_A,
        chain: "base",
        tokens: [{ symbol: "AERO", contractAddress: AERO }],
      },
    ];
    const curr = [wallet("base", [{ symbol: "AERO", amount: 10, priceUsd: 1, contractAddress: AERO }])];
    const a = attributeTreasuryChange(prev, curr);
    expect(Number.isNaN(a.deltaUsd)).toBe(false);
    expect(a.walletSetChanged).toBe(false);
    expect(a.flowUsd).toBeCloseTo(10, 6);
  });

  it("ignores tokens with neither a symbol nor a contract address", () => {
    const detail = [{ walletAddress: WALLET_A, chain: "base", tokens: [{ amount: 5, priceUsd: 2 }] }];
    expect(attributeTreasuryChange(detail, detail).tokens).toEqual([]);
  });

  it("compares legacy payloads that carry no walletAddress at all", () => {
    // Old snapshots predate the field. What matters is that they do not all
    // read as simultaneously added and removed.
    const prev = [{ chain: "base", tokens: [{ symbol: "USDC", amount: 100, priceUsd: 1, contractAddress: USDC }] }];
    const curr = [{ chain: "base", tokens: [{ symbol: "USDC", amount: 300, priceUsd: 1, contractAddress: USDC }] }];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.walletSetChanged).toBe(false);
    expect(a.flowUsd).toBeCloseTo(200, 6);
  });
});

describe("attributeTreasuryChange — the flow/price/cross identity", () => {
  it("holds across a mixed portfolio of every edge case at once", () => {
    const prev = [
      wallet("base", [
        { symbol: "AERO", amount: 1000, priceUsd: 1.2, contractAddress: AERO },
        { symbol: "USDC", amount: 500_000, priceUsd: 1, contractAddress: USDC },
        { symbol: "EXITED", amount: 42, priceUsd: 7.5, contractAddress: "0xexited" },
        { symbol: "NOPRICE", amount: 900, priceUsd: 0, valueUsd: 0, contractAddress: "0xnoprice" },
      ]),
      wallet("ethereum", [{ symbol: "ETH", amount: 10, priceUsd: 3000 }]),
    ];
    const curr = [
      wallet("base", [
        { symbol: "AERO", amount: 1500, priceUsd: 2.4, contractAddress: AERO },
        { symbol: "USDC", amount: 300_000, priceUsd: 1, contractAddress: USDC },
        { symbol: "NEW", amount: 7, priceUsd: 200, contractAddress: "0xnew" },
        { symbol: "NOPRICE", amount: 900, priceUsd: 3, valueUsd: 2700, contractAddress: "0xnoprice" },
      ]),
      wallet("ethereum", [{ symbol: "ETH", amount: 10, priceUsd: 3400 }]),
    ];

    const a = attributeTreasuryChange(prev, curr);
    expectIdentity(a);
    expect(a.tokens).toHaveLength(6);
    expect(a.walletSetChanged).toBe(false);
  });

  it("holds with an added wallet, a removed wallet and price moves in the mix", () => {
    const prev = [
      wallet("base", [
        { symbol: "AERO", amount: 1000, priceUsd: 1.2, contractAddress: AERO },
        { symbol: "USDC", amount: 500_000, priceUsd: 1, contractAddress: USDC },
      ]),
      wallet("base", [{ symbol: "USDC", amount: 250_000, priceUsd: 1, contractAddress: USDC }], WALLET_B),
      wallet("solana", [{ symbol: "SOL", amount: 100, priceUsd: 150 }], SOL_WALLET),
    ];
    const curr = [
      wallet("base", [
        { symbol: "AERO", amount: 1500, priceUsd: 2.4, contractAddress: AERO },
        { symbol: "USDC", amount: 400_000, priceUsd: 1, contractAddress: USDC },
        { symbol: "NOPRICE", amount: 900, priceUsd: 0, valueUsd: 0, contractAddress: "0xnoprice" },
      ]),
      wallet("solana", [{ symbol: "SOL", amount: 120, priceUsd: 180 }], SOL_WALLET),
    ];

    const a = attributeTreasuryChange(prev, curr);
    expectIdentity(a);
    expect(a.walletSetChanged).toBe(true);
    expect(a.removedWallets).toEqual([WALLET_B]);
    expect(a.addedWallets).toEqual([]);
  });

  it("holds for two identical snapshots (everything is zero)", () => {
    const detail = [wallet("base", [{ symbol: "AERO", amount: 1000, priceUsd: 1.2, contractAddress: AERO }])];
    const a = attributeTreasuryChange(detail, detail);
    expectIdentity(a);
    expect(a.deltaUsd).toBe(0);
    expect(a.flowUsd).toBe(0);
    expect(a.priceEffectUsd).toBe(0);
    expect(a.crossUsd).toBe(0);
    expect(a.walletSetUsd).toBe(0);
  });
});

describe("attributeTreasuryChange — separating flow from price", () => {
  it("reports a pure price move with zero flow", () => {
    const prev = [wallet("base", [{ symbol: "AERO", amount: 1000, priceUsd: 1, contractAddress: AERO }])];
    const curr = [wallet("base", [{ symbol: "AERO", amount: 1000, priceUsd: 3, contractAddress: AERO }])];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBe(0);
    expect(a.priceEffectUsd).toBeCloseTo(2000, 6);
    expect(a.crossUsd).toBe(0);
    expectIdentity(a);
  });

  it("reports a pure inflow with zero price effect", () => {
    const prev = [wallet("base", [{ symbol: "USDC", amount: 100_000, priceUsd: 1, contractAddress: USDC }])];
    const curr = [wallet("base", [{ symbol: "USDC", amount: 250_000, priceUsd: 1, contractAddress: USDC }])];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBeCloseTo(150_000, 6);
    expect(a.priceEffectUsd).toBe(0);
    expect(a.crossUsd).toBe(0);
    expectIdentity(a);
  });

  it("reports the cross term separately instead of folding it into flow or price", () => {
    // 1000 -> 1500 units, $1 -> $3. flow 500, price 2000, cross 1000.
    const prev = [wallet("base", [{ symbol: "AERO", amount: 1000, priceUsd: 1, contractAddress: AERO }])];
    const curr = [wallet("base", [{ symbol: "AERO", amount: 1500, priceUsd: 3, contractAddress: AERO }])];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBeCloseTo(500, 6);
    expect(a.priceEffectUsd).toBeCloseTo(2000, 6);
    expect(a.crossUsd).toBeCloseTo(1000, 6);
    expect(a.deltaUsd).toBeCloseTo(3500, 6);
    expectIdentity(a);
  });
});

describe("attributeTreasuryChange — position lifecycle", () => {
  // Keeps the wallet present on both sides, so a token appearing or vanishing
  // is a position change and not a coverage change.
  const anchor: TokenFixture = { symbol: "USDC", amount: 1000, priceUsd: 1, contractAddress: USDC };

  it("treats a token only in curr as pure flow at its current price", () => {
    const prev = [wallet("base", [anchor])];
    const curr = [
      wallet("base", [anchor, { symbol: "NEW", amount: 7, priceUsd: 200, contractAddress: "0xnew" }]),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBeCloseTo(1400, 6);
    expect(a.priceEffectUsd).toBe(0);
    expect(a.crossUsd).toBe(0);
    expect(a.walletSetUsd).toBe(0);
    expectIdentity(a);
  });

  it("treats a token only in prev as pure negative flow at its prior price", () => {
    const prev = [
      wallet("base", [anchor, { symbol: "OLD", amount: 42, priceUsd: 7.5, contractAddress: "0xold" }]),
    ];
    const curr = [wallet("base", [anchor])];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBeCloseTo(-315, 6);
    expect(a.priceEffectUsd).toBe(0);
    expect(a.crossUsd).toBe(0);
    expectIdentity(a);
  });

  it("treats a zero-quantity prev row the same as the token being absent", () => {
    const curr = [
      wallet("base", [anchor, { symbol: "AERO", amount: 100, priceUsd: 3, contractAddress: AERO }]),
    ];
    const fromZero = attributeTreasuryChange(
      [wallet("base", [anchor, { symbol: "AERO", amount: 0, priceUsd: 1, contractAddress: AERO }])],
      curr
    );
    const fromAbsent = attributeTreasuryChange([wallet("base", [anchor])], curr);
    expect(fromZero.flowUsd).toBeCloseTo(fromAbsent.flowUsd, 6);
    expect(fromZero.priceEffectUsd).toBe(0);
    expect(fromZero.crossUsd).toBe(0);
    expectIdentity(fromZero);
  });

  it("treats a zero-quantity curr row as a full exit", () => {
    const prev = [wallet("base", [{ symbol: "AERO", amount: 100, priceUsd: 2, contractAddress: AERO }])];
    const curr = [wallet("base", [{ symbol: "AERO", amount: 0, priceUsd: 5, contractAddress: AERO }])];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBeCloseTo(-200, 6);
    expect(a.priceEffectUsd).toBe(0);
    expect(a.crossUsd).toBe(0);
    expectIdentity(a);
  });

  it("produces all zeros for a token held at zero quantity on both sides", () => {
    const detail = [wallet("base", [{ symbol: "DUST", amount: 0, priceUsd: 0, contractAddress: "0xdust" }])];
    const a = attributeTreasuryChange(detail, detail);
    expect(a.tokens).toHaveLength(1);
    expect(a.tokens[0].priced).toBe(true);
    expect(a.deltaUsd).toBe(0);
  });
});

describe("attributeTreasuryChange — priceUsd 0 means unknown, not free", () => {
  it("does not report a 0 -> 1500 quote as a price gain", () => {
    const prev = [
      wallet("ethereum", [{ symbol: "WEIRD", amount: 100, priceUsd: 0, valueUsd: 0, contractAddress: "0xweird" }]),
    ];
    const curr = [
      wallet("ethereum", [{ symbol: "WEIRD", amount: 100, priceUsd: 1500, valueUsd: 150_000, contractAddress: "0xweird" }]),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.priceEffectUsd).toBe(0);
    expect(a.crossUsd).toBe(0);
    expect(a.flowUsd).toBe(0);
    expect(a.unpricedUsd).toBeCloseTo(150_000, 6);
    expect(a.tokens[0].priced).toBe(false);
    expectIdentity(a);
  });

  it("routes a token unpriced on both sides into the unpriced bucket", () => {
    const prev = [wallet("base", [{ symbol: "NOPRICE", amount: 900, priceUsd: 0, valueUsd: 0, contractAddress: "0xnp" }])];
    const curr = [wallet("base", [{ symbol: "NOPRICE", amount: 1200, priceUsd: 0, valueUsd: 0, contractAddress: "0xnp" }])];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.tokens[0].priced).toBe(false);
    expect(a.flowUsd).toBe(0);
    expect(a.unpricedUsd).toBe(0);
    expectIdentity(a);
  });

  it("still values a brand-new position whose prev price is simply absent", () => {
    // No prev holding at all, so there is no unknown prior price to miss.
    const anchor: TokenFixture = { symbol: "USDC", amount: 1, priceUsd: 1, contractAddress: USDC };
    const prev = [wallet("base", [anchor])];
    const curr = [
      wallet("base", [anchor, { symbol: "NEW", amount: 10, priceUsd: 50, contractAddress: "0xnew2" }]),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.tokens[0].symbol).toBe("NEW");
    expect(a.tokens[0].priced).toBe(true);
    expect(a.unpricedUsd).toBe(0);
  });

  it("keeps a real price when one wallet of the same snapshot reports 0", () => {
    const prev = [
      wallet("base", [{ symbol: "AERO", amount: 100, priceUsd: 0, valueUsd: 0, contractAddress: AERO }], WALLET_A),
      wallet("base", [{ symbol: "AERO", amount: 100, priceUsd: 2, contractAddress: AERO }], WALLET_B),
    ];
    const curr = [
      wallet("base", [{ symbol: "AERO", amount: 100, priceUsd: 3, contractAddress: AERO }], WALLET_A),
      wallet("base", [{ symbol: "AERO", amount: 100, priceUsd: 3, contractAddress: AERO }], WALLET_B),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.tokens[0].priced).toBe(true);
    expect(a.tokens[0].pricePrev).toBe(2);
    expect(a.flowUsd).toBe(0);
    expect(a.priceEffectUsd).toBeCloseTo(200, 6);
  });
});

describe("attributeTreasuryChange — wallet set changes", () => {
  it("does not report a newly tracked wallet's holdings as an inflow", () => {
    const prev = [wallet("base", [{ symbol: "USDC", amount: 100_000, priceUsd: 1, contractAddress: USDC }])];
    const curr = [
      wallet("base", [{ symbol: "USDC", amount: 100_000, priceUsd: 1, contractAddress: USDC }]),
      wallet("base", [{ symbol: "USDC", amount: 5_000_000, priceUsd: 1, contractAddress: USDC }], WALLET_B),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBe(0);
    expect(a.walletSetUsd).toBeCloseTo(5_000_000, 6);
    expect(a.deltaUsd).toBeCloseTo(5_000_000, 6);
    expect(a.walletSetChanged).toBe(true);
    expect(a.addedWallets).toEqual([WALLET_B]);
    expect(a.removedWallets).toEqual([]);
    expectIdentity(a);
  });

  it("does not report a removed wallet's holdings as an outflow", () => {
    const prev = [
      wallet("base", [{ symbol: "USDC", amount: 100_000, priceUsd: 1, contractAddress: USDC }]),
      wallet("base", [{ symbol: "USDC", amount: 5_000_000, priceUsd: 1, contractAddress: USDC }], WALLET_B),
    ];
    const curr = [wallet("base", [{ symbol: "USDC", amount: 100_000, priceUsd: 1, contractAddress: USDC }])];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBe(0);
    expect(a.walletSetUsd).toBeCloseTo(-5_000_000, 6);
    expect(a.walletSetChanged).toBe(true);
    expect(a.removedWallets).toEqual([WALLET_B]);
    expectIdentity(a);
  });

  it("reports a wallet that failed to sync as removed, not as a drawdown", () => {
    // wallet-sync drops a failed wallet from balancesDetail entirely and
    // records it in `warnings` — from here it is indistinguishable from an
    // untracked wallet, which is exactly why it must not become an outflow.
    const prev = [
      wallet("ethereum", [{ symbol: "ETH", amount: 100, priceUsd: 3000 }]),
      wallet("solana", [{ symbol: "SOL", amount: 10_000, priceUsd: 150 }], SOL_WALLET),
    ];
    const curr = [wallet("ethereum", [{ symbol: "ETH", amount: 100, priceUsd: 3000 }])];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBe(0);
    expect(a.priceEffectUsd).toBe(0);
    expect(a.walletSetUsd).toBeCloseTo(-1_500_000, 6);
    expect(a.removedWallets).toEqual([SOL_WALLET]);
    expectIdentity(a);
  });

  it("still attributes real flow in the continuing wallets when another is added", () => {
    const prev = [wallet("base", [{ symbol: "USDC", amount: 100_000, priceUsd: 1, contractAddress: USDC }])];
    const curr = [
      wallet("base", [{ symbol: "USDC", amount: 300_000, priceUsd: 1, contractAddress: USDC }]),
      wallet("base", [{ symbol: "USDC", amount: 5_000_000, priceUsd: 1, contractAddress: USDC }], WALLET_B),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBeCloseTo(200_000, 6);
    expect(a.walletSetUsd).toBeCloseTo(5_000_000, 6);
    expectIdentity(a);
  });

  it("keeps price attribution on the continuing wallets when another is added", () => {
    const prev = [wallet("base", [{ symbol: "AERO", amount: 1000, priceUsd: 1, contractAddress: AERO }])];
    const curr = [
      wallet("base", [{ symbol: "AERO", amount: 1000, priceUsd: 3, contractAddress: AERO }]),
      wallet("base", [{ symbol: "AERO", amount: 500, priceUsd: 3, contractAddress: AERO }], WALLET_B),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBe(0);
    expect(a.priceEffectUsd).toBeCloseTo(2000, 6);
    expect(a.walletSetUsd).toBeCloseTo(1500, 6);
    expectIdentity(a);
  });

  it("matches EVM wallet addresses case-insensitively", () => {
    const prev = [wallet("base", [{ symbol: "USDC", amount: 100, priceUsd: 1, contractAddress: USDC }], WALLET_A)];
    const curr = [
      wallet("base", [{ symbol: "USDC", amount: 300, priceUsd: 1, contractAddress: USDC }], WALLET_A.toLowerCase()),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.walletSetChanged).toBe(false);
    expect(a.flowUsd).toBeCloseTo(200, 6);
  });

  it("treats Solana addresses as case-sensitive", () => {
    // base58 is case-sensitive, so a differently-cased string is a different
    // wallet and must not be silently matched.
    const prev = [wallet("solana", [{ symbol: "SOL", amount: 10, priceUsd: 150 }], SOL_WALLET)];
    const curr = [
      wallet("solana", [{ symbol: "SOL", amount: 10, priceUsd: 150 }], SOL_WALLET.toLowerCase()),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.walletSetChanged).toBe(true);
    expect(a.flowUsd).toBe(0);
  });

  it("counts the same address on a new chain as added coverage", () => {
    const prev = [wallet("base", [{ symbol: "USDC", amount: 100, priceUsd: 1, contractAddress: USDC }])];
    const curr = [
      wallet("base", [{ symbol: "USDC", amount: 100, priceUsd: 1, contractAddress: USDC }]),
      wallet("arbitrum", [{ symbol: "ARB", amount: 500, priceUsd: 2, contractAddress: "0xarb" }]),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.walletSetChanged).toBe(true);
    expect(a.addedWallets).toEqual([WALLET_A]);
    expect(a.flowUsd).toBe(0);
    expect(a.walletSetUsd).toBeCloseTo(1000, 6);
  });

  it("reports no wallet change when both snapshots cover the same set", () => {
    const detail = [
      wallet("base", [{ symbol: "USDC", amount: 100, priceUsd: 1, contractAddress: USDC }]),
      wallet("solana", [{ symbol: "SOL", amount: 10, priceUsd: 150 }], SOL_WALLET),
    ];
    const a = attributeTreasuryChange(detail, detail);
    expect(a.walletSetChanged).toBe(false);
    expect(a.addedWallets).toEqual([]);
    expect(a.removedWallets).toEqual([]);
  });
});

describe("attributeTreasuryChange — token identity", () => {
  it("matches the same contract across snapshots regardless of address casing", () => {
    const prev = [wallet("base", [{ symbol: "AERO", amount: 100, priceUsd: 1, contractAddress: AERO.toLowerCase() }])];
    const curr = [wallet("base", [{ symbol: "AERO", amount: 100, priceUsd: 2, contractAddress: AERO.toUpperCase() }])];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.tokens).toHaveLength(1);
    expect(a.priceEffectUsd).toBeCloseTo(100, 6);
  });

  it("keeps same-symbol native assets on different chains apart", () => {
    // Both contractAddress null, both symbol ETH — symbol-only keying would
    // merge an L1 and an L2 position into one nonsense row.
    const prev = [
      wallet("ethereum", [{ symbol: "ETH", amount: 10, priceUsd: 3000 }]),
      wallet("base", [{ symbol: "ETH", amount: 5, priceUsd: 3000 }]),
    ];
    const curr = [
      wallet("ethereum", [{ symbol: "ETH", amount: 10, priceUsd: 3000 }]),
      wallet("base", [{ symbol: "ETH", amount: 20, priceUsd: 3000 }]),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.tokens).toHaveLength(2);
    expect(a.tokens.map((t) => t.chain).sort()).toEqual(["base", "ethereum"]);
    expect(a.flowUsd).toBeCloseTo(45_000, 6);
  });

  it("sums quantities for one token held across several wallets", () => {
    const prev = [
      wallet("base", [{ symbol: "USDC", amount: 100, priceUsd: 1, contractAddress: USDC }], WALLET_A),
      wallet("base", [{ symbol: "USDC", amount: 400, priceUsd: 1, contractAddress: USDC }], WALLET_B),
    ];
    const curr = [
      wallet("base", [{ symbol: "USDC", amount: 500, priceUsd: 1, contractAddress: USDC }], WALLET_A),
      wallet("base", [{ symbol: "USDC", amount: 400, priceUsd: 1, contractAddress: USDC }], WALLET_B),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.tokens).toHaveLength(1);
    expect(a.tokens[0].qtyPrev).toBe(500);
    expect(a.tokens[0].qtyCurr).toBe(900);
    expect(a.flowUsd).toBeCloseTo(400, 6);
  });
});

describe("attributeTreasuryChange — ordering", () => {
  it("sorts tokens by absolute impact so the top contributors come first", () => {
    const prev = [
      wallet("base", [
        { symbol: "AERO", amount: 1000, priceUsd: 1, contractAddress: AERO },
        { symbol: "USDC", amount: 5000, priceUsd: 1, contractAddress: USDC },
        { symbol: "DUST", amount: 1, priceUsd: 1, contractAddress: "0xdust" },
      ]),
    ];
    const curr = [
      wallet("base", [
        { symbol: "AERO", amount: 1000, priceUsd: 11, contractAddress: AERO },
        { symbol: "USDC", amount: 1000, priceUsd: 1, contractAddress: USDC },
        { symbol: "DUST", amount: 2, priceUsd: 1, contractAddress: "0xdust" },
      ]),
    ];
    // +10,000 (price), -4,000 (outflow), +1 — the -4,000 must outrank the +1.
    expect(attributeTreasuryChange(prev, curr).tokens.map((t) => t.symbol)).toEqual([
      "AERO",
      "USDC",
      "DUST",
    ]);
  });
});

describe("dominantDriver", () => {
  it("names price when a token pump, not an inflow, moved the treasury", () => {
    const prev = [wallet("base", [{ symbol: "AERO", amount: 1_000_000, priceUsd: 1, contractAddress: AERO }])];
    const curr = [wallet("base", [{ symbol: "AERO", amount: 1_000_000, priceUsd: 11, contractAddress: AERO }])];
    const d = dominantDriver(attributeTreasuryChange(prev, curr));
    expect(d.driver).toBe("price");
    expect(d.usd).toBeCloseTo(10_000_000, 6);
    expect(d.share).toBe(1);
  });

  it("names flow when money actually moved", () => {
    const prev = [wallet("base", [{ symbol: "USDC", amount: 1_000_000, priceUsd: 1, contractAddress: USDC }])];
    const curr = [wallet("base", [{ symbol: "USDC", amount: 3_000_000, priceUsd: 1, contractAddress: USDC }])];
    const d = dominantDriver(attributeTreasuryChange(prev, curr));
    expect(d.driver).toBe("flow");
    expect(d.usd).toBeCloseTo(2_000_000, 6);
  });

  it("names walletSet when the treasury only grew by tracking more wallets", () => {
    const prev = [wallet("base", [{ symbol: "USDC", amount: 100_000, priceUsd: 1, contractAddress: USDC }])];
    const curr = [
      wallet("base", [{ symbol: "USDC", amount: 100_000, priceUsd: 1, contractAddress: USDC }]),
      wallet("base", [{ symbol: "USDC", amount: 9_000_000, priceUsd: 1, contractAddress: USDC }], WALLET_B),
    ];
    expect(dominantDriver(attributeTreasuryChange(prev, curr)).driver).toBe("walletSet");
  });

  it("stays sane when a large inflow is cancelled by a price drawdown", () => {
    // Net delta near zero, but the components are individually huge — a
    // share measured against the net delta would explode here.
    const prev = [wallet("base", [{ symbol: "AERO", amount: 1_000_000, priceUsd: 10, contractAddress: AERO }])];
    const curr = [wallet("base", [{ symbol: "AERO", amount: 3_000_000, priceUsd: 5, contractAddress: AERO }])];
    const a = attributeTreasuryChange(prev, curr);
    const d = dominantDriver(a);
    expect(d.share).toBeGreaterThan(0);
    expect(d.share).toBeLessThanOrEqual(1);
    expect(Number.isFinite(d.usd)).toBe(true);
    expectIdentity(a);
  });

  it("reports 'none' when nothing changed at all", () => {
    expect(dominantDriver(attributeTreasuryChange([], []))).toEqual({
      driver: "none",
      usd: 0,
      share: 0,
    });
  });

  it("can name 'unpriced' so the caller discloses rather than narrates", () => {
    const prev = [wallet("base", [{ symbol: "X", amount: 100, priceUsd: 0, valueUsd: 0, contractAddress: "0xx" }])];
    const curr = [wallet("base", [{ symbol: "X", amount: 100, priceUsd: 40, valueUsd: 4000, contractAddress: "0xx" }])];
    expect(dominantDriver(attributeTreasuryChange(prev, curr)).driver).toBe("unpriced");
  });
});

describe("reconcileWithNetFlow", () => {
  /** Builds an attribution whose flowUsd is exactly `flowUsd`. */
  function withFlow(flowUsd: number): TreasuryAttribution {
    const prev = [wallet("base", [{ symbol: "USDC", amount: 1_000_000, priceUsd: 1, contractAddress: USDC }])];
    const curr = [
      wallet("base", [{ symbol: "USDC", amount: 1_000_000 + flowUsd, priceUsd: 1, contractAddress: USDC }]),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.flowUsd).toBeCloseTo(flowUsd, 6);
    return a;
  }

  it("reports consistent when the two independent estimates agree", () => {
    const r = reconcileWithNetFlow(withFlow(200_000), 195_000);
    expect(r.verdict).toBe("consistent");
    expect(r.divergenceUsd).toBeCloseTo(5_000, 6);
    expect(r.divergencePct).toBeCloseTo(0.025, 6);
  });

  it("reports diverging when the transactions do not support the balance change", () => {
    const r = reconcileWithNetFlow(withFlow(2_000_000), 200_000);
    expect(r.verdict).toBe("diverging");
    expect(r.divergenceUsd).toBeCloseTo(1_800_000, 6);
    expect(r.divergencePct).toBeCloseTo(0.9, 6);
  });

  it("reports diverging when the two estimates disagree on direction", () => {
    const r = reconcileWithNetFlow(withFlow(500_000), -500_000);
    expect(r.verdict).toBe("diverging");
    expect(r.divergencePct).toBeCloseTo(2, 6);
  });

  it("signs divergenceUsd as balance-derived minus transaction-derived", () => {
    expect(reconcileWithNetFlow(withFlow(100_000), 400_000).divergenceUsd).toBeCloseTo(
      -300_000,
      6
    );
  });

  it("is unavailable when netFlowUsd is null", () => {
    expect(reconcileWithNetFlow(withFlow(200_000), null)).toEqual({
      divergenceUsd: 0,
      divergencePct: null,
      verdict: "unavailable",
    });
  });

  it("is unavailable when netFlowUsd is not a finite number", () => {
    expect(reconcileWithNetFlow(withFlow(200_000), NaN).verdict).toBe("unavailable");
    expect(reconcileWithNetFlow(withFlow(200_000), Infinity).verdict).toBe("unavailable");
  });

  it("is unavailable when the wallet set changed, since the two then measure different things", () => {
    const prev = [wallet("base", [{ symbol: "USDC", amount: 1_000_000, priceUsd: 1, contractAddress: USDC }])];
    const curr = [
      wallet("base", [{ symbol: "USDC", amount: 1_200_000, priceUsd: 1, contractAddress: USDC }]),
      wallet("base", [{ symbol: "USDC", amount: 8_000_000, priceUsd: 1, contractAddress: USDC }], WALLET_B),
    ];
    const a = attributeTreasuryChange(prev, curr);
    expect(a.walletSetChanged).toBe(true);
    expect(reconcileWithNetFlow(a, 200_000).verdict).toBe("unavailable");
  });

  it("is unavailable below the noise floor instead of returning Infinity or NaN", () => {
    const r = reconcileWithNetFlow(withFlow(400), 350);
    expect(r.verdict).toBe("unavailable");
    expect(r.divergencePct).toBeNull();
    expect(Number.isFinite(r.divergenceUsd)).toBe(true);
  });

  it("does not divide by zero when one side is exactly zero", () => {
    const r = reconcileWithNetFlow(withFlow(500_000), 0);
    expect(Number.isFinite(r.divergencePct ?? 0)).toBe(true);
    expect(r.divergencePct).toBeCloseTo(1, 6);
    expect(r.verdict).toBe("diverging");

    const bothZero = reconcileWithNetFlow(attributeTreasuryChange([], []), 0);
    expect(bothZero.verdict).toBe("unavailable");
    expect(bothZero.divergencePct).toBeNull();
  });
});
