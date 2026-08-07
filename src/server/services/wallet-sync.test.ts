import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWalletBalance, mapAlchemyTokens } from "./wallet-sync";
import type { AlchemyTokenRow } from "./wallet-sync";
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

/** One Portfolio API page. Pass `pageKey` to chain another. */
function page(tokens: unknown[], pageKey: string | null = null): Response {
  return new Response(JSON.stringify({ data: { tokens, pageKey } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Serve the given pages in order, one per fetch call. */
function mockAlchemyPages(...pages: Response[]) {
  const spy = vi.spyOn(globalThis, "fetch");
  for (const p of pages) spy.mockResolvedValueOnce(p);
  return spy;
}

const UNI_CONTRACT = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
const STETH_CONTRACT = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
const USDC_CONTRACT = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

/**
 * Copied from a live
 * `POST https://api.g.alchemy.com/data/v1/{key}/assets/tokens/by-address`
 * response.
 *
 * PROVIDER MIGRATION (2026-08): this file used to fixture Dune Sim, whose API
 * was sunset on 2026-08-01 and answered every balance request with HTTP 410 —
 * writing $0.00 treasuries for five days before anyone noticed. The shape
 * differences that matter are all load-bearing and all tested below: the
 * balance is HEX (not a decimal string), the price is an ARRAY (not a scalar),
 * the contract lives on `tokenAddress` (not `address`, which is now the
 * WALLET), and the native token arrives with entirely null metadata.
 */
const LIVE_UNI_BALANCE: AlchemyTokenRow = {
  address: "0x1a9c8182c09f50c8318d769245bea52c32be35bc",
  network: "eth-mainnet",
  tokenAddress: UNI_CONTRACT,
  tokenBalance: "0xdcf801b20b078862f3fa80", // 267,134,858.47907 × 1e18
  tokenMetadata: { symbol: "UNI", name: "Uniswap", decimals: 18 },
  tokenPrices: [{ currency: "usd", value: "4.0151825139540005" }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchWalletBalance — contract address persistence", () => {
  it("reads the contract address from a real Alchemy balance element", async () => {
    const address = "0x1a9c8182c09f50c8318d769245bea52c32be35bc";
    mockAlchemyPages(page([LIVE_UNI_BALANCE]));

    const summary = await fetchWalletBalance(evmWallet(address));

    expect(summary.tokens).toHaveLength(1);
    expect(summary.tokens[0].contractAddress).toBe(UNI_CONTRACT);
    expect(summary.tokens[0].symbol).toBe("UNI");
    expect(summary.tokens[0].amount).toBeCloseTo(267_134_858.47907, 4);
    expect(summary.tokens[0].priceUsd).toBe(4.0151825139540005);
  });

  it("survives the round trip through JSON, which is how it reaches the database", async () => {
    // The original bug was invisible in memory: `contractAddress: undefined`
    // reads fine, then JSON.stringify silently deletes the key. Asserting the
    // parsed shape is what actually pins the fix.
    const address = "0x2a9c8182c09f50c8318d769245bea52c32be35bc";
    mockAlchemyPages(page([LIVE_UNI_BALANCE]));

    const summary = await fetchWalletBalance(evmWallet(address));
    const stored = JSON.parse(JSON.stringify(summary.tokens)) as Record<
      string,
      unknown
    >[];

    expect(Object.hasOwn(stored[0], "contractAddress")).toBe(true);
    expect(stored[0].contractAddress).toBe(UNI_CONTRACT);
  });

  it("stores exactly the six fields the pipeline consumes, and no provider extras", async () => {
    const address = "0x3a9c8182c09f50c8318d769245bea52c32be35bc";
    mockAlchemyPages(page([LIVE_UNI_BALANCE]));

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

  it("gives the native token an explicit null contract and an identity from CHAINS", async () => {
    // Alchemy returns the native balance with tokenAddress null AND every
    // metadata field null. Without the CHAINS fallback a treasury's gas
    // reserve would store as an unnamed asset and stop classifying as liquid.
    const address = "0x4a9c8182c09f50c8318d769245bea52c32be35bc";
    mockAlchemyPages(
      page([
        {
          tokenAddress: null,
          tokenBalance: "0x4563918244f40000", // 5e18
          tokenMetadata: { symbol: null, name: null, decimals: null },
          tokenPrices: [{ currency: "usd", value: "3000" }],
        },
      ])
    );

    const summary = await fetchWalletBalance(evmWallet(address));
    const stored = JSON.parse(JSON.stringify(summary.tokens)) as Record<
      string,
      unknown
    >[];

    expect(summary.tokens[0].contractAddress).toBeNull();
    expect(Object.hasOwn(stored[0], "contractAddress")).toBe(true);
    expect(stored[0].contractAddress).toBeNull();
    expect(summary.tokens[0].symbol).toBe("ETH");
    expect(summary.tokens[0].amount).toBe(5);
    expect(summary.tokens[0].valueUsd).toBe(15_000);
  });

  it("uses the chain's own native symbol, not a hardcoded ETH", async () => {
    const address = "0x4b9c8182c09f50c8318d769245bea52c32be35bc";
    mockAlchemyPages(
      page([
        {
          tokenAddress: null,
          tokenBalance: "0x4563918244f40000",
          tokenMetadata: { symbol: null, name: null, decimals: null },
          tokenPrices: [{ currency: "usd", value: "1" }],
        },
      ])
    );

    const summary = await fetchWalletBalance(evmWallet(address, "polygon"));
    expect(summary.tokens[0].symbol).toBe("MATIC");
  });
});

describe("fetchWalletBalance — pagination", () => {
  it("follows pageKey, because Alchemy does not sort by value", async () => {
    // THE regression this suite exists for. Verified against a real treasury
    // (0xFafd…71C1): its entire $240K USDC position sat on page 2, behind 91
    // rows of dust. Reading page 1 alone reported that wallet as ~$95.
    const address = "0x8a9c8182c09f50c8318d769245bea52c32be35bc";
    mockAlchemyPages(
      page(
        [
          {
            tokenAddress: null,
            tokenBalance: "0x4563918244f40000", // 5 ETH
            tokenMetadata: { symbol: null, name: null, decimals: null },
            tokenPrices: [{ currency: "usd", value: "10" }],
          },
        ],
        "page-2-key"
      ),
      page([
        {
          tokenAddress: USDC_CONTRACT,
          tokenBalance: "0x3a35294400", // 250,000 USDC (6dp)
          tokenMetadata: { symbol: "USDC", name: "USD Coin", decimals: 6 },
          tokenPrices: [{ currency: "usd", value: "1" }],
        },
      ])
    );

    const summary = await fetchWalletBalance(evmWallet(address));

    expect(summary.tokens).toHaveLength(2);
    expect(summary.totalUsd).toBe(250_050);
    expect(summary.tokens.map((t) => t.symbol).sort()).toEqual(["ETH", "USDC"]);
  });

  it("stops at the page cap and flags the total as a floor rather than truncating silently", async () => {
    const address = "0x9a9c8182c09f50c8318d769245bea52c32be35bc";
    // Always hands back another pageKey — an unbounded wallet.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      page(
        [
          {
            tokenAddress: USDC_CONTRACT,
            tokenBalance: "0x3a35294400",
            tokenMetadata: { symbol: "USDC", name: "USD Coin", decimals: 6 },
            tokenPrices: [{ currency: "usd", value: "1" }],
          },
        ],
        "always-another-page"
      )
    );

    const summary = await fetchWalletBalance(evmWallet(address));

    expect(summary.truncated).toBe(true);
    // The pages it did read are real money and are kept, not discarded.
    expect(summary.totalUsd).toBeGreaterThan(0);
  });
});

describe("mapAlchemyTokens — the value arithmetic", () => {
  it("drops zero balances instead of storing them", () => {
    // A real wallet came back with 151 rows of which one had value. Storing
    // the rest would turn balances_detail into a spam log and pollute every
    // composition percentage computed from it.
    const rows: AlchemyTokenRow[] = [
      {
        tokenAddress: "0xspam",
        tokenBalance: "0x0",
        tokenMetadata: { symbol: "SPAM", name: "Spam", decimals: 18 },
        tokenPrices: [],
      },
      LIVE_UNI_BALANCE,
    ];

    const mapped = mapAlchemyTokens(rows, "ethereum");
    expect(mapped).toHaveLength(1);
    expect(mapped[0].symbol).toBe("UNI");
  });

  it("keeps an unpriced holding at price zero rather than discarding it", () => {
    // `isUnpricedHolding` downstream detects amount > 0 with priceUsd === 0
    // and reports the count. Dropping these would hide them entirely.
    const mapped = mapAlchemyTokens(
      [
        {
          tokenAddress: "0xabc",
          tokenBalance: "0xde0b6b3a7640000", // 1e18
          tokenMetadata: { symbol: "OBSCURE", name: "Obscure", decimals: 18 },
          tokenPrices: [],
        },
      ],
      "ethereum"
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0].amount).toBe(1);
    expect(mapped[0].priceUsd).toBe(0);
    expect(mapped[0].valueUsd).toBe(0);
  });

  it("ignores a non-USD price rather than reading it as dollars", () => {
    const mapped = mapAlchemyTokens(
      [
        {
          tokenAddress: "0xabc",
          tokenBalance: "0xde0b6b3a7640000",
          tokenMetadata: { symbol: "TOK", name: "Tok", decimals: 18 },
          tokenPrices: [{ currency: "eur", value: "500" }],
        },
      ],
      "ethereum"
    );

    expect(mapped[0].priceUsd).toBe(0);
  });

  it("skips a malformed balance without losing the rest of the wallet", () => {
    const mapped = mapAlchemyTokens(
      [
        {
          tokenAddress: "0xbad",
          tokenBalance: "not-hex",
          tokenMetadata: { symbol: "BAD", name: "Bad", decimals: 18 },
          tokenPrices: [{ currency: "usd", value: "1" }],
        },
        LIVE_UNI_BALANCE,
      ],
      "ethereum"
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0].symbol).toBe("UNI");
  });

  it("degrades to a null contract when a provider renames the field again", () => {
    // Nothing serves this shape today; the check exists so the next rename
    // stores "no contract" instead of throwing mid-sync.
    const mapped = mapAlchemyTokens(
      [
        {
          tokenAddress: undefined as unknown as string | null,
          tokenBalance: "0xde0b6b3a7640000",
          tokenMetadata: { symbol: "UNI", name: "Uniswap", decimals: 18 },
          tokenPrices: [{ currency: "usd", value: "4" }],
        },
      ],
      "ethereum"
    );

    expect(mapped[0].contractAddress).toBeNull();
    expect(mapped[0].valueUsd).toBe(4);
  });
});

describe("fetchWalletBalance — what the persisted shape unlocks downstream", () => {
  it("produces a payload extractDefiPositions can match an LSD against", async () => {
    // With the contract address dropped, extractDefiPositions finds nothing at
    // all: it bails on `if (!address) continue`. This is the end-to-end path
    // that was broken once — provider response → balances_detail → LSD position.
    const address = "0x6a9c8182c09f50c8318d769245bea52c32be35bc";
    mockAlchemyPages(
      page([
        {
          tokenAddress: STETH_CONTRACT,
          tokenBalance: "0x3635c9adc5dea00000", // 1000e18
          tokenMetadata: {
            symbol: "stETH",
            name: "Liquid staked Ether 2.0",
            decimals: 18,
          },
          tokenPrices: [{ currency: "usd", value: "3000" }],
        },
      ])
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
    mockAlchemyPages(
      page([
        {
          tokenAddress: STETH_CONTRACT,
          tokenBalance: "0x3635c9adc5dea00000",
          tokenMetadata: {
            symbol: "stETH",
            name: "Liquid staked Ether 2.0",
            decimals: 18,
          },
          tokenPrices: [{ currency: "usd", value: "3000" }],
        },
      ])
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
