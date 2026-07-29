import { describe, it, expect } from "vitest";
import {
  extractMajorTransactions,
  majorTransactionThreshold,
  truncateAddress,
  MAX_ROWS,
  MIN_THRESHOLD_USD,
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
