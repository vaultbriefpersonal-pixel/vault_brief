import { describe, it, expect } from "vitest";
import {
  aggregateLegs,
  extractMajorTransactions,
  majorTransactionThreshold,
  truncateAddress,
  MAX_ROWS,
  MIN_THRESHOLD_USD,
  type TransactionLeg,
} from "./major-transactions";
import { INTERNAL_TRANSFER_CATEGORY } from "./expense-classifier";

const BINANCE = "0xd551234ae421e3bcba99a0da6d736074f22192ff";
const TRAIL_OF_BITS = "0xafd5dee72e0d6c8ec1e8c4a78e8a9bcdc97cd2ec";
const UNKNOWN_ADDR = "0x1234567890abcdef1234567890abcdefabcdabcd";
const OWN_WALLET = "0x9999999999999999999999999999999999999999";

/** A treasury small enough that the flat $25K floor is what binds. */
const SMALL_TREASURY = 1_000_000;

let hashSeed = 0;
function tx(overrides: Record<string, unknown> = {}) {
  hashSeed += 1;
  return {
    hash: `0xhash${String(hashSeed).padStart(4, "0")}`,
    from: UNKNOWN_ADDR,
    to: BINANCE,
    value: "1000",
    token: "USDC",
    valueUsd: 100_000,
    timestamp: Date.UTC(2026, 3, 12, 9, 30),
    direction: "out",
    category: "token_sale",
    priceUnknown: false,
    ...overrides,
  };
}

/** The envelope data-sync.ts actually writes. */
function envelope(sample: unknown[], meta: Record<string, unknown> = {}) {
  return { sample, totalCount: sample.length, capped: false, ...meta };
}

describe("majorTransactionThreshold", () => {
  it("uses the flat $25K floor for a small treasury", () => {
    expect(majorTransactionThreshold(1_000_000)).toBe(MIN_THRESHOLD_USD);
  });

  it("uses 0.5% of the treasury once that exceeds the flat floor", () => {
    // 0.5% of $20M = $100K, comfortably above $25K.
    expect(majorTransactionThreshold(20_000_000)).toBe(100_000);
  });

  it("falls back to the flat floor for a missing or nonsense total", () => {
    const unsafe = majorTransactionThreshold as (v: unknown) => number;
    expect(unsafe(0)).toBe(MIN_THRESHOLD_USD);
    expect(unsafe(NaN)).toBe(MIN_THRESHOLD_USD);
    expect(unsafe(null)).toBe(MIN_THRESHOLD_USD);
    expect(unsafe(undefined)).toBe(MIN_THRESHOLD_USD);
    expect(unsafe(-5_000_000)).toBe(MIN_THRESHOLD_USD);
  });
});

describe("truncateAddress", () => {
  it("keeps both ends so a reader can match it on an explorer", () => {
    expect(truncateAddress(UNKNOWN_ADDR)).toBe("0x1234…abcd");
  });

  it("leaves a short string alone — nothing to truncate", () => {
    expect(truncateAddress("0xabc")).toBe("0xabc");
    expect(truncateAddress("")).toBe("");
  });

  it("does not lowercase a Solana address, which is case-sensitive", () => {
    const solana = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    expect(truncateAddress(solana)).toBe("9WzDXw…AWWM");
  });
});

describe("extractMajorTransactions — threshold", () => {
  it("keeps transactions at or above the threshold and drops the rest", () => {
    const result = extractMajorTransactions(
      envelope([
        tx({ valueUsd: 80_000, hash: "0xbig" }),
        tx({ valueUsd: 25_000, hash: "0xexactly" }),
        tx({ valueUsd: 24_999, hash: "0xjustunder" }),
        tx({ valueUsd: 500, hash: "0xdust" }),
      ]),
      SMALL_TREASURY
    );
    expect(result.rows.map((r) => r.hash)).toEqual(["0xbig", "0xexactly"]);
    expect(result.thresholdUsd).toBe(MIN_THRESHOLD_USD);
  });

  it("scales the threshold with the treasury — 0.5% of $20M is $100K", () => {
    const rows = [
      tx({ valueUsd: 250_000, hash: "0xclears" }),
      tx({ valueUsd: 60_000, hash: "0xmajorforasmallprotocol" }),
    ];
    const small = extractMajorTransactions(envelope(rows), SMALL_TREASURY);
    const large = extractMajorTransactions(envelope(rows), 20_000_000);

    expect(small.rows).toHaveLength(2);
    expect(large.rows.map((r) => r.hash)).toEqual(["0xclears"]);
    expect(large.thresholdUsd).toBe(100_000);
  });

  it("drops zero-value rows even when the threshold would be zero-ish", () => {
    const result = extractMajorTransactions(
      envelope([tx({ valueUsd: 0 }), tx({ valueUsd: -0 })]),
      SMALL_TREASURY
    );
    expect(result.rows).toEqual([]);
  });
});

describe("extractMajorTransactions — exclusions", () => {
  it("excludes internal transfers — a treasury paying itself is not an event", () => {
    const result = extractMajorTransactions(
      envelope([
        tx({
          hash: "0xinternal",
          valueUsd: 5_000_000,
          to: OWN_WALLET,
          category: INTERNAL_TRANSFER_CATEGORY,
        }),
        tx({ hash: "0xreal", valueUsd: 90_000 }),
      ]),
      SMALL_TREASURY
    );
    expect(result.rows.map((r) => r.hash)).toEqual(["0xreal"]);
    expect(result.qualifyingCount).toBe(1);
  });

  it("uses the same literal the classifier writes", () => {
    // Guards the deliberate non-import: major-transactions.ts hardcodes
    // "internal_transfer" rather than importing the constant (that module
    // pulls in the OpenAI SDK). This assertion is what keeps them in sync.
    expect(INTERNAL_TRANSFER_CATEGORY).toBe("internal_transfer");
  });

  it("excludes rows flagged priceUnknown — their USD value is not real", () => {
    const result = extractMajorTransactions(
      envelope([
        tx({ hash: "0xunpriced", valueUsd: 9_000_000, priceUnknown: true }),
        tx({ hash: "0xpriced", valueUsd: 90_000 }),
      ]),
      SMALL_TREASURY
    );
    expect(result.rows.map((r) => r.hash)).toEqual(["0xpriced"]);
  });

  it("keeps rows from legacy payloads that predate the priceUnknown field", () => {
    const legacy = tx({ hash: "0xlegacy" }) as Record<string, unknown>;
    delete legacy.priceUnknown;
    const result = extractMajorTransactions(envelope([legacy]), SMALL_TREASURY);
    expect(result.rows.map((r) => r.hash)).toEqual(["0xlegacy"]);
  });
});

describe("extractMajorTransactions — counterparty labelling", () => {
  it("names a known counterparty on the receiving end of an outflow", () => {
    const result = extractMajorTransactions(
      envelope([tx({ direction: "out", to: BINANCE, from: OWN_WALLET })]),
      SMALL_TREASURY
    );
    expect(result.rows[0].counterparty).toBe("Binance");
    expect(result.rows[0].counterpartyKnown).toBe(true);
    expect(result.rows[0].counterpartyAddress).toBe(BINANCE);
  });

  it("reads the sending side for an inflow, not the receiving side", () => {
    const result = extractMajorTransactions(
      envelope([
        tx({ direction: "in", from: TRAIL_OF_BITS, to: OWN_WALLET }),
      ]),
      SMALL_TREASURY
    );
    expect(result.rows[0].counterparty).toBe("Trail of Bits");
    expect(result.rows[0].counterpartyAddress).toBe(TRAIL_OF_BITS);
  });

  it("matches a checksummed address the same as a lowercase one", () => {
    const checksummed = "0xD551234Ae421e3BCBA99A0Da6d736074f22192FF";
    const result = extractMajorTransactions(
      envelope([tx({ to: checksummed })]),
      SMALL_TREASURY
    );
    expect(result.rows[0].counterparty).toBe("Binance");
  });

  it("falls back to a truncated address for an unrecognised counterparty", () => {
    const result = extractMajorTransactions(
      envelope([tx({ to: UNKNOWN_ADDR })]),
      SMALL_TREASURY
    );
    expect(result.rows[0].counterparty).toBe("0x1234…abcd");
    expect(result.rows[0].counterpartyKnown).toBe(false);
  });

  it("renders an empty counterparty as empty rather than inventing one", () => {
    const result = extractMajorTransactions(
      envelope([tx({ to: "" })]),
      SMALL_TREASURY
    );
    expect(result.rows[0].counterparty).toBe("");
    expect(result.rows[0].counterpartyKnown).toBe(false);
  });
});

describe("extractMajorTransactions — sorting and the row cap", () => {
  it("sorts by USD value descending regardless of stored order", () => {
    const result = extractMajorTransactions(
      envelope([
        tx({ hash: "0xmid", valueUsd: 200_000 }),
        tx({ hash: "0xsmall", valueUsd: 50_000 }),
        tx({ hash: "0xlarge", valueUsd: 900_000 }),
      ]),
      SMALL_TREASURY
    );
    expect(result.rows.map((r) => r.hash)).toEqual([
      "0xlarge",
      "0xmid",
      "0xsmall",
    ]);
  });

  it("ranks an outflow by magnitude, not by sign", () => {
    // Outflows are stored positive with direction "out", but a hand-imported
    // snapshot may have signed them. Magnitude is what makes a tx major.
    const result = extractMajorTransactions(
      envelope([
        tx({ hash: "0xnegative", valueUsd: -800_000, direction: "out" }),
        tx({ hash: "0xpositive", valueUsd: 90_000, direction: "in" }),
      ]),
      SMALL_TREASURY
    );
    expect(result.rows.map((r) => r.hash)).toEqual(["0xnegative", "0xpositive"]);
    expect(result.rows[0].valueUsd).toBe(800_000);
  });

  it("caps the table at MAX_ROWS but reports how many qualified", () => {
    const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) =>
      tx({ hash: `0xrow${i}`, valueUsd: 1_000_000 - i * 1_000 })
    );
    const result = extractMajorTransactions(envelope(many), SMALL_TREASURY);
    expect(result.rows).toHaveLength(MAX_ROWS);
    expect(result.qualifyingCount).toBe(MAX_ROWS + 5);
    expect(result.rows[0].hash).toBe("0xrow0");
    expect(result.rows.at(-1)?.hash).toBe(`0xrow${MAX_ROWS - 1}`);
  });

  it("is deterministic for equal values — same payload, same table", () => {
    const equal = [
      tx({ hash: "0xb", valueUsd: 100_000, timestamp: 1_000 }),
      tx({ hash: "0xa", valueUsd: 100_000, timestamp: 1_000 }),
      tx({ hash: "0xc", valueUsd: 100_000, timestamp: 9_000 }),
    ];
    const first = extractMajorTransactions(envelope(equal), SMALL_TREASURY);
    const second = extractMajorTransactions(
      envelope([...equal].reverse()),
      SMALL_TREASURY
    );
    expect(first.rows.map((r) => r.hash)).toEqual(
      second.rows.map((r) => r.hash)
    );
    // Newest first among ties, then hash.
    expect(first.rows.map((r) => r.hash)).toEqual(["0xc", "0xa", "0xb"]);
  });
});

describe("extractMajorTransactions — the capped flag", () => {
  it("is false when the sync stored every transaction it saw", () => {
    const result = extractMajorTransactions(
      envelope([tx()], { totalCount: 1, capped: false }),
      SMALL_TREASURY
    );
    expect(result.capped).toBe(false);
    expect(result.totalCount).toBe(1);
    expect(result.sampleSize).toBe(1);
  });

  it("is true when the sync capped the sample — rows may omit larger txs", () => {
    const result = extractMajorTransactions(
      envelope([tx()], { totalCount: 640, capped: true }),
      SMALL_TREASURY
    );
    expect(result.capped).toBe(true);
    expect(result.totalCount).toBe(640);
  });

  it("infers capped when the flag is missing but the total exceeds the sample", () => {
    // A payload that lost its flag is still a sample. Defaulting to false
    // would suppress exactly the disclosure the reader needs.
    const result = extractMajorTransactions(
      { sample: [tx()], totalCount: 640 },
      SMALL_TREASURY
    );
    expect(result.capped).toBe(true);
  });

  it("does not infer capped when the recorded total matches the sample", () => {
    const result = extractMajorTransactions(
      { sample: [tx(), tx()], totalCount: 2 },
      SMALL_TREASURY
    );
    expect(result.capped).toBe(false);
  });
});

// ─── Leg aggregation ────────────────────────────────────────────────────────
//
// The June 2026 Uniswap Governance Timelock fixture, verified against the
// production snapshot and live Alchemy: eight UNI legs, ONE transaction hash,
// one block timestamp, eight recipients. The treasury was $1,055,781,357.29,
// so the threshold is 0.5% = $5,278,906.79 — which every leg fails
// individually and the transaction clears seven times over.

const UNI_TREASURY_USD = 1_055_781_357.29;
const UNI_HASH = "0xbatchdistribution";
const UNI_BLOCK_MS = Date.parse("2026-06-01T06:58:11Z");

const UNI_QUANTITIES = [
  2500001.18827041, 2499858.0001, 2250000.0001, 2250000.0001, 1900000.0001,
  493972.0001, 452626.0001, 153544.0001,
];

/**
 * The historical UNI price the sync used. The plan quotes it rounded to
 * $3.021206; at that rounding the eight legs sum to $37,765,078.59, which is
 * $0.37 off the `total_inflows_usd` stored on the snapshot. The value below is
 * the full-precision price implied by that stored total
 * (37,765,078.22 / 12,500,001.18897041), and it is the one that reconciles to
 * the cent. Rounding, not a discrepancy in the data.
 */
const UNI_PRICE_USD = 3.0212059702;

/** `total_inflows_usd` as stored on snapshot 306f5550. */
const STORED_TOTAL_INFLOWS_USD = 37_765_078.22;

/** The Uniswap Governance Timelock — the tracked wallet, on the receiving end. */
const TIMELOCK = "0x1a9c8182c09f50c8318d769245bea52c32be35bc";
const DISTRIBUTOR = "0xd0000000000000000000000000000000000000d0";

function uniLeg(index: number, from: string = DISTRIBUTOR) {
  return tx({
    hash: UNI_HASH,
    from,
    to: TIMELOCK,
    token: "UNI",
    value: String(UNI_QUANTITIES[index]),
    valueUsd: UNI_QUANTITIES[index] * UNI_PRICE_USD,
    timestamp: UNI_BLOCK_MS,
    direction: "in",
    category: "other_income",
    priceUnknown: false,
  });
}

const uniLegs = () => UNI_QUANTITIES.map((_, i) => uniLeg(i));

describe("extractMajorTransactions — the June 2026 fixture", () => {
  it("reports one transaction of $37,765,078.22 comprising eight transfers", () => {
    const result = extractMajorTransactions(
      envelope(uniLegs()),
      UNI_TREASURY_USD
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.legCount).toBe(8);
    expect(row.hash).toBe(UNI_HASH);
    expect(row.direction).toBe("in");
    expect(row.token).toBe("UNI");
    expect(Math.abs(row.valueUsd - STORED_TOTAL_INFLOWS_USD)).toBeLessThanOrEqual(
      0.01
    );
  });

  it("reconciles with total_inflows_usd — the aggregate loses nothing", () => {
    // The bug this replaces: the headline counted all eight legs while the
    // table showed one, so $30,212,059.70 of real inflow vanished from the
    // section without a word.
    const legs = uniLegs();
    const inflowsFromLegs = legs.reduce((sum, t) => sum + t.valueUsd, 0);
    const result = extractMajorTransactions(envelope(legs), UNI_TREASURY_USD);

    expect(result.rows[0].valueUsd).toBeCloseTo(inflowsFromLegs, 6);
    expect(result.rows[0].valueUsd).toBeGreaterThan(37_000_000);
  });

  it("does not discard the sub-threshold legs before aggregating", () => {
    // $1.49M, $1.37M and $0.46M each fail the $5.28M floor on their own. Under
    // per-leg thresholding they were dropped, and the transaction they belong
    // to was understated by exactly their sum.
    const threshold = majorTransactionThreshold(UNI_TREASURY_USD);
    const small = [5, 6, 7].map((i) => UNI_QUANTITIES[i] * UNI_PRICE_USD);
    for (const value of small) expect(value).toBeLessThan(threshold);

    const row = extractMajorTransactions(
      envelope(uniLegs()),
      UNI_TREASURY_USD
    ).rows[0];
    const withoutSmall = row.valueUsd - small.reduce((a, b) => a + b, 0);
    expect(withoutSmall).toBeLessThan(row.valueUsd);
    expect(row.legCount).toBe(8);
  });

  it("reads the sending side for the inbound legs and keeps one counterparty", () => {
    const row = extractMajorTransactions(
      envelope(uniLegs()),
      UNI_TREASURY_USD
    ).rows[0];
    expect(row.counterpartyAddress).toBe(DISTRIBUTOR);
    expect(row.counterparty).toBe(truncateAddress(DISTRIBUTOR));
  });

  it("reports a count instead of a name when the legs came from several senders", () => {
    const legs = UNI_QUANTITIES.map((_, i) => uniLeg(i, `0xsender${i}`));
    const row = extractMajorTransactions(
      envelope(legs),
      UNI_TREASURY_USD
    ).rows[0];
    expect(row.counterparty).toBe("8 counterparties");
    expect(row.counterpartyKnown).toBe(false);
    expect(row.counterpartyAddress).toBe("");
    expect(row.legCount).toBe(8);
  });

  it("keeps the two spam airdrops out of the table and counts them", () => {
    const spam = [
      tx({
        hash: "0xspamaq0",
        token: "AQ0",
        direction: "in",
        valueUsd: 0,
        priceUnknown: true,
        category: "airdrop",
      }),
      tx({
        hash: "0xspamzik",
        token: "ZIK",
        direction: "in",
        valueUsd: 0,
        priceUnknown: true,
        category: "airdrop",
      }),
    ];
    const result = extractMajorTransactions(
      envelope([...uniLegs(), ...spam]),
      UNI_TREASURY_USD
    );
    expect(result.rows).toHaveLength(1);
    expect(result.excluded.priceUnknown).toBe(2);
    expect(result.sampleSize).toBe(10);
  });
});

describe("aggregateLegs", () => {
  function leg(overrides: Partial<TransactionLeg> = {}): TransactionLeg {
    return {
      hash: "0xgroup",
      direction: "out",
      token: "USDC",
      category: "payroll",
      valueUsd: 1_000,
      timestamp: UNI_BLOCK_MS,
      counterpartyAddress: UNKNOWN_ADDR,
      priceUnknown: false,
      ...overrides,
    };
  }

  it("sums legs of one hash into one row", () => {
    const { rows } = aggregateLegs([
      leg({ valueUsd: 400, counterpartyAddress: "0xa" }),
      leg({ valueUsd: 600, counterpartyAddress: "0xb" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].valueUsd).toBe(1_000);
    expect(rows[0].legCount).toBe(2);
  });

  it("splits a hash by direction — a swap is not a doubled transfer", () => {
    const { rows } = aggregateLegs([
      leg({ direction: "out", valueUsd: 500 }),
      leg({ direction: "in", valueUsd: 500 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.direction).sort()).toEqual(["in", "out"]);
  });

  it("labels a mixed-asset transaction 'multiple assets'", () => {
    const { rows } = aggregateLegs([
      leg({ token: "USDC", valueUsd: 100 }),
      leg({ token: "WETH", valueUsd: 900 }),
    ]);
    expect(rows[0].token).toBe("multiple assets");
    expect(rows[0].valueUsd).toBe(1_000);
  });

  it("keeps the symbol when every leg moved the same asset", () => {
    const { rows } = aggregateLegs([leg({ token: "UNI" }), leg({ token: "UNI" })]);
    expect(rows[0].token).toBe("UNI");
  });

  it("counts distinct counterparties case-insensitively", () => {
    const { rows } = aggregateLegs([
      leg({ counterpartyAddress: BINANCE.toUpperCase() }),
      leg({ counterpartyAddress: BINANCE }),
    ]);
    expect(rows[0].counterparty).toBe("Binance");
    expect(rows[0].counterpartyKnown).toBe(true);
  });

  it("labels several counterparties by count", () => {
    const { rows } = aggregateLegs([
      leg({ counterpartyAddress: "0xa" }),
      leg({ counterpartyAddress: "0xb" }),
      leg({ counterpartyAddress: "0xc" }),
    ]);
    expect(rows[0].counterparty).toBe("3 counterparties");
  });

  it("marks a transaction partial when one of its legs had no price", () => {
    const { rows, priceUnknownLegs } = aggregateLegs([
      leg({ valueUsd: 700 }),
      leg({ valueUsd: 300 }),
      leg({ valueUsd: 0, priceUnknown: true, token: "SPAM" }),
    ]);
    expect(rows).toHaveLength(1);
    // The unpriced leg contributes exactly nothing — never a known-wrong 0
    // silently folded into the sum, and never the whole row discarded.
    expect(rows[0].valueUsd).toBe(1_000);
    expect(rows[0].legCount).toBe(2);
    expect(rows[0].partial).toBe(true);
    expect(rows[0].token).toBe("USDC");
    expect(priceUnknownLegs).toBe(1);
  });

  it("emits nothing for a transaction whose every leg is unpriced", () => {
    const { rows, priceUnknownLegs } = aggregateLegs([
      leg({ valueUsd: 0, priceUnknown: true }),
      leg({ valueUsd: 0, priceUnknown: true }),
    ]);
    expect(rows).toEqual([]);
    expect(priceUnknownLegs).toBe(2);
  });

  it("does not mark a fully-priced transaction partial", () => {
    const { rows } = aggregateLegs([leg(), leg({ counterpartyAddress: "0xb" })]);
    expect(rows[0].partial).toBe(false);
  });

  it("labels mixed categories rather than picking one", () => {
    const { rows } = aggregateLegs([
      leg({ category: "payroll" }),
      leg({ category: "grants" }),
    ]);
    expect(rows[0].category).toBe("multiple categories");
  });

  it("keeps rows with no hash separate instead of fusing them", () => {
    const { rows } = aggregateLegs([
      leg({ hash: "", valueUsd: 100 }),
      leg({ hash: "", valueUsd: 200 }),
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("extractMajorTransactions — threshold after aggregation", () => {
  it("qualifies a $50,000 transaction made of a hundred $500 legs", () => {
    // Per-leg thresholding made this transaction disappear entirely: not one
    // of its legs cleared $25K, so nothing was reported at all.
    const legs = Array.from({ length: 100 }, (_, i) =>
      tx({ hash: "0xhundredlegs", valueUsd: 500, to: `0xrecipient${i}` })
    );
    const result = extractMajorTransactions(envelope(legs), SMALL_TREASURY);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].valueUsd).toBe(50_000);
    expect(result.rows[0].legCount).toBe(100);
    expect(result.excluded.belowThreshold).toBe(0);
  });

  it("still drops a transaction whose aggregate is under the threshold", () => {
    const legs = Array.from({ length: 4 }, (_, i) =>
      tx({ hash: "0xsmallbatch", valueUsd: 500, to: `0xr${i}` })
    );
    const result = extractMajorTransactions(envelope(legs), SMALL_TREASURY);
    expect(result.rows).toEqual([]);
    expect(result.excluded.belowThreshold).toBe(1);
  });

  it("excludes internal legs BEFORE aggregating, not after", () => {
    // An internal leg folded into the sum would push a below-threshold
    // transaction over the line on money that never left the treasury.
    const result = extractMajorTransactions(
      envelope([
        tx({ hash: "0xmixed", valueUsd: 20_000, to: "0xa" }),
        tx({
          hash: "0xmixed",
          valueUsd: 900_000,
          to: OWN_WALLET,
          category: INTERNAL_TRANSFER_CATEGORY,
        }),
      ]),
      SMALL_TREASURY
    );
    expect(result.rows).toEqual([]);
    expect(result.excluded.internal).toBe(1);
    expect(result.excluded.belowThreshold).toBe(1);
  });

  it("counts each exclusion class separately", () => {
    const result = extractMajorTransactions(
      envelope([
        tx({ hash: "0xkeep", valueUsd: 400_000 }),
        tx({ hash: "0xint", category: INTERNAL_TRANSFER_CATEGORY }),
        tx({ hash: "0xnoprice", priceUnknown: true }),
        tx({ hash: "0xtiny", valueUsd: 10 }),
      ]),
      SMALL_TREASURY
    );
    expect(result.rows.map((r) => r.hash)).toEqual(["0xkeep"]);
    expect(result.excluded).toEqual({
      internal: 1,
      priceUnknown: 1,
      belowThreshold: 1,
    });
  });
});

describe("extractMajorTransactions — capped stays anchored to the stored sample", () => {
  it("does not infer capped from an aggregated row count", () => {
    // Eight legs, one row. `totalCount` matches the stored legs, so nothing
    // was truncated — reading the row count as the denominator would make
    // every multi-leg period claim it lost data.
    const legs = uniLegs();
    const result = extractMajorTransactions(
      { sample: legs, totalCount: legs.length },
      UNI_TREASURY_USD
    );
    expect(result.rows).toHaveLength(1);
    expect(result.sampleSize).toBe(8);
    expect(result.capped).toBe(false);
  });

  it("reports the stored leg count, not the row count, as sampleSize", () => {
    const result = extractMajorTransactions(
      envelope(uniLegs()),
      UNI_TREASURY_USD
    );
    expect(result.sampleSize).toBe(8);
    expect(result.rows).toHaveLength(1);
  });

  it("still honours a genuine truncation flag from the sync", () => {
    const result = extractMajorTransactions(
      envelope(uniLegs(), { totalCount: 640, capped: true }),
      UNI_TREASURY_USD
    );
    expect(result.capped).toBe(true);
    expect(result.totalCount).toBe(640);
  });

  it("surfaces legCount and sampleBasis when the envelope carries them", () => {
    const result = extractMajorTransactions(
      envelope(uniLegs(), {
        legCount: 10,
        sampleBasis: "top-50-by-value + 150-most-recent, per transfer leg",
      }),
      UNI_TREASURY_USD
    );
    expect(result.storedLegCount).toBe(10);
    expect(result.sampleBasis).toBe(
      "top-50-by-value + 150-most-recent, per transfer leg"
    );
  });

  it("reads legacy envelopes that carry neither", () => {
    const result = extractMajorTransactions(envelope([tx()]), SMALL_TREASURY);
    expect(result.storedLegCount).toBeNull();
    expect(result.sampleBasis).toBeNull();
    expect(result.rows[0].legCount).toBe(1);
    expect(result.rows[0].partial).toBe(false);
  });
});

describe("extractMajorTransactions — legacy and malformed input", () => {
  it("reads a legacy bare array of transactions", () => {
    const result = extractMajorTransactions(
      [tx({ hash: "0xlegacyarray", valueUsd: 300_000 })],
      SMALL_TREASURY
    );
    expect(result.rows.map((r) => r.hash)).toEqual(["0xlegacyarray"]);
    expect(result.capped).toBe(false);
    expect(result.totalCount).toBe(1);
  });

  it("returns an empty result for null, undefined and primitives", () => {
    for (const input of [null, undefined, 42, "nope", true]) {
      const result = extractMajorTransactions(input, SMALL_TREASURY);
      expect(result.rows).toEqual([]);
      expect(result.qualifyingCount).toBe(0);
      expect(result.capped).toBe(false);
      expect(result.totalCount).toBeNull();
    }
  });

  it("returns an empty result for an object with no usable sample", () => {
    for (const input of [{}, { sample: null }, { sample: "many" }, { rows: [] }]) {
      expect(extractMajorTransactions(input, SMALL_TREASURY).rows).toEqual([]);
    }
  });

  it("skips junk entries inside an otherwise valid sample", () => {
    const result = extractMajorTransactions(
      envelope([
        null,
        undefined,
        "not a transaction",
        7,
        [],
        {},
        tx({ hash: "0xsurvivor", valueUsd: 400_000 }),
      ]),
      SMALL_TREASURY
    );
    expect(result.rows.map((r) => r.hash)).toEqual(["0xsurvivor"]);
  });

  it("substitutes safe defaults for missing per-row fields", () => {
    const result = extractMajorTransactions(
      envelope([{ valueUsd: 300_000 }]),
      SMALL_TREASURY
    );
    const row = result.rows[0];
    expect(row.hash).toBe("");
    expect(row.token).toBe("UNKNOWN");
    expect(row.category).toBe("");
    expect(row.date).toBe("");
    // Direction is not guessable; "out" is the conservative default and the
    // section never asserts a purpose from direction alone.
    expect(row.direction).toBe("out");
  });

  it("formats the date from the stored epoch-ms timestamp", () => {
    const result = extractMajorTransactions(
      envelope([tx({ timestamp: Date.UTC(2026, 3, 12, 9, 30) })]),
      SMALL_TREASURY
    );
    expect(result.rows[0].date).toBe("2026-04-12");
  });

  it("drops an unusable timestamp rather than rendering an epoch-zero date", () => {
    for (const timestamp of [0, -1, NaN, "yesterday", null]) {
      const result = extractMajorTransactions(
        envelope([tx({ timestamp })]),
        SMALL_TREASURY
      );
      expect(result.rows[0].date).toBe("");
    }
  });

  it("never throws, whatever it is handed", () => {
    const nasty: unknown[] = [
      null,
      undefined,
      NaN,
      Symbol("x"),
      () => {},
      { sample: [{ valueUsd: "1e9999" }] },
      { sample: [{ to: 42, from: {}, token: [], category: null }] },
      { sample: { length: 3 } },
      { sample: [{ valueUsd: Infinity }] },
      { sample: [{ valueUsd: 1e9, timestamp: 8.64e15 * 2 }] },
    ];
    for (const input of nasty) {
      expect(() => extractMajorTransactions(input, SMALL_TREASURY)).not.toThrow();
      expect(() => extractMajorTransactions(input, NaN)).not.toThrow();
    }
  });
});
