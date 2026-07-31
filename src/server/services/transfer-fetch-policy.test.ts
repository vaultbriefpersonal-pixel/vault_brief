import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRANSFER_CATEGORIES,
  MAX_TRANSFER_PAGES,
  MAX_TX_TREASURY_FRACTION,
  MIN_MAX_REASONABLE_TX_USD,
  TRANSFERS_PER_PAGE_HEX,
  maxReasonableTxUsd,
  supportsInternalTransfers,
  transferCategoriesFor,
} from "./transfer-fetch-policy";

// These three rules decide whether a treasury's transfer history is COMPLETE.
// They matter beyond this file because historical balance reconstruction walks
// that history backwards: an incomplete fetch does not raise an error, it
// produces a wrong opening balance with nothing anywhere to say so.

describe("transferCategoriesFor — where contract-initiated transfers exist", () => {
  it("asks for `internal` on Ethereum and Polygon, the two chains Alchemy serves it on", () => {
    // Alchemy: "'internal' category is not supported on Base, it is only
    // available on Ethereum Mainnet and Polygon Mainnet." Omitting it where it
    // IS available hides most of a DAO treasury's spending — the Uniswap
    // Governance Timelock reports 63 all-time outgoing transfers with it and
    // 47 without.
    expect(transferCategoriesFor("ethereum")).toContain("internal");
    expect(transferCategoriesFor("polygon")).toContain("internal");
  });

  it("does NOT ask for `internal` on the L2s, where the request would fail", () => {
    // Asking for an unsupported category risks failing the whole query, which
    // would take that chain from incomplete history to none at all — strictly
    // worse than the omission this change exists to fix.
    for (const chain of ["arbitrum", "base", "optimism"]) {
      expect(transferCategoriesFor(chain)).not.toContain("internal");
    }
  });

  it("always asks for external and erc20, on every chain", () => {
    for (const chain of ["ethereum", "polygon", "arbitrum", "base", "optimism", "unknown"]) {
      expect(transferCategoriesFor(chain)).toEqual(
        expect.arrayContaining(["external", "erc20"])
      );
    }
  });

  it("falls back to the universally-served subset for an unknown chain", () => {
    expect(transferCategoriesFor("zksync")).toEqual([...DEFAULT_TRANSFER_CATEGORIES]);
    expect(transferCategoriesFor("")).toEqual([...DEFAULT_TRANSFER_CATEGORIES]);
  });

  it("returns a fresh array each call — a caller must not mutate the policy", () => {
    const a = transferCategoriesFor("ethereum");
    a.push("erc721");
    expect(transferCategoriesFor("ethereum")).not.toContain("erc721");
  });

  it("supportsInternalTransfers agrees with the category list it derives from", () => {
    expect(supportsInternalTransfers("ethereum")).toBe(true);
    expect(supportsInternalTransfers("polygon")).toBe(true);
    expect(supportsInternalTransfers("base")).toBe(false);
    expect(supportsInternalTransfers("arbitrum")).toBe(false);
    expect(supportsInternalTransfers("optimism")).toBe(false);
    expect(supportsInternalTransfers("unknown")).toBe(false);
  });
});

describe("maxReasonableTxUsd — the scam-token ceiling, scaled", () => {
  it("keeps the $50M floor for a small treasury", () => {
    // 0.25 * $1M = $250K would zero perfectly ordinary transfers. The floor is
    // what stops the proportional rule from becoming a cap of nearly nothing.
    expect(maxReasonableTxUsd(1_000_000)).toBe(MIN_MAX_REASONABLE_TX_USD);
    expect(maxReasonableTxUsd(50_000_000)).toBe(MIN_MAX_REASONABLE_TX_USD);
  });

  it("scales with a large treasury — the $1.06B case that was being truncated", () => {
    // A real $60M transfer on this treasury used to be silently zeroed by the
    // flat ceiling and dropped out of burn entirely.
    const cap = maxReasonableTxUsd(1_060_000_000);
    expect(cap).toBe(1_060_000_000 * MAX_TX_TREASURY_FRACTION);
    expect(cap).toBeGreaterThan(60_000_000);
  });

  it("crosses over from floor to proportional at exactly 4x the floor", () => {
    const crossover = MIN_MAX_REASONABLE_TX_USD / MAX_TX_TREASURY_FRACTION;
    expect(maxReasonableTxUsd(crossover)).toBe(MIN_MAX_REASONABLE_TX_USD);
    expect(maxReasonableTxUsd(crossover + 4)).toBeGreaterThan(
      MIN_MAX_REASONABLE_TX_USD
    );
  });

  it("falls back to the floor for a missing, zero, negative or non-finite balance", () => {
    // Never returns 0 or NaN: a cap of zero would zero EVERY transfer, turning
    // a missing balance into a report of no activity at all.
    for (const bad of [0, -1, NaN, Infinity, undefined as unknown as number]) {
      expect(maxReasonableTxUsd(bad)).toBe(MIN_MAX_REASONABLE_TX_USD);
    }
  });
});

describe("paging constants", () => {
  it("asks Alchemy for its per-page maximum", () => {
    expect(parseInt(TRANSFERS_PER_PAGE_HEX, 16)).toBe(1000);
  });

  it("caps a single wallet-direction fetch well above any real treasury period", () => {
    // The cap exists to bound a pathological address, not to trim normal
    // history — so it must be unreachable in ordinary operation.
    expect(MAX_TRANSFER_PAGES * parseInt(TRANSFERS_PER_PAGE_HEX, 16)).toBe(20_000);
  });
});
