import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWalletBalance } from "./wallet-sync";
import { extractDefiPositions } from "./defi-positions";
import type { Wallet } from "@/server/db/schema";

// Every test uses its own wallet address on purpose: wallet-sync keeps a
// module-level 15-minute response cache keyed `${address}:${chain}`, so two
// tests sharing an address would see the second one served the first one's
// fixture.
function evmWallet(address: string, chain = "ethereum"): Wallet {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    projectId: "22222222-2222-2222-2222-222222222222",
    address,
    chain,
    label: null,
    walletType: "eoa",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function mockDune(balances: unknown[], walletAddress: string) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ wallet_address: walletAddress, balances }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
}

const UNI_CONTRACT = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
const STETH_CONTRACT = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

/**
 * Copied verbatim from a live
 * `GET https://api.sim.dune.com/v1/evm/balances/{address}?chain_ids=1`
 * response. The contract address arrives under `address`. The interface used
 * to declare `contract_address`, which read as `undefined`, and JSON.stringify
 * then dropped the key entirely on the way into
 * `treasury_snapshots.balances_detail` — a silent total loss of token identity.
 */
const LIVE_UNI_BALANCE = {
  chain: "ethereum",
  chain_id: 1,
  address: UNI_CONTRACT,
  amount: "267134858479070410010000000",
  symbol: "UNI",
  name: "Uniswap",
  decimals: 18,
  price_usd: 4.0151825139540005,
  value_usd: 1072595212.63274,
  pool_size: 2624195.4754723003,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchWalletBalance — contract address persistence", () => {
  it("reads the contract address from a real Dune Sim balance element", async () => {
    const address = "0x1a9c8182c09f50c8318d769245bea52c32be35bc";
    mockDune([LIVE_UNI_BALANCE], address);

    const summary = await fetchWalletBalance(evmWallet(address));

    expect(summary.tokens).toHaveLength(1);
    expect(summary.tokens[0].contractAddress).toBe(UNI_CONTRACT);
    expect(summary.tokens[0].symbol).toBe("UNI");
    // 267134858479070410010000000 / 1e18
    expect(summary.tokens[0].amount).toBeCloseTo(267_134_858.47907, 4);
    expect(summary.tokens[0].priceUsd).toBe(4.0151825139540005);
  });

  it("survives the round trip through JSON, which is how it reaches the database", async () => {
    // The original bug was invisible in memory: `contractAddress: undefined`
    // reads fine, then JSON.stringify silently deletes the key. Asserting the
    // parsed shape is what actually pins the fix.
    const address = "0x2a9c8182c09f50c8318d769245bea52c32be35bc";
    mockDune([LIVE_UNI_BALANCE], address);

    const summary = await fetchWalletBalance(evmWallet(address));
    const stored = JSON.parse(JSON.stringify(summary.tokens)) as Record<
      string,
      unknown
    >[];

    expect(Object.hasOwn(stored[0], "contractAddress")).toBe(true);
    expect(stored[0].contractAddress).toBe(UNI_CONTRACT);
  });

  it("does not capture pool_size", async () => {
    // Rejected as a spam signal: absent for USDC and USDT, present for spam
    // tokens, i.e. worse than useless. Pinned so it does not creep in later.
    const address = "0x3a9c8182c09f50c8318d769245bea52c32be35bc";
    mockDune([LIVE_UNI_BALANCE], address);

    const summary = await fetchWalletBalance(evmWallet(address));

    expect(Object.keys(summary.tokens[0]).sort()).toEqual([
      "amount",
      "contractAddress",
      "name",
      "priceUsd",
      "symbol",
      "valueUsd",
    ]);
  });

  it("stores an explicit null when the element carries no address", async () => {
    const address = "0x4a9c8182c09f50c8318d769245bea52c32be35bc";
    mockDune(
      [
        {
          chain: "ethereum",
          chain_id: 1,
          amount: "5000000000000000000",
          symbol: "ETH",
          name: "Ether",
          decimals: 18,
          price_usd: 3000,
          value_usd: 15000,
        },
      ],
      address
    );

    const summary = await fetchWalletBalance(evmWallet(address));
    const stored = JSON.parse(JSON.stringify(summary.tokens)) as Record<
      string,
      unknown
    >[];

    expect(summary.tokens[0].contractAddress).toBeNull();
    expect(Object.hasOwn(stored[0], "contractAddress")).toBe(true);
    expect(stored[0].contractAddress).toBeNull();
    expect(summary.tokens[0].amount).toBe(5);
  });

  it("stores null rather than crashing on a legacy contract_address-shaped element", async () => {
    // Nothing serves this shape today; the check exists so a provider that
    // renames the field again degrades to "no contract" instead of throwing.
    const address = "0x5a9c8182c09f50c8318d769245bea52c32be35bc";
    mockDune(
      [
        {
          contract_address: UNI_CONTRACT,
          amount: "1000000000000000000",
          symbol: "UNI",
          name: "Uniswap",
          decimals: 18,
          price_usd: 4,
          value_usd: 4,
        },
      ],
      address
    );

    const summary = await fetchWalletBalance(evmWallet(address));
    expect(summary.tokens[0].contractAddress).toBeNull();
    expect(summary.totalUsd).toBe(4);
  });
});

describe("fetchWalletBalance — what the persisted shape unlocks downstream", () => {
  it("produces a payload extractDefiPositions can match an LSD against", async () => {
    // With the contract address dropped, extractDefiPositions found nothing at
    // all: it bails on `if (!address) continue`. This is the end-to-end path
    // that was broken — Dune response → stored balances_detail → LSD position.
    const address = "0x6a9c8182c09f50c8318d769245bea52c32be35bc";
    mockDune(
      [
        {
          chain: "ethereum",
          chain_id: 1,
          address: STETH_CONTRACT,
          amount: "1000000000000000000000",
          symbol: "stETH",
          name: "Liquid staked Ether 2.0",
          decimals: 18,
          price_usd: 3000,
          value_usd: 3_000_000,
        },
      ],
      address
    );

    const summary = await fetchWalletBalance(evmWallet(address));
    const balancesDetail = JSON.parse(JSON.stringify([summary]));

    expect(extractDefiPositions(balancesDetail)).toEqual([
      {
        symbol: "stETH",
        protocol: "Lido",
        chain: "ethereum",
        valueUsd: 3_000_000,
      },
    ]);
  });

  it("finds nothing once the contract address is stripped, which is the bug it fixes", async () => {
    const address = "0x7a9c8182c09f50c8318d769245bea52c32be35bc";
    mockDune(
      [
        {
          chain: "ethereum",
          chain_id: 1,
          address: STETH_CONTRACT,
          amount: "1000000000000000000000",
          symbol: "stETH",
          name: "Liquid staked Ether 2.0",
          decimals: 18,
          price_usd: 3000,
          value_usd: 3_000_000,
        },
      ],
      address
    );

    const summary = await fetchWalletBalance(evmWallet(address));
    const asStoredBefore = [
      {
        ...summary,
        tokens: summary.tokens.map(({ contractAddress: _dropped, ...rest }) => rest),
      },
    ];

    expect(extractDefiPositions(asStoredBefore)).toEqual([]);
  });
});
