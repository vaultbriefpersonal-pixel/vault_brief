import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decodeArrayLength,
  decodeUint256,
  rpcUrlFor,
  getSafeInfo,
} from "./safe-info";

// Builds ABI-encoded fixtures programmatically rather than hand-counting
// hex digits — a single miscounted zero in a manually-written 64-char
// word is exactly the kind of bug this test exists to catch.
function padWord(hexValue: string): string {
  return hexValue.padStart(64, "0");
}

/** getOwners() response: [offset(32B)=0x20][length(32B)][elements...].
 * We only ever read the length word, so the trailing elements can be
 * omitted entirely for these fixtures. */
function encodeOwnersArray(length: number): string {
  return "0x" + padWord("20") + padWord(length.toString(16));
}

function encodeUint256Hex(value: number): string {
  return "0x" + padWord(value.toString(16));
}

describe("decodeArrayLength", () => {
  it("reads the length word from an ABI-encoded dynamic array", () => {
    expect(decodeArrayLength(encodeOwnersArray(5))).toBe(5);
    expect(decodeArrayLength(encodeOwnersArray(1))).toBe(1);
    expect(decodeArrayLength(encodeOwnersArray(0))).toBe(0);
  });
});

describe("decodeUint256", () => {
  it("decodes a 32-byte hex word as a number", () => {
    expect(decodeUint256(encodeUint256Hex(3))).toBe(3);
    expect(decodeUint256(encodeUint256Hex(0))).toBe(0);
    expect(decodeUint256(encodeUint256Hex(255))).toBe(255);
  });
});

describe("rpcUrlFor", () => {
  const ORIGINAL_KEY = process.env.ALCHEMY_API_KEY;

  afterEach(() => {
    process.env.ALCHEMY_API_KEY = ORIGINAL_KEY;
  });

  it("builds an Alchemy URL for each supported EVM chain", () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    expect(rpcUrlFor("ethereum")).toBe(
      "https://eth-mainnet.g.alchemy.com/v2/test-key"
    );
    expect(rpcUrlFor("polygon")).toContain("polygon-mainnet.g.alchemy.com");
    expect(rpcUrlFor("arbitrum")).toContain("arb-mainnet.g.alchemy.com");
    expect(rpcUrlFor("base")).toContain("base-mainnet.g.alchemy.com");
    expect(rpcUrlFor("optimism")).toContain("opt-mainnet.g.alchemy.com");
  });

  it("returns null for solana (no Safe concept) and unknown chains", () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    expect(rpcUrlFor("solana")).toBeNull();
    expect(rpcUrlFor("not-a-real-chain")).toBeNull();
  });

  it("returns null when ALCHEMY_API_KEY isn't configured", () => {
    delete process.env.ALCHEMY_API_KEY;
    expect(rpcUrlFor("ethereum")).toBeNull();
  });
});

describe("getSafeInfo", () => {
  const ORIGINAL_KEY = process.env.ALCHEMY_API_KEY;
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    process.env.ALCHEMY_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.ALCHEMY_API_KEY = ORIGINAL_KEY;
    global.fetch = ORIGINAL_FETCH;
  });

  function mockRpcResponses(ownersHex: string, thresholdHex: string) {
    // The two eth_call requests (getOwners, getThreshold) fire in
    // parallel via Promise.all — order of the two fetch calls isn't
    // guaranteed, so branch on the calldata selector in the request body.
    global.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        params: [{ data: string }, string];
      };
      const selector = body.params[0].data;
      const result = selector === "0xa0e67e2b" ? ownersHex : thresholdHex;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
        status: 200,
      });
    }) as typeof fetch;
  }

  it("returns owner count + threshold for a valid Safe response", async () => {
    mockRpcResponses(encodeOwnersArray(5), encodeUint256Hex(3));
    const info = await getSafeInfo("0xSafeAddress", "ethereum");
    expect(info).toEqual({ ownerCount: 5, threshold: 3 });
  });

  it("rejects a threshold greater than the owner count (decode garbage / not a Safe)", async () => {
    mockRpcResponses(encodeOwnersArray(2), encodeUint256Hex(9));
    expect(await getSafeInfo("0xNotASafe", "ethereum")).toBeNull();
  });

  it("rejects a zero owner count", async () => {
    mockRpcResponses(encodeOwnersArray(0), encodeUint256Hex(1));
    expect(await getSafeInfo("0xEmpty", "ethereum")).toBeNull();
  });

  it("fails open when the RPC call throws", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network error");
    }) as typeof fetch;
    expect(await getSafeInfo("0xUnreachable", "ethereum")).toBeNull();
  });

  it("fails open when the JSON-RPC response has no result (e.g. call reverted)", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: {} }), {
          status: 200,
        })
    ) as typeof fetch;
    expect(await getSafeInfo("0xReverted", "ethereum")).toBeNull();
  });

  it("returns null without making a network call when the chain has no RPC configured", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    expect(await getSafeInfo("0xSolanaAddr", "solana")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
