import { describe, it, expect } from "vitest";
import {
  labelCounterparty,
  KNOWN_EXCHANGE_ADDRESSES,
  KNOWN_PAYROLL_CONTRACTS,
  KNOWN_AUDIT_FIRMS,
  KNOWN_INFRASTRUCTURE_ADDRESSES,
} from "./counterparty-labels";

const BINANCE = "0xd551234ae421e3bcba99a0da6d736074f22192ff";
const TRAIL_OF_BITS = "0xafd5dee72e0d6c8ec1e8c4a78e8a9bcdc97cd2ec";
const DISPERSE = "0x8d29be29923b68abfdd21e541b9374737b36aa0f";
const UNKNOWN = "0x1111111111111111111111111111111111111111";

describe("labelCounterparty", () => {
  it("labels a known exchange address", () => {
    expect(labelCounterparty(BINANCE)).toBe("Binance");
  });

  it("labels known payout and audit-firm addresses", () => {
    expect(labelCounterparty(DISPERSE)).toBe("Disperse.app");
    expect(labelCounterparty(TRAIL_OF_BITS)).toBe("Trail of Bits");
  });

  it("matches regardless of casing", () => {
    // EIP-55 checksummed, as an explorer hands it over.
    expect(labelCounterparty("0xD551234Ae421e3BCBA99A0Da6d736074f22192FF")).toBe(
      "Binance"
    );
    expect(labelCounterparty(BINANCE.toUpperCase().replace("0X", "0x"))).toBe(
      "Binance"
    );
  });

  it("tolerates surrounding whitespace from a pasted address", () => {
    expect(labelCounterparty(`  ${BINANCE}\n`)).toBe("Binance");
  });

  it("returns null for an address it does not recognise", () => {
    expect(labelCounterparty(UNKNOWN)).toBeNull();
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(labelCounterparty("")).toBeNull();
    expect(labelCounterparty("   ")).toBeNull();
  });

  it("returns null for malformed input without throwing", () => {
    const junk = ["not-an-address", "0x", "0xzzzz", "42", "🙂"];
    for (const value of junk) {
      expect(() => labelCounterparty(value)).not.toThrow();
      expect(labelCounterparty(value)).toBeNull();
    }
  });

  it("returns null rather than a prototype member for object keys", () => {
    // A plain-object lookup would answer these with Object.prototype members.
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(labelCounterparty(key)).toBeNull();
    }
  });

  it("returns null for null/undefined arriving from untyped callers", () => {
    const unsafe = labelCounterparty as (v: unknown) => string | null;
    expect(() => unsafe(null)).not.toThrow();
    expect(unsafe(null)).toBeNull();
    expect(unsafe(undefined)).toBeNull();
    expect(unsafe(42)).toBeNull();
  });
});

describe("address sets", () => {
  it("expose every address lowercased, so callers can compare directly", () => {
    const sets = [
      KNOWN_EXCHANGE_ADDRESSES,
      KNOWN_PAYROLL_CONTRACTS,
      KNOWN_AUDIT_FIRMS,
      KNOWN_INFRASTRUCTURE_ADDRESSES,
    ];
    for (const set of sets) {
      for (const addr of set) expect(addr).toBe(addr.toLowerCase());
    }
  });

  it("carry a label for every member — the sets and the map stay in sync", () => {
    const sets = [
      KNOWN_EXCHANGE_ADDRESSES,
      KNOWN_PAYROLL_CONTRACTS,
      KNOWN_AUDIT_FIRMS,
      KNOWN_INFRASTRUCTURE_ADDRESSES,
    ];
    for (const set of sets) {
      for (const addr of set) expect(labelCounterparty(addr)).toBeTruthy();
    }
  });

  it("keeps the classifier's rule precedence unambiguous — no address in two sets", () => {
    // ruleBasedClassifyOutgoing checks exchange → payroll → audit → infra in
    // order, so an address in two sets would silently take the first category.
    const all = [
      ...KNOWN_EXCHANGE_ADDRESSES,
      ...KNOWN_PAYROLL_CONTRACTS,
      ...KNOWN_AUDIT_FIRMS,
      ...KNOWN_INFRASTRUCTURE_ADDRESSES,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
