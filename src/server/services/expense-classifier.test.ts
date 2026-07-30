import { describe, it, expect } from "vitest";
import {
  buildRecurrenceSnapshot,
  classifyTransactions,
  detectRecurringPayroll,
  type RawTransaction,
} from "./expense-classifier";

// Minimal fixture — only the fields detectRecurringPayroll/buildRecurrenceSnapshot
// actually read (`to`, `valueUsd`). Direction/hash/token don't matter here.
function tx(to: string, valueUsd: number): RawTransaction {
  return {
    hash: "0xhash",
    from: "0xfrom",
    to,
    value: "0",
    token: "USDC",
    valueUsd,
    timestamp: 0,
    direction: "out",
  };
}

const PAYEE = "0xAbCdEf0000000000000000000000000000000000";

describe("detectRecurringPayroll", () => {
  it("returns 0 for an address with no prior history", () => {
    const snap = buildRecurrenceSnapshot([]);
    expect(detectRecurringPayroll(tx(PAYEE, 5000), snap)).toBe(0);
  });

  it("returns 0 with fewer than 2 prior transfers to the same address", () => {
    const snap = buildRecurrenceSnapshot([tx(PAYEE, 5000)]);
    expect(detectRecurringPayroll(tx(PAYEE, 5000), snap)).toBe(0);
  });

  it("matches case-insensitively on the `to` address", () => {
    const snap = buildRecurrenceSnapshot([
      tx(PAYEE.toLowerCase(), 5000),
      tx(PAYEE.toUpperCase(), 5000),
    ]);
    expect(detectRecurringPayroll(tx(PAYEE, 5000), snap)).toBeGreaterThan(0);
  });

  it("detects recurrence within the 15% tolerance band", () => {
    // Three prior payments close to $5,000 (within 15%) to the same address.
    const snap = buildRecurrenceSnapshot([
      tx(PAYEE, 5000),
      tx(PAYEE, 5100),
      tx(PAYEE, 4900),
    ]);
    const confidence = detectRecurringPayroll(tx(PAYEE, 5050), snap);
    expect(confidence).toBeGreaterThanOrEqual(0.7);
    expect(confidence).toBeLessThanOrEqual(0.95);
  });

  it("does not flag amounts outside the 15% tolerance band", () => {
    const snap = buildRecurrenceSnapshot([
      tx(PAYEE, 5000),
      tx(PAYEE, 5000),
      tx(PAYEE, 5000),
    ]);
    // 10,000 is 100% off from the $5,000 history — well outside 15%.
    expect(detectRecurringPayroll(tx(PAYEE, 10000), snap)).toBe(0);
  });

  it("caps confidence at 0.95 even with many matching prior transfers", () => {
    const priorTxs = Array.from({ length: 20 }, () => tx(PAYEE, 5000));
    const snap = buildRecurrenceSnapshot(priorTxs);
    expect(detectRecurringPayroll(tx(PAYEE, 5000), snap)).toBe(0.95);
  });

  it("ignores zero-value prior transfers when building history", () => {
    const snap = buildRecurrenceSnapshot([
      tx(PAYEE, 0),
      tx(PAYEE, 0),
      tx(PAYEE, 0),
    ]);
    // No usable history (all zero valueUsd is skipped) → no recurrence signal.
    expect(detectRecurringPayroll(tx(PAYEE, 5000), snap)).toBe(0);
  });
});

// ─── classifyTransactions — spam short-circuit ─────────────────────────────
//
// These call the real, exported `classifyTransactions` (it's async) with
// ONLY spam-shaped transactions, so the LLM batch path is never populated
// (rule-based matches or the new short-circuit resolve every case here) and
// the tests need no network mock and no OPENROUTER_API_KEY. Confirmed
// separately: with no API key configured, `classifyWithAI`'s own try/catch
// swallows the OpenAI client construction failure synchronously and falls
// back to a 0.5-confidence guess in well under a second — so even the "must
// NOT hit the short-circuit" cases below resolve fast and deterministically
// without a live network call, matching how the rest of this module's tests
// avoid IO.

function rawTx(overrides: Partial<RawTransaction> = {}): RawTransaction {
  return {
    hash: "0xspamhash",
    from: "0xspammer",
    to: "0xtreasury",
    value: "1",
    token: "AQ0",
    valueUsd: 0,
    timestamp: 0,
    direction: "in",
    ...overrides,
  };
}

describe("classifyTransactions — spam short-circuit", () => {
  it("classifies an inbound, unpriced, exactly-zero tx as a spam airdrop without the LLM", async () => {
    const [result] = await classifyTransactions([
      rawTx({ direction: "in", valueUsd: 0, priceUnknown: true }),
    ]);
    expect(result.category).toBe("airdrop");
    expect(result.confidence).toBe(0.3);
    expect(result.spamSuspect).toBe(true);
  });

  it("does NOT short-circuit when priceUnknown is absent, even at valueUsd 0", async () => {
    // Falls through past the short-circuit; the existing "tiny inflow" rule
    // (ruleBasedClassifyIncoming) only fires for valueUsd > 0, so this one
    // reaches the LLM path, which — with no API key configured — resolves to
    // its own documented fallback rather than a live call.
    const [result] = await classifyTransactions([
      rawTx({ direction: "in", valueUsd: 0, priceUnknown: undefined }),
    ]);
    expect(result.spamSuspect).not.toBe(true);
    expect(result.confidence).not.toBe(0.3);
    expect(result.category).toBe("other_income");
    expect(result.confidence).toBe(0.5);
  });

  it("does NOT short-circuit when priceUnknown is explicitly false, even at valueUsd 0", async () => {
    const [result] = await classifyTransactions([
      rawTx({ direction: "in", valueUsd: 0, priceUnknown: false }),
    ]);
    expect(result.spamSuspect).not.toBe(true);
    expect(result.confidence).not.toBe(0.3);
  });

  it("does NOT short-circuit a nonzero valueUsd even when priceUnknown is true", async () => {
    // The spec requires valueUsd === 0 exactly, not merely dust-sized — a $50
    // priceUnknown inflow is unusual but not the unambiguous zero-value case
    // this short-circuit exists for.
    const [result] = await classifyTransactions([
      rawTx({ direction: "in", valueUsd: 50, priceUnknown: true }),
    ]);
    expect(result.spamSuspect).not.toBe(true);
    expect(result.confidence).not.toBe(0.3);
    // Rule-based "tiny inflow" (valueUsd > 0 && < 100) catches this one
    // before it would ever reach the LLM.
    expect(result.category).toBe("other_income");
    expect(result.confidence).toBe(0.9);
  });

  it("does NOT short-circuit an outbound tx, even at valueUsd 0 and priceUnknown true — the direction gate", async () => {
    const [result] = await classifyTransactions([
      rawTx({ direction: "out", valueUsd: 0, priceUnknown: true, to: "0xsomewhere" }),
    ]);
    expect(result.spamSuspect).not.toBe(true);
    expect(result.confidence).not.toBe(0.3);
    // Rule-based outgoing classification (valueUsd < 500) catches this before
    // it would ever reach the LLM.
    expect(result.category).toBe("operational");
    expect(result.confidence).toBe(0.9);
  });
});
