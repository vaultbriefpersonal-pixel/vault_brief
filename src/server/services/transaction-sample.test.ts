import { describe, it, expect } from "vitest";
import { DUST_FLOOR_USD } from "./treasury-composition";
import {
  buildTransactionSample,
  isSpamSuspect,
  transactionLegKey,
  TRANSACTION_SAMPLE_BASIS,
  TOP_VALUE_SAMPLE_SIZE,
  RECENT_SAMPLE_SIZE,
  type SampleableTransaction,
} from "./transaction-sample";

const TIMELOCK = "0x1a9c8182c09f50c8318d769245bea52c32be35bc";

/**
 * The June 2026 Uniswap Governance Timelock distribution: eight UNI legs, one
 * hash, one block timestamp, eight recipients. This is the payload that used
 * to collapse to a single leg.
 */
const UNI_QUANTITIES = [
  2500001.18827041, 2499858.0001, 2250000.0001, 2250000.0001, 1900000.0001,
  493972.0001, 452626.0001, 153544.0001,
];

const BLOCK_MS = Date.parse("2026-06-01T06:58:11Z");
const UNI_HASH = "0xbatchdistribution";

function uniLeg(index: number): SampleableTransaction {
  return {
    uniqueId: `${UNI_HASH}:log:${index}`,
    hash: UNI_HASH,
    from: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    to: `0xrecipient${index}`,
    value: String(UNI_QUANTITIES[index]),
    token: "UNI",
    valueUsd: UNI_QUANTITIES[index] * 3.021206,
    timestamp: BLOCK_MS,
    direction: "in",
  };
}

/**
 * The two spam airdrops that shared the period with the distribution. Real
 * spam legs in this fixture ARE priceUnknown — the AQ0/ZIK tokens have no
 * usable price feed, which is exactly what `isSpamSuspect` keys on.
 */
function spamLeg(token: string, units: number, index: number): SampleableTransaction {
  return {
    uniqueId: `0xspam${token}:log:${index}`,
    hash: `0xspam${token}`,
    from: `0xspammer${token}`,
    to: TIMELOCK,
    value: String(units),
    token,
    valueUsd: 0,
    priceUnknown: true,
    timestamp: BLOCK_MS + 1000,
    direction: "in",
  };
}

function leg(overrides: Partial<SampleableTransaction> = {}): SampleableTransaction {
  return {
    hash: "0xhash",
    from: "0xfrom",
    to: "0xto",
    value: "1",
    token: "USDC",
    valueUsd: 1000,
    timestamp: 1_700_000_000_000,
    direction: "out",
    ...overrides,
  };
}

describe("transactionLegKey", () => {
  it("prefers uniqueId — it is the only per-leg identifier Alchemy gives", () => {
    const a = leg({ uniqueId: "0xabc:log:3", to: "0xone" });
    const b = leg({ uniqueId: "0xabc:log:3", to: "0xtwo" });
    expect(transactionLegKey(a)).toBe(transactionLegKey(b));
  });

  it("falls back to the composite when uniqueId is absent", () => {
    const a = leg({ to: "0xone" });
    const b = leg({ to: "0xtwo" });
    expect(transactionLegKey(a)).not.toBe(transactionLegKey(b));
    expect(transactionLegKey(a)).toContain("leg|");
  });

  it("separates legs of one hash by recipient and by amount", () => {
    const base = { hash: "0xbatch", from: "0xtreasury", token: "UNI" as const };
    const first = leg({ ...base, to: "0xalice", value: "100" });
    const second = leg({ ...base, to: "0xbob", value: "100" });
    const third = leg({ ...base, to: "0xalice", value: "200" });
    const keys = new Set([first, second, third].map(transactionLegKey));
    expect(keys.size).toBe(3);
  });

  it("cannot collide a composite key with a uniqueId", () => {
    const withId = leg({ uniqueId: "leg|0xhash|out|USDC|0xfrom|0xto|1" });
    expect(transactionLegKey(withId)).not.toBe(transactionLegKey(leg()));
  });

  it("treats an empty or whitespace uniqueId as absent", () => {
    expect(transactionLegKey(leg({ uniqueId: "" }))).toBe(
      transactionLegKey(leg())
    );
    expect(transactionLegKey(leg({ uniqueId: "   " }))).toBe(
      transactionLegKey(leg())
    );
  });

  it("is case-insensitive on the hash but not on addresses", () => {
    // Hex hashes are case-insensitive; Solana addresses are base58 and carry
    // meaning in their case.
    expect(transactionLegKey(leg({ hash: "0xABC" }))).toBe(
      transactionLegKey(leg({ hash: "0xabc" }))
    );
    expect(transactionLegKey(leg({ to: "Abc" }))).not.toBe(
      transactionLegKey(leg({ to: "abc" }))
    );
  });
});

describe("isSpamSuspect", () => {
  it("flags an inbound, unpriced leg as a spam suspect", () => {
    expect(
      isSpamSuspect(leg({ direction: "in", priceUnknown: true, valueUsd: 0, token: "AQ0" }))
    ).toBe(true);
  });

  it("flags an inbound $50 leg, even with a known price — below the dust floor", () => {
    expect(
      isSpamSuspect(leg({ direction: "in", priceUnknown: false, valueUsd: 50, token: "ZIK" }))
    ).toBe(true);
  });

  it("does not flag an inbound $500 leg with a known price", () => {
    expect(
      isSpamSuspect(leg({ direction: "in", priceUnknown: false, valueUsd: 500, token: "UNI" }))
    ).toBe(false);
  });

  it("never flags an outbound leg, even at $0 and priceUnknown — the direction gate", () => {
    expect(
      isSpamSuspect(leg({ direction: "out", priceUnknown: true, valueUsd: 0, token: "AQ0" }))
    ).toBe(false);
  });

  it("never flags a stablecoin at any size", () => {
    expect(
      isSpamSuspect(leg({ direction: "in", priceUnknown: false, valueUsd: 1, token: "USDC" }))
    ).toBe(false);
  });

  it("never flags a stablecoin even unpriced at $0 — the pool_size counter-example", () => {
    // This is the exact shape that sank Dune's `pool_size` field as a spam
    // signal: absent for real USDC/USDT, present for spam. A $0,
    // priceUnknown USDT/USDC leg must stay exempt so this predicate does not
    // reintroduce that same false positive by a different route.
    expect(
      isSpamSuspect(leg({ direction: "in", priceUnknown: true, valueUsd: 0, token: "USDT" }))
    ).toBe(false);
  });

  it("matches the DUST_FLOOR_USD boundary exactly, so the two cannot drift silently", () => {
    expect(
      isSpamSuspect(
        leg({ direction: "in", priceUnknown: false, valueUsd: DUST_FLOOR_USD - 0.01, token: "ZIK" })
      )
    ).toBe(true);
    expect(
      isSpamSuspect(
        leg({ direction: "in", priceUnknown: false, valueUsd: DUST_FLOOR_USD, token: "ZIK" })
      )
    ).toBe(false);
  });
});

describe("buildTransactionSample — the June 2026 fixture", () => {
  it("keeps all eight legs of one hash instead of collapsing them to one", () => {
    const all = [
      ...UNI_QUANTITIES.map((_, i) => uniLeg(i)),
      spamLeg("AQ0", 146_115_136.4178184, 0),
      spamLeg("ZIK", 425, 0),
    ];

    const result = buildTransactionSample(all);

    expect(result.legCount).toBe(10);
    expect(result.sample).toHaveLength(10);
    expect(result.sample.filter((t) => t.token === "UNI")).toHaveLength(8);
  });

  it("reports capped === false — ten legs is nowhere near the sample budget", () => {
    // The exact false positive that shipped: the old code deduped by hash,
    // then compared the full count against the shrunken sample, so a period
    // with nothing truncated claimed truncation.
    const all = [
      ...UNI_QUANTITIES.map((_, i) => uniLeg(i)),
      spamLeg("AQ0", 146_115_136.4178184, 0),
      spamLeg("ZIK", 425, 0),
    ];
    expect(buildTransactionSample(all).capped).toBe(false);
  });

  it("preserves every recipient — the detail a write-time aggregate destroys", () => {
    const sample = buildTransactionSample(
      UNI_QUANTITIES.map((_, i) => uniLeg(i))
    ).sample;
    const recipients = new Set(sample.map((t) => t.to));
    expect(recipients.size).toBe(8);
  });

  it("preserves the full quantity of the distribution", () => {
    const sample = buildTransactionSample(
      UNI_QUANTITIES.map((_, i) => uniLeg(i))
    ).sample;
    const total = sample.reduce((sum, t) => sum + parseFloat(t.value), 0);
    expect(total).toBeCloseTo(12_500_001.18897041, 6);
  });
});

describe("buildTransactionSample — dedup", () => {
  it("collapses a genuine duplicate appearing in both slices", () => {
    // One leg that is both the largest and the newest lands in the top-value
    // slice and the recent slice. It must appear once.
    const duplicated = leg({ uniqueId: "0xdup:log:0", valueUsd: 9_000_000 });
    const result = buildTransactionSample([duplicated, leg({ uniqueId: "0xother:log:0" })]);
    expect(result.sample).toHaveLength(2);
    expect(result.legCount).toBe(2);
  });

  it("collapses two rows carrying the same uniqueId", () => {
    // A transfer between two wallets this project tracks comes back from the
    // fromAddress query and the toAddress query with one uniqueId. It is one
    // leg, however many queries returned it.
    const result = buildTransactionSample([
      leg({ uniqueId: "0xsame:log:7", direction: "out" }),
      leg({ uniqueId: "0xsame:log:7", direction: "in" }),
    ]);
    expect(result.sample).toHaveLength(1);
    expect(result.legCount).toBe(1);
  });

  it("dedups legacy rows with no uniqueId via the composite key", () => {
    const legacy = leg();
    const result = buildTransactionSample([legacy, { ...legacy }]);
    expect(result.sample).toHaveLength(1);
    expect(result.capped).toBe(false);
  });

  it("does not merge distinct legacy legs that share a hash", () => {
    const result = buildTransactionSample([
      leg({ hash: "0xbatch", to: "0xalice", value: "100", valueUsd: 100 }),
      leg({ hash: "0xbatch", to: "0xbob", value: "250", valueUsd: 250 }),
      leg({ hash: "0xbatch", to: "0xcarol", value: "700", valueUsd: 700 }),
    ]);
    expect(result.sample).toHaveLength(3);
    expect(result.legCount).toBe(3);
  });

  it("mixes legacy and uniqueId-carrying rows without crashing", () => {
    const result = buildTransactionSample([
      leg({ uniqueId: "0xa:log:0" }),
      leg({ hash: "0xb", to: "0xsomewhere" }),
      leg({ hash: "0xb", to: "0xelsewhere" }),
    ]);
    expect(result.sample).toHaveLength(3);
  });

  it("never lets dedup set capped", () => {
    const dupes = Array.from({ length: 20 }, () => leg({ uniqueId: "0xone:log:0" }));
    const result = buildTransactionSample(dupes);
    expect(result.sample).toHaveLength(1);
    expect(result.legCount).toBe(1);
    expect(result.capped).toBe(false);
  });
});

describe("buildTransactionSample — the sample budget", () => {
  function spread(count: number): SampleableTransaction[] {
    // Value and recency deliberately anti-correlated, so the two slices do
    // not overlap and the union is exactly TOP + RECENT.
    return Array.from({ length: count }, (_, i) =>
      leg({
        uniqueId: `0x${i}:log:0`,
        valueUsd: count - i,
        timestamp: 1_700_000_000_000 + i,
      })
    );
  }

  it("stores everything, uncapped, when the period fits", () => {
    const result = buildTransactionSample(spread(120));
    expect(result.sample).toHaveLength(120);
    expect(result.legCount).toBe(120);
    expect(result.capped).toBe(false);
  });

  it("caps only when a leg genuinely could not fit", () => {
    const result = buildTransactionSample(spread(400));
    expect(result.legCount).toBe(400);
    expect(result.sample).toHaveLength(TOP_VALUE_SAMPLE_SIZE + RECENT_SAMPLE_SIZE);
    expect(result.capped).toBe(true);
  });

  it("keeps the largest transfers regardless of when they happened", () => {
    // The largest legs are the OLDEST here — recency-only sampling would lose
    // every one of them.
    const rows = Array.from({ length: 400 }, (_, i) =>
      leg({
        uniqueId: `0x${i}:log:0`,
        valueUsd: 400 - i,
        timestamp: 1_700_000_000_000 + i,
      })
    );
    const sample = buildTransactionSample(rows).sample;
    const values = sample.map((t) => t.valueUsd);
    expect(Math.max(...values)).toBe(400);
    expect(sample.filter((t) => t.valueUsd > 350)).toHaveLength(50);
  });

  it("caps when the two slices overlap even at exactly the budget", () => {
    // 200 legs whose largest are also its newest: the union is smaller than
    // 200, so some leg is in neither slice. That IS truncation, and a
    // `legCount > 200` test would have missed it.
    const rows = Array.from({ length: 200 }, (_, i) =>
      leg({
        uniqueId: `0x${i}:log:0`,
        valueUsd: i,
        timestamp: 1_700_000_000_000 + i,
      })
    );
    const result = buildTransactionSample(rows);
    expect(result.legCount).toBe(200);
    expect(result.sample.length).toBeLessThan(200);
    expect(result.capped).toBe(true);
  });
});

describe("buildTransactionSample — robustness", () => {
  it("returns an empty, uncapped sample for an empty period", () => {
    const result = buildTransactionSample([]);
    expect(result).toEqual({
      sample: [],
      capped: false,
      legCount: 0,
      basis: TRANSACTION_SAMPLE_BASIS,
    });
  });

  it("stamps the basis on every result so a stored sample stays explainable", () => {
    expect(buildTransactionSample([leg()]).basis).toBe(TRANSACTION_SAMPLE_BASIS);
  });

  it("tolerates non-finite values and timestamps without dropping legs", () => {
    const rows = [
      leg({ uniqueId: "0x1:log:0", valueUsd: NaN }),
      leg({ uniqueId: "0x2:log:0", timestamp: NaN }),
      leg({ uniqueId: "0x3:log:0", valueUsd: Infinity }),
    ];
    const result = buildTransactionSample(rows);
    expect(result.sample).toHaveLength(3);
    expect(result.capped).toBe(false);
  });

  it("tolerates a malformed list without throwing", () => {
    const nasty = [null, undefined, leg()] as unknown as SampleableTransaction[];
    expect(() => buildTransactionSample(nasty)).not.toThrow();
    expect(buildTransactionSample(nasty).legCount).toBe(1);
  });
});

describe("buildTransactionSample — spam floods never displace real legs from either sample slice (the AQ0/ZIK regression, at scale)", () => {
  it("keeps every real UNI leg in the sample even when spam outnumbers and outrecencies it", () => {
    const DECOY_COUNT = 60; // > TOP_VALUE_SAMPLE_SIZE (50): occupies the value slot entirely
    const SPAM_COUNT = 200; // > RECENT_SAMPLE_SIZE (150) on its own

    const REAL_TS = BLOCK_MS;
    const DECOY_TS = BLOCK_MS - 1_000_000_000_000; // ancient — never competes on recency

    // Real legs: genuine UNI transfers, priced, but deliberately valued below
    // what it takes to win a top-value slot once the decoys are in play — the
    // ONLY thing that can save them is the recency slice, which is exactly
    // what the AQ0/ZIK regression broke.
    const realLegs = UNI_QUANTITIES.map((_, i) => ({
      ...uniLeg(i),
      valueUsd: 500,
      timestamp: REAL_TS,
    }));

    // Decoys: large, genuinely priced, ancient. They exist only to occupy
    // every top-value slot so this test actually exercises the recency fix
    // rather than trivially passing through topByValue.
    const decoyLegs = Array.from({ length: DECOY_COUNT }, (_, i) =>
      leg({
        uniqueId: `0xdecoy${i}:log:0`,
        direction: "in",
        token: "ETH",
        valueUsd: 5_000_000,
        priceUnknown: false,
        timestamp: DECOY_TS,
      })
    );

    // Spam: unpriced, inbound, and — critically — every single one is more
    // recent than the real UNI legs. A pure recency sort (the pre-fix
    // behaviour) fills all 150 recent slots with spam before a single real
    // UNI leg gets a look-in.
    const spamLegs = Array.from({ length: SPAM_COUNT }, (_, i) => ({
      ...spamLeg(`SPAM${i}`, 1, i),
      timestamp: REAL_TS + 1 + i,
    }));

    const all = [...realLegs, ...decoyLegs, ...spamLegs];
    expect(realLegs.length + spamLegs.length).toBeGreaterThan(RECENT_SAMPLE_SIZE);

    const result = buildTransactionSample(all);

    const realIds = new Set(realLegs.map((l) => l.uniqueId));
    const sampleIds = new Set(result.sample.map((t) => t.uniqueId));
    for (const id of realIds) {
      expect(sampleIds.has(id)).toBe(true);
    }

    // Spam is excluded whenever non-suspect legs are available to fill the
    // slots instead — not all 200 spam legs fit, because the real and decoy
    // legs take priority in both slices.
    const spamInSample = result.sample.filter((t) => t.token.startsWith("SPAM"));
    expect(spamInSample.length).toBeLessThan(SPAM_COUNT);

    expect(result.capped).toBe(true);
  });
});
