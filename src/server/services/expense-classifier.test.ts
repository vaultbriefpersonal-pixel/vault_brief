import { describe, it, expect } from "vitest";
import {
  buildRecurrenceSnapshot,
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
