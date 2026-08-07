import { describe, it, expect } from "vitest";
import {
  viewWalletBalances,
  walletCoverageIsPartial,
  type WalletBalanceView,
} from "./wallet-balances";

const OWN_CONTRACT = "0xCDF7028cEAB81fA0C6971208e83fA7872994bEE5";
const PROJECT = { tokenSymbol: "T", tokenContract: OWN_CONTRACT };

const USDC = {
  symbol: "USDC",
  name: "USD Coin",
  amount: 175_900,
  priceUsd: 1,
  valueUsd: 175_900,
  contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
};

const OWN_TOKEN = {
  symbol: "T",
  name: "Threshold",
  amount: 120_000_000,
  priceUsd: 0.0035,
  valueUsd: 426_100,
  contractAddress: OWN_CONTRACT,
};

const ETH = {
  symbol: "ETH",
  name: "Ether",
  amount: 5,
  priceUsd: 1900,
  valueUsd: 9_500,
  contractAddress: null,
};

/** Positive quantity, no usable price — the shape `isUnpricedHolding` catches. */
const UNPRICED = {
  symbol: "SPAM",
  name: "Airdrop",
  amount: 1_000_000,
  priceUsd: 0,
  valueUsd: 0,
  contractAddress: "0x0000000000000000000000000000000000000dead",
};

function detail(walletAddress: string, chain: string, tokens: unknown[], extra = {}) {
  return { walletAddress, chain, tokens, ...extra };
}

function only(views: WalletBalanceView[]): WalletBalanceView {
  expect(views).toHaveLength(1);
  return views[0];
}

describe("viewWalletBalances", () => {
  it("returns one view per configured wallet, in order, even when the snapshot has none of them", () => {
    const views = viewWalletBalances({
      wallets: [
        { address: "0xAAA", chain: "ethereum" },
        { address: "0xBBB", chain: "arbitrum" },
      ],
      balancesDetail: [],
      syncWarnings: null,
      project: PROJECT,
      hasSnapshot: true,
    });
    expect(views.map((v) => v.address)).toEqual(["0xAAA", "0xBBB"]);
  });

  it("classifies a synced wallet into buckets, contract-first", () => {
    const v = only(
      viewWalletBalances({
        wallets: [{ address: "0xAAA", chain: "ethereum" }],
        balancesDetail: [detail("0xAAA", "ethereum", [USDC, OWN_TOKEN, ETH])],
        syncWarnings: null,
        project: PROJECT,
        hasSnapshot: true,
      })
    );
    expect(v.state).toBe("synced");
    expect(v.stablecoinsUsd).toBe(175_900);
    expect(v.ownTokenUsd).toBe(426_100);
    expect(v.liquidCryptoUsd).toBe(9_500);
    expect(v.totalUsd).toBe(175_900 + 426_100 + 9_500);
    expect(v.warnings).toEqual([]);
  });

  // The exact hazard treasury-composition.ts documents: a spam token that
  // spoofs the project's own ticker on an unrelated contract must not be
  // counted as the project's own position.
  it("does not count a ticker-spoofing token as the project's own", () => {
    const spoof = { ...OWN_TOKEN, contractAddress: "0xbadbadbadbadbadbadbadbadbadbadbadbadbad0" };
    const v = only(
      viewWalletBalances({
        wallets: [{ address: "0xAAA", chain: "ethereum" }],
        balancesDetail: [detail("0xAAA", "ethereum", [spoof])],
        syncWarnings: null,
        project: PROJECT,
        hasSnapshot: true,
      })
    );
    expect(v.ownTokenUsd).toBe(0);
  });

  it("counts unpriced holdings without folding them into the total", () => {
    const v = only(
      viewWalletBalances({
        wallets: [{ address: "0xAAA", chain: "ethereum" }],
        balancesDetail: [detail("0xAAA", "ethereum", [USDC, UNPRICED])],
        syncWarnings: null,
        project: PROJECT,
        hasSnapshot: true,
      })
    );
    expect(v.totalUsd).toBe(175_900);
    expect(v.unpricedCount).toBe(1);
  });

  it("reports a genuinely empty wallet as $0, not as unknown", () => {
    const v = only(
      viewWalletBalances({
        wallets: [{ address: "0xAAA", chain: "ethereum" }],
        balancesDetail: [detail("0xAAA", "ethereum", [])],
        syncWarnings: null,
        project: PROJECT,
        hasSnapshot: true,
      })
    );
    expect(v.state).toBe("synced");
    expect(v.totalUsd).toBe(0);
  });

  describe("absence", () => {
    it("is neverSynced, with null figures, when no snapshot exists", () => {
      const v = only(
        viewWalletBalances({
          wallets: [{ address: "0xAAA", chain: "ethereum" }],
          balancesDetail: null,
          syncWarnings: null,
          project: PROJECT,
          hasSnapshot: false,
        })
      );
      expect(v.state).toBe("neverSynced");
      expect(v.totalUsd).toBeNull();
    });

    // The distinction the whole module exists for: absent-with-a-warning was
    // not measured; absent-without-one was added after the sync ran. Neither
    // may render as $0.
    it("is failed when absent from the snapshot AND named by a warning", () => {
      const v = only(
        viewWalletBalances({
          wallets: [{ address: "0xAAA", chain: "base" }],
          balancesDetail: [],
          syncWarnings: [
            { walletAddress: "0xAAA", chain: "base", error: "HTTP 403" },
          ],
          project: PROJECT,
          hasSnapshot: true,
        })
      );
      expect(v.state).toBe("failed");
      expect(v.totalUsd).toBeNull();
      expect(v.warnings).toEqual(["HTTP 403"]);
    });

    it("is notInSnapshot when absent with no warning", () => {
      const v = only(
        viewWalletBalances({
          wallets: [{ address: "0xAAA", chain: "ethereum" }],
          balancesDetail: [],
          syncWarnings: null,
          project: PROJECT,
          hasSnapshot: true,
        })
      );
      expect(v.state).toBe("notInSnapshot");
      expect(v.totalUsd).toBeNull();
    });
  });

  it("marks a page-capped read as truncated while keeping its figures", () => {
    const v = only(
      viewWalletBalances({
        wallets: [{ address: "0xAAA", chain: "ethereum" }],
        balancesDetail: [
          detail("0xAAA", "ethereum", [USDC], { truncated: true }),
        ],
        syncWarnings: null,
        project: PROJECT,
        hasSnapshot: true,
      })
    );
    expect(v.state).toBe("truncated");
    expect(v.totalUsd).toBe(175_900);
  });

  // The live Base case: the BALANCE read succeeded, the TRANSFER read did not.
  // Such a wallet has a real figure and a real warning at the same time, and
  // suppressing either would misrepresent it.
  it("attaches warnings to a wallet that synced successfully", () => {
    const v = only(
      viewWalletBalances({
        wallets: [{ address: "0xAAA", chain: "base" }],
        balancesDetail: [detail("0xAAA", "base", [USDC])],
        syncWarnings: [
          { walletAddress: "0xAAA", chain: "base", error: "outgoing transfers: HTTP 403" },
          { walletAddress: "0xAAA", chain: "base", error: "incoming transfers: HTTP 403" },
        ],
        project: PROJECT,
        hasSnapshot: true,
      })
    );
    expect(v.state).toBe("synced");
    expect(v.totalUsd).toBe(175_900);
    expect(v.warnings).toHaveLength(2);
  });

  describe("address matching", () => {
    it("matches EVM addresses across checksum casing", () => {
      const v = only(
        viewWalletBalances({
          wallets: [{ address: "0xAbCdEf0000000000000000000000000000000001", chain: "ethereum" }],
          balancesDetail: [
            detail("0xabcdef0000000000000000000000000000000001", "ethereum", [USDC]),
          ],
          syncWarnings: null,
          project: PROJECT,
          hasSnapshot: true,
        })
      );
      expect(v.state).toBe("synced");
    });

    // base58 is case-SENSITIVE; two Solana addresses differing only in case
    // are two different wallets and must not collapse into one row.
    it("treats Solana addresses as case-sensitive", () => {
      const v = only(
        viewWalletBalances({
          wallets: [{ address: "AbCdEf", chain: "solana" }],
          balancesDetail: [detail("abcdef", "solana", [USDC])],
          syncWarnings: null,
          project: PROJECT,
          hasSnapshot: true,
        })
      );
      expect(v.state).toBe("notInSnapshot");
    });

    it("keeps the same address on two chains apart", () => {
      const views = viewWalletBalances({
        wallets: [
          { address: "0xAAA", chain: "ethereum" },
          { address: "0xAAA", chain: "polygon" },
        ],
        balancesDetail: [detail("0xAAA", "ethereum", [USDC])],
        syncWarnings: null,
        project: PROJECT,
        hasSnapshot: true,
      });
      expect(views[0].state).toBe("synced");
      expect(views[1].state).toBe("notInSnapshot");
    });
  });

  describe("malformed payloads", () => {
    it("survives a non-array balances_detail", () => {
      const v = only(
        viewWalletBalances({
          wallets: [{ address: "0xAAA", chain: "ethereum" }],
          balancesDetail: { nope: true },
          syncWarnings: "also not an array",
          project: PROJECT,
          hasSnapshot: true,
        })
      );
      expect(v.state).toBe("notInSnapshot");
      expect(v.warnings).toEqual([]);
    });

    it("skips null entries and warnings with no message", () => {
      const v = only(
        viewWalletBalances({
          wallets: [{ address: "0xAAA", chain: "ethereum" }],
          balancesDetail: [null, detail("0xAAA", "ethereum", [USDC])],
          syncWarnings: [
            null,
            { walletAddress: "0xAAA", chain: "ethereum", error: "   " },
          ],
          project: PROJECT,
          hasSnapshot: true,
        })
      );
      expect(v.state).toBe("synced");
      expect(v.warnings).toEqual([]);
    });

    it("tolerates a null project identity", () => {
      const v = only(
        viewWalletBalances({
          wallets: [{ address: "0xAAA", chain: "ethereum" }],
          balancesDetail: [detail("0xAAA", "ethereum", [USDC])],
          syncWarnings: null,
          project: null,
          hasSnapshot: true,
        })
      );
      expect(v.stablecoinsUsd).toBe(175_900);
      expect(v.ownTokenUsd).toBe(0);
    });
  });
});

describe("walletCoverageIsPartial", () => {
  const base = {
    chain: "ethereum",
    address: "0xAAA",
    totalUsd: 1,
    stablecoinsUsd: 1,
    liquidCryptoUsd: 0,
    ownTokenUsd: 0,
    otherUsd: 0,
    unpricedCount: 0,
    warnings: [],
  };

  it("is false when every wallet synced cleanly", () => {
    expect(
      walletCoverageIsPartial([
        { ...base, state: "synced" },
        { ...base, state: "synced" },
      ])
    ).toBe(false);
  });

  it.each(["failed", "truncated", "notInSnapshot"] as const)(
    "is true when any wallet is %s",
    (state) => {
      expect(
        walletCoverageIsPartial([{ ...base, state: "synced" }, { ...base, state }])
      ).toBe(true);
    }
  );

  // A project that has never synced has no coverage problem — it has no
  // coverage at all, which the page says differently and should not
  // double-report as a partial total.
  it("is false when nothing has ever been synced", () => {
    expect(walletCoverageIsPartial([{ ...base, state: "neverSynced" }])).toBe(false);
  });
});
