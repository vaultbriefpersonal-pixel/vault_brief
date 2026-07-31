import { describe, it, expect } from "vitest";
import {
  priceReconstruction,
  reconstructBalances,
  reconstructionSymbols,
  MAX_UNPRICED_SHARE_FOR_COMPARISON,
  type ReconstructionTransfer,
} from "./balance-reconstruction";

const WALLET = "0xTreasury";
const OTHER_WALLET = "0xOps";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const OWN = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
const SPOOF = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefd";

interface TokenSpec {
  symbol: string;
  amount: number;
  price?: number;
  contract?: string | null;
}

function wallet(
  tokens: TokenSpec[],
  address = WALLET,
  chain = "ethereum"
) {
  return {
    walletAddress: address,
    chain,
    tokens: tokens.map((t) => ({
      symbol: t.symbol,
      name: t.symbol,
      amount: t.amount,
      priceUsd: t.price ?? 1,
      valueUsd: t.amount * (t.price ?? 1),
      contractAddress: t.contract ?? null,
    })),
  };
}

function leg(
  partial: Partial<ReconstructionTransfer> & {
    symbol: string;
    amount: number;
    direction: "in" | "out";
  }
): ReconstructionTransfer {
  return {
    chain: "ethereum",
    wallet: WALLET,
    contractAddress: null,
    ...partial,
  };
}

/** The standard framing: one walk-back step off a live read on 2026-04-30. */
function walk(
  balances: unknown,
  transfers: ReconstructionTransfer[],
  overrides: Partial<Parameters<typeof reconstructBalances>[0]> = {}
) {
  return reconstructBalances({
    balances,
    transfers,
    asOf: "2026-03-31",
    observedAsOf: "2026-04-30",
    stepsFromObserved: 1,
    ...overrides,
  });
}

/** Every token of the first (or named) reconstructed wallet, by symbol. */
function amounts(
  result: ReturnType<typeof reconstructBalances>,
  address = WALLET
): Record<string, number> {
  const w = result.wallets.find((x) => x.walletAddress === address);
  const out: Record<string, number> = {};
  for (const t of w?.tokens ?? []) out[t.symbol] = t.amount;
  return out;
}

// ─── the arithmetic ────────────────────────────────────────────────────────

describe("reconstructBalances — the walk-back", () => {
  it("subtracts inbound and adds outbound: qty(t-1) = qty(t) - in + out", () => {
    // Ended April with 1,000 USDC. During April 300 arrived and 100 left.
    // So March closed at 1000 - 300 + 100 = 800.
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000 }])],
      [
        leg({ symbol: "USDC", amount: 300, direction: "in" }),
        leg({ symbol: "USDC", amount: 100, direction: "out" }),
      ]
    );
    expect(amounts(result).USDC).toBe(800);
  });

  it("is NOT the inverse — an inbound-only period walks the balance DOWN", () => {
    // The single most likely way to get this backwards. A wallet that only
    // received money held LESS before, never more.
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000 }])],
      [leg({ symbol: "USDC", amount: 400, direction: "in" })]
    );
    expect(amounts(result).USDC).toBe(600);
  });

  it("an outbound-only period walks the balance UP", () => {
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000 }])],
      [leg({ symbol: "USDC", amount: 400, direction: "out" })]
    );
    expect(amounts(result).USDC).toBe(1400);
  });

  it("chains: two steps back apply each period's own legs", () => {
    // April: 1,000 at close, +300/-100 during April → March closed at 800.
    // March: +50/-250 during March → February closed at 800 - 50 + 250 = 1000.
    const april = walk(
      [wallet([{ symbol: "USDC", amount: 1000 }])],
      [
        leg({ symbol: "USDC", amount: 300, direction: "in" }),
        leg({ symbol: "USDC", amount: 100, direction: "out" }),
      ]
    );
    expect(amounts(april).USDC).toBe(800);

    const march = reconstructBalances({
      balances: april.wallets.map((w) => ({
        walletAddress: w.walletAddress,
        chain: w.chain,
        tokens: w.tokens.map((t) => ({ ...t, priceUsd: 1, valueUsd: t.amount })),
      })),
      transfers: [
        leg({ symbol: "USDC", amount: 50, direction: "in" }),
        leg({ symbol: "USDC", amount: 250, direction: "out" }),
      ],
      asOf: "2026-02-28",
      observedAsOf: "2026-04-30",
      stepsFromObserved: 2,
    });
    expect(amounts(march).USDC).toBe(1000);
    expect(march.meta.stepsFromObserved).toBe(2);
    expect(march.meta.notes.join(" ")).toContain("2 walk-back steps");
  });

  it("carries a position with no legs forward unchanged, and says it did", () => {
    const result = walk(
      [
        wallet([
          { symbol: "USDC", amount: 1000 },
          { symbol: "WETH", amount: 5, price: 2000 },
        ]),
      ],
      [leg({ symbol: "USDC", amount: 200, direction: "in" })]
    );
    expect(amounts(result).WETH).toBe(5);
    expect(result.meta.positionsCarriedForward).toBe(1);
    expect(result.meta.positionsChanged).toBe(1);
  });

  it("keeps wallets separate — a leg only moves its own wallet's position", () => {
    const result = walk(
      [
        wallet([{ symbol: "USDC", amount: 1000 }], WALLET),
        wallet([{ symbol: "USDC", amount: 500 }], OTHER_WALLET),
      ],
      [leg({ symbol: "USDC", amount: 200, direction: "in", wallet: OTHER_WALLET })]
    );
    expect(amounts(result, WALLET).USDC).toBe(1000);
    expect(amounts(result, OTHER_WALLET).USDC).toBe(300);
  });

  it("nets an internal transfer to zero across the project while moving both wallets", () => {
    // The same on-chain movement is read twice — once as the sender's outbound
    // leg, once as the recipient's inbound leg. Per-wallet that is -100 / +100;
    // across the project it must cancel.
    const result = walk(
      [
        wallet([{ symbol: "USDC", amount: 900 }], WALLET),
        wallet([{ symbol: "USDC", amount: 600 }], OTHER_WALLET),
      ],
      [
        leg({ symbol: "USDC", amount: 100, direction: "out", wallet: WALLET }),
        leg({ symbol: "USDC", amount: 100, direction: "in", wallet: OTHER_WALLET }),
      ]
    );
    expect(amounts(result, WALLET).USDC).toBe(1000);
    expect(amounts(result, OTHER_WALLET).USDC).toBe(500);
    const total =
      amounts(result, WALLET).USDC + amounts(result, OTHER_WALLET).USDC;
    expect(total).toBe(1500); // 900 + 600, unchanged
  });
});

// ─── clamping: the honest signal ───────────────────────────────────────────

describe("reconstructBalances — negatives clamp AND are counted", () => {
  it("clamps to zero rather than storing a negative balance", () => {
    // 100 stETH at close, 500 arrived, none left → the naive answer is -400,
    // which is what an unobserved credit (a rebase) looks like.
    const result = walk(
      [wallet([{ symbol: "STETH", amount: 100, price: 2000 }])],
      [leg({ symbol: "STETH", amount: 500, direction: "in" })]
    );
    // Walked back to exactly zero, so the position drops out of the payload
    // entirely rather than sitting there as a 0-quantity row.
    expect(amounts(result).STETH).toBeUndefined();
  });

  it("records the clamp: count, magnitude, and which position", () => {
    const result = walk(
      [wallet([{ symbol: "STETH", amount: 100, price: 2000 }])],
      [leg({ symbol: "STETH", amount: 500, direction: "in" })]
    );
    expect(result.meta.clampedPositions).toBe(1);
    expect(result.meta.clampedQtyTotal).toBe(400);
    expect(result.meta.clamps).toHaveLength(1);
    expect(result.meta.clamps[0]).toMatchObject({
      symbol: "STETH",
      wallet: WALLET,
      chain: "ethereum",
      shortfall: 400,
      shortfallUsd: null, // not priced yet
    });
  });

  it("says out loud that a clamped quantity is a floor, not an estimate", () => {
    const result = walk(
      [wallet([{ symbol: "STETH", amount: 100 }])],
      [leg({ symbol: "STETH", amount: 500, direction: "in" })]
    );
    const notes = result.meta.notes.join(" ");
    expect(notes).toContain("clamped to zero");
    expect(notes).toContain("FLOOR");
  });

  it("counts nothing when the walk-back stays non-negative", () => {
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000 }])],
      [leg({ symbol: "USDC", amount: 400, direction: "in" })]
    );
    expect(result.meta.clampedPositions).toBe(0);
    expect(result.meta.clampedQtyTotal).toBe(0);
    expect(result.meta.clamps).toEqual([]);
  });

  it("sorts clamps largest-first so a caveat names the worst offender", () => {
    const result = walk(
      [
        wallet([
          { symbol: "AAA", amount: 0 },
          { symbol: "BBB", amount: 0 },
        ]),
      ],
      [
        leg({ symbol: "AAA", amount: 10, direction: "in" }),
        leg({ symbol: "BBB", amount: 900, direction: "in" }),
      ]
    );
    expect(result.meta.clamps.map((c) => c.symbol)).toEqual(["BBB", "AAA"]);
  });
});

// ─── token identity ────────────────────────────────────────────────────────

describe("reconstructBalances — token identity", () => {
  it("matches on contract address when both sides carry one", () => {
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000, contract: USDC }])],
      [
        leg({
          symbol: "USDC",
          amount: 200,
          direction: "in",
          contractAddress: USDC.toUpperCase(), // case must not matter
        }),
      ]
    );
    expect(amounts(result).USDC).toBe(800);
    expect(result.meta.positions).toBe(1);
  });

  it("does NOT merge a spoofed ticker into the genuine position", () => {
    // The fixture treasury really does hold spam spoofing real tickers. A
    // symbol-first scheme would let the counterfeit's transfers walk the real
    // balance back to a number that never existed.
    const result = walk(
      [
        wallet([
          { symbol: "USDC", amount: 1000, contract: USDC },
          { symbol: "USDC", amount: 5, contract: SPOOF },
        ]),
      ],
      [
        leg({
          symbol: "USDC",
          amount: 900,
          direction: "in",
          contractAddress: SPOOF,
        }),
      ]
    );
    // The real position is untouched; the spoof walks back and clamps.
    const real = result.wallets[0].tokens.find(
      (t) => t.contractAddress === USDC
    );
    expect(real?.amount).toBe(1000);
    expect(result.meta.clampedPositions).toBe(1);
    expect(result.meta.clamps[0].contractAddress).toBe(SPOOF);
  });

  it("does NOT let a spoof leg reach the genuine position when the spoof is NOT held", () => {
    // The sharper version of the test above, and the one that was wrong.
    //
    // There, the treasury holds BOTH tokens, so two positions share the ticker,
    // the alias is ambiguous and gets revoked — the spoof leg matches the spoof
    // position on its own strong key and never reaches the real one.
    //
    // Here only the GENUINE position is held. That is the ordinary case: a spam
    // token is received and forwarded on within the period, or its dust balance
    // is below what the balance provider returns. The alias `ethereum:USDC` is
    // then unambiguous and points at the real position — so a leg carrying the
    // SPOOF contract resolved through it and walked $900 off a balance it never
    // touched. Both sides named the asset by contract and disagreed; that is a
    // definitive non-match, and the symbol gets no vote.
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000, contract: USDC }])],
      [
        leg({
          symbol: "USDC",
          amount: 900,
          direction: "in",
          contractAddress: SPOOF,
        }),
      ]
    );
    const real = result.wallets[0].tokens.find(
      (t) => t.contractAddress === USDC
    );
    expect(real?.amount).toBe(1000);
  });

  it("falls back to chain:SYMBOL when the balance has a contract and the leg does not", () => {
    // Dune records a contract for an ERC-20; Alchemy returns none for a native
    // leg or a legacy row. Strong-key-only matching would file them as two
    // unrelated positions and materialise a phantom.
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000, contract: USDC }])],
      [leg({ symbol: "USDC", amount: 200, direction: "in", contractAddress: null })]
    );
    expect(result.meta.positions).toBe(1);
    expect(amounts(result).USDC).toBe(800);
  });

  it("falls back the other way — leg has a contract, stored balance does not", () => {
    // Every snapshot written before wallet-sync persisted `contractAddress`
    // stores none at all, and those rows have to keep reconstructing.
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000, contract: null }])],
      [leg({ symbol: "USDC", amount: 200, direction: "in", contractAddress: USDC })]
    );
    expect(result.meta.positions).toBe(1);
    expect(amounts(result).USDC).toBe(800);
  });

  it("refuses the symbol alias when two contracts share a ticker", () => {
    // Ambiguous alias: resolving through it would attribute one token's
    // transfers to the other. The contract-less leg gets its own position
    // instead of silently landing on whichever was registered first.
    const result = walk(
      [
        wallet([
          { symbol: "USDC", amount: 1000, contract: USDC },
          { symbol: "USDC", amount: 5, contract: SPOOF },
        ]),
      ],
      [leg({ symbol: "USDC", amount: 200, direction: "out", contractAddress: null })]
    );
    expect(result.meta.positions).toBe(3);
    const byContract = Object.fromEntries(
      result.wallets[0].tokens.map((t) => [t.contractAddress ?? "none", t.amount])
    );
    expect(byContract[USDC]).toBe(1000);
    expect(byContract[SPOOF]).toBe(5);
    expect(byContract.none).toBe(200);
  });

  it("keeps two chains' same-symbol natives apart", () => {
    const result = walk(
      [
        wallet([{ symbol: "ETH", amount: 10, price: 2000 }], WALLET, "ethereum"),
        wallet([{ symbol: "ETH", amount: 4, price: 2000 }], WALLET, "optimism"),
      ],
      [
        leg({ symbol: "ETH", amount: 3, direction: "in", chain: "optimism" }),
      ]
    );
    const eth = result.wallets.find((w) => w.chain === "ethereum");
    const op = result.wallets.find((w) => w.chain === "optimism");
    expect(eth?.tokens[0].amount).toBe(10);
    expect(op?.tokens[0].amount).toBe(1);
  });
});

// ─── positions that exist only in the past ─────────────────────────────────

describe("reconstructBalances — a token held at t-1 and gone by t", () => {
  it("materialises a position the wallet fully disposed of during the period", () => {
    // The tokens a team SPENT are precisely the ones missing from today's
    // balance. Omitting this case understates every past treasury.
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000 }])],
      [leg({ symbol: "WETH", amount: 12, direction: "out" })]
    );
    expect(amounts(result).WETH).toBe(12);
    expect(result.meta.positionsCreated).toBe(1);
  });

  it("materialises a whole wallet that is empty today but moved money then", () => {
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 1000 }], WALLET)],
      [
        leg({
          symbol: "USDC",
          amount: 700,
          direction: "out",
          wallet: OTHER_WALLET,
        }),
      ]
    );
    expect(amounts(result, OTHER_WALLET).USDC).toBe(700);
  });

  it("clamps a created position whose inbound exceeds its outbound", () => {
    // Received 500, sent 100, holds nothing now. Naive: 0 - 500 + 100 = -400.
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 0 }])],
      [
        leg({ symbol: "AIRDROP", amount: 500, direction: "in" }),
        leg({ symbol: "AIRDROP", amount: 100, direction: "out" }),
      ]
    );
    expect(amounts(result).AIRDROP).toBeUndefined();
    expect(result.meta.clampedPositions).toBe(1);
    expect(result.meta.clamps[0].shortfall).toBe(400);
  });

  it("keeps an emptied wallet in the payload rather than dropping it", () => {
    // A wallet that vanishes from `balances_detail` reads to
    // treasury-attribution.ts as "a wallet joined coverage" in the NEXT period,
    // which it is explicitly forbidden from reporting as an inflow.
    const result = walk([wallet([])], []);
    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0].tokens).toEqual([]);
  });
});

// ─── malformed input ───────────────────────────────────────────────────────

describe("reconstructBalances — never throws", () => {
  it("handles a null balances payload", () => {
    const result = walk(null, [leg({ symbol: "USDC", amount: 5, direction: "in" })]);
    expect(result.wallets.length).toBeGreaterThanOrEqual(0);
    expect(result.meta.method).toBe("transfer-walkback");
  });

  it("handles a non-array balances payload", () => {
    expect(() => walk({ nope: true }, [])).not.toThrow();
    expect(walk({ nope: true }, []).wallets).toEqual([]);
  });

  it("handles an empty payload and empty legs", () => {
    const result = walk([], []);
    expect(result.wallets).toEqual([]);
    expect(result.meta.positions).toBe(0);
    expect(result.meta.legsApplied).toBe(0);
  });

  it("tolerates null entries, missing token arrays and junk values", () => {
    const result = walk(
      [
        null,
        { walletAddress: WALLET, chain: "ethereum" },
        {
          walletAddress: OTHER_WALLET,
          chain: "ethereum",
          tokens: [
            null,
            "nonsense",
            { symbol: null, contractAddress: null },
            { symbol: "USDC", amount: "not a number" },
            { symbol: "DAI", amount: "250" },
          ],
        },
      ],
      []
    );
    expect(amounts(result, OTHER_WALLET)).toEqual({ DAI: 250 });
  });

  it("counts unusable legs instead of dropping them silently", () => {
    const result = walk(
      [wallet([{ symbol: "USDC", amount: 100 }])],
      [
        null as unknown as ReconstructionTransfer,
        leg({ symbol: "USDC", amount: 0, direction: "in" }),
        leg({ symbol: "USDC", amount: -5, direction: "in" }),
        { chain: "ethereum", symbol: "USDC", amount: 5, direction: "in" }, // no wallet
        { chain: "ethereum", wallet: WALLET, amount: 5, direction: "in" }, // no identity
        {
          chain: "ethereum",
          wallet: WALLET,
          symbol: "USDC",
          amount: 5,
          direction: null,
        },
        leg({ symbol: "USDC", amount: 20, direction: "in" }),
      ]
    );
    expect(result.meta.legsApplied).toBe(1);
    expect(result.meta.legsIgnored).toBe(6);
    expect(amounts(result).USDC).toBe(80);
  });

  it("ignores legs for a wallet declared unreconstructable", () => {
    const result = walk(
      [wallet([{ symbol: "SOL", amount: 100 }], WALLET, "solana")],
      [leg({ symbol: "SOL", amount: 40, direction: "in", chain: "solana" })],
      {
        carriedForwardWallets: [
          { chain: "solana", address: WALLET, reason: "no feed" },
        ],
      }
    );
    expect(amounts(result).SOL).toBe(100); // carried forward, not half-walked
    expect(result.meta.legsIgnored).toBe(1);
    expect(result.meta.carriedForwardWallets).toHaveLength(1);
    expect(result.meta.notes.join(" ")).toContain("no usable transfer feed");
  });
});

// ─── pricing ───────────────────────────────────────────────────────────────

describe("priceReconstruction", () => {
  const identity = { tokenSymbol: "UNI", tokenContract: OWN };

  it("lists the symbols the caller has to resolve, uppercased and deduped", () => {
    const result = walk(
      [
        wallet([
          { symbol: "usdc", amount: 100 },
          { symbol: "USDC", amount: 50, contract: USDC },
          { symbol: "WETH", amount: 1 },
        ]),
      ],
      []
    );
    expect(reconstructionSymbols(result).sort()).toEqual(["USDC", "WETH"]);
  });

  it("prices at the resolved historical price, not the stored one", () => {
    // Stored price is TODAY's ($3.00). The historical close was $1.50. Using
    // the stored price is the exact bug this stage removes.
    const result = walk([wallet([{ symbol: "UNI", amount: 100, price: 3 }])], []);
    const priced = priceReconstruction(
      result,
      new Map([["UNI", 1.5]]),
      identity
    );
    expect(priced.totalBalanceUsd).toBe(150);
    expect(priced.balancesDetail[0].tokens[0].priceUsd).toBe(1.5);
  });

  it("carries an unpriceable token at zero — never at today's price", () => {
    const result = walk(
      [
        wallet([
          { symbol: "USDC", amount: 1000, price: 1 },
          { symbol: "OBSCURE", amount: 400, price: 2 },
        ]),
      ],
      []
    );
    const priced = priceReconstruction(
      result,
      new Map<string, number | null>([
        ["USDC", 1],
        ["OBSCURE", null],
      ]),
      identity
    );
    expect(priced.totalBalanceUsd).toBe(1000);
    const obscure = priced.balancesDetail[0].tokens.find(
      (t) => t.symbol === "OBSCURE"
    );
    expect(obscure?.priceUsd).toBe(0);
    expect(obscure?.valueUsd).toBe(0);
    // The quantity survives — it is the USD that is unknown, not the holding.
    expect(obscure?.amount).toBe(400);
  });

  it("discloses the unpriced hole rather than pretending the total is complete", () => {
    const result = walk(
      [
        wallet([
          { symbol: "USDC", amount: 1000, price: 1 },
          { symbol: "OBSCURE", amount: 400, price: 2 }, // proxy value $800
        ]),
      ],
      []
    );
    const priced = priceReconstruction(
      result,
      new Map<string, number | null>([
        ["USDC", 1],
        ["OBSCURE", null],
      ]),
      identity
    );
    expect(priced.meta.unpricedPositions).toBe(1);
    expect(priced.meta.unpricedSymbols).toEqual(["OBSCURE"]);
    // 800 proxy / (1000 priced + 800 proxy)
    expect(priced.meta.unpricedShareOfTotal).toBeCloseTo(800 / 1800, 6);
    expect(priced.meta.notes.join(" ")).toContain("no price feed");
    expect(priced.meta.notes.join(" ")).toContain("floor");
  });

  it("leaves the unpriced share null when nothing is unpriced", () => {
    const result = walk([wallet([{ symbol: "USDC", amount: 10 }])], []);
    const priced = priceReconstruction(result, new Map([["USDC", 1]]), identity);
    expect(priced.meta.unpricedPositions).toBe(0);
    expect(priced.meta.unpricedShareOfTotal).toBe(0);
  });

  it("puts USD on a clamp so the size of the unobserved credit is visible", () => {
    const result = walk(
      [wallet([{ symbol: "STETH", amount: 100, price: 2000 }])],
      [leg({ symbol: "STETH", amount: 500, direction: "in" })]
    );
    const priced = priceReconstruction(
      result,
      new Map([["STETH", 1800]]),
      identity
    );
    expect(priced.meta.clamps[0].shortfallUsd).toBe(400 * 1800);
    expect(priced.meta.clampedUsd).toBe(400 * 1800);
  });

  it("leaves a clamp's USD null rather than zero when the token has no price", () => {
    const result = walk(
      [wallet([{ symbol: "REBASE", amount: 0 }])],
      [leg({ symbol: "REBASE", amount: 500, direction: "in" })]
    );
    const priced = priceReconstruction(
      result,
      new Map<string, number | null>([["REBASE", null]]),
      identity
    );
    expect(priced.meta.clamps[0].shortfallUsd).toBeNull();
    // A zero here would read as "nothing was clamped", the opposite of the truth.
    expect(priced.meta.clampedUsd).toBeNull();
  });

  it("buckets through the shared classifier — own token beats stablecoin", () => {
    const result = walk(
      [
        wallet([
          { symbol: "USDC", amount: 1000, contract: USDC },
          { symbol: "UNI", amount: 500, contract: OWN },
        ]),
      ],
      []
    );
    const priced = priceReconstruction(
      result,
      new Map([
        ["USDC", 1],
        ["UNI", 2],
      ]),
      identity
    );
    expect(priced.stablecoinsUsd).toBe(1000);
    expect(priced.nativeTokenUsd).toBe(1000); // 500 * $2, the own-token column
    expect(priced.totalBalanceUsd).toBe(2000);
  });

  it("the disclosure ceiling is a share, not a percentage point", () => {
    expect(MAX_UNPRICED_SHARE_FOR_COMPARISON).toBeGreaterThan(0);
    expect(MAX_UNPRICED_SHARE_FOR_COMPARISON).toBeLessThan(1);
  });
});
