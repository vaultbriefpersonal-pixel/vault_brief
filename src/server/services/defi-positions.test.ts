import { describe, it, expect } from "vitest";
import { extractDefiPositions, totalDefiUsd } from "./defi-positions";

const STETH = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
const RETH = "0xae78736cd615f374d3085123a210448e74fc6393";

describe("extractDefiPositions", () => {
  it("returns [] for non-array input (defensive against malformed/legacy data)", () => {
    expect(extractDefiPositions(null)).toEqual([]);
    expect(extractDefiPositions(undefined)).toEqual([]);
    expect(extractDefiPositions({})).toEqual([]);
    expect(extractDefiPositions("garbage")).toEqual([]);
  });

  it("returns [] when no tokens match a known contract", () => {
    const balancesDetail = [
      {
        chain: "ethereum",
        tokens: [
          { symbol: "USDC", contractAddress: "0xnotknown", valueUsd: 1000 },
        ],
      },
    ];
    expect(extractDefiPositions(balancesDetail)).toEqual([]);
  });

  it("classifies a known LSD token held directly in an ethereum wallet", () => {
    const balancesDetail = [
      {
        chain: "ethereum",
        tokens: [
          { symbol: "stETH", contractAddress: STETH, valueUsd: 250000 },
          { symbol: "USDC", contractAddress: "0xusdc", valueUsd: 1000 },
        ],
      },
    ];
    const positions = extractDefiPositions(balancesDetail);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({
      symbol: "stETH",
      protocol: "Lido",
      chain: "ethereum",
      valueUsd: 250000,
    });
  });

  it("is case-insensitive on contract address", () => {
    const balancesDetail = [
      {
        chain: "ethereum",
        tokens: [
          {
            symbol: "stETH",
            contractAddress: STETH.toUpperCase(),
            valueUsd: 500,
          },
        ],
      },
    ];
    expect(extractDefiPositions(balancesDetail)).toHaveLength(1);
  });

  it("ignores non-ethereum wallets even if the contract address matches by coincidence", () => {
    const balancesDetail = [
      {
        chain: "polygon",
        tokens: [{ symbol: "stETH", contractAddress: STETH, valueUsd: 100 }],
      },
    ];
    expect(extractDefiPositions(balancesDetail)).toEqual([]);
  });

  it("skips zero-value matches", () => {
    const balancesDetail = [
      {
        chain: "ethereum",
        tokens: [{ symbol: "stETH", contractAddress: STETH, valueUsd: 0 }],
      },
    ];
    expect(extractDefiPositions(balancesDetail)).toEqual([]);
  });

  it("aggregates across multiple wallets and sorts descending by value", () => {
    const balancesDetail = [
      {
        chain: "ethereum",
        tokens: [{ symbol: "rETH", contractAddress: RETH, valueUsd: 10000 }],
      },
      {
        chain: "ethereum",
        tokens: [{ symbol: "stETH", contractAddress: STETH, valueUsd: 90000 }],
      },
    ];
    const positions = extractDefiPositions(balancesDetail);
    expect(positions.map((p) => p.symbol)).toEqual(["stETH", "rETH"]);
  });
});

describe("totalDefiUsd", () => {
  it("sums position values", () => {
    expect(
      totalDefiUsd([
        { symbol: "stETH", protocol: "Lido", chain: "ethereum", valueUsd: 100 },
        { symbol: "rETH", protocol: "Rocket Pool", chain: "ethereum", valueUsd: 50 },
      ])
    ).toBe(150);
  });

  it("returns 0 for an empty list", () => {
    expect(totalDefiUsd([])).toBe(0);
  });
});
