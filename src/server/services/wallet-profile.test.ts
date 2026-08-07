import { describe, it, expect } from "vitest";
import {
  profileWallet,
  judgeWalletSet,
  MATERIAL_WALLET_USD,
  SPENDABLE_SHARE_FLOOR,
  type WalletBalanceView,
} from "./wallet-balances";

/** A synced wallet with the four buckets set explicitly. */
function view(
  fields: Partial<WalletBalanceView> & {
    totalUsd: number;
    stablecoinsUsd: number;
    liquidCryptoUsd: number;
  }
): WalletBalanceView {
  return {
    chain: "ethereum",
    address: "0xAAA",
    state: "synced",
    ownTokenUsd: 0,
    otherUsd: 0,
    unpricedCount: 0,
    warnings: [],
    ...fields,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The six wallets actually verified on-chain during the session that produced
// this module. These are the regression net: the threshold cannot be moved
// without one of them changing verdict, which is the point.
// ─────────────────────────────────────────────────────────────────────────────
const REAL = {
  /** Governance multisig mistaken for the treasury. $78 spendable of $162.8K. */
  thresholdCouncil: view({
    address: "0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f",
    totalUsd: 162_800,
    stablecoinsUsd: 0,
    liquidCryptoUsd: 78,
    ownTokenUsd: 162_500,
  }),
  /** The real Threshold treasury, found only after going to the docs. */
  thresholdTreasuryGuild: view({
    address: "0x71E47a4429d35827e0312AA13162197C23287546",
    totalUsd: 675_424,
    stablecoinsUsd: 234_300,
    liquidCryptoUsd: 0,
    ownTokenUsd: 300_000,
  }),
  /** ~72% GTC and unambiguously a real treasury — the trap for a naive rule. */
  gitcoinTimelock: view({
    address: "0x57a8865cfB1eCEf7253c27da6B4BC3dAEE5Be518",
    totalUsd: 1_462_561,
    stablecoinsUsd: 2_502,
    liquidCryptoUsd: 265_891,
    ownTokenUsd: 1_050_615,
  }),
  /** 90% ETH, zero stablecoins. Must not be flagged for lacking stables. */
  gitcoinMatchingPool: view({
    address: "0xde21F729137C5Af1b01d73aF1dC21eFfa2B8a0d6",
    totalUsd: 948_620,
    stablecoinsUsd: 0,
    liquidCryptoUsd: 859_440,
  }),
  gitcoinNewSafe: view({
    address: "0x5743E35477363241300FcEdc2F5eB0195F300817",
    totalUsd: 5_133_045,
    stablecoinsUsd: 4_999_020,
    liquidCryptoUsd: 134_025,
  }),
  gitcoinEcosystemCollective: view({
    address: "0xC23DA3Ca9300571B9CF43298228353cbb3E1b4c0",
    totalUsd: 81_737,
    stablecoinsUsd: 81_737,
    liquidCryptoUsd: 0,
  }),
};

describe("profileWallet — against the wallets this was built from", () => {
  it("flags the governance multisig that was mistaken for a treasury", () => {
    const p = profileWallet(REAL.thresholdCouncil)!;
    expect(p.holdsNothingSpendable).toBe(true);
    expect(p.spendableUsd).toBe(78);
    expect(p.spendableShare).toBeLessThan(0.001);
  });

  it.each([
    ["Threshold Treasury Guild", REAL.thresholdTreasuryGuild],
    ["Gitcoin GTC Timelock", REAL.gitcoinTimelock],
    ["Gitcoin Matching Pool", REAL.gitcoinMatchingPool],
    ["Gitcoin new Safe", REAL.gitcoinNewSafe],
    ["Gitcoin Ecosystem Collective", REAL.gitcoinEcosystemCollective],
  ])("does not flag %s", (_label, v) => {
    expect(profileWallet(v)!.holdsNothingSpendable).toBe(false);
  });

  // The rule this module exists to NOT be. Gitcoin's Timelock is ~72% its own
  // token and is a real treasury; concentration describes risk, not identity.
  it("does not treat own-token concentration as the discriminator", () => {
    const p = profileWallet(REAL.gitcoinTimelock)!;
    const ownShare = REAL.gitcoinTimelock.ownTokenUsd! / REAL.gitcoinTimelock.totalUsd!;
    expect(ownShare).toBeGreaterThan(0.7);
    expect(p.holdsNothingSpendable).toBe(false);
  });

  // Liquid crypto counts as spendable, so a treasury holding only ETH and no
  // stablecoins is not flagged for it.
  it("counts ETH-only holdings as spendable", () => {
    expect(profileWallet(REAL.gitcoinMatchingPool)!.spendableShare).toBeGreaterThan(0.9);
  });

  it("leaves a comfortable margin between the flagged and unflagged wallets", () => {
    const flagged = profileWallet(REAL.thresholdCouncil)!.spendableShare;
    const nearestClean = profileWallet(REAL.gitcoinTimelock)!.spendableShare;
    expect(flagged).toBeLessThan(SPENDABLE_SHARE_FLOOR);
    expect(nearestClean).toBeGreaterThan(SPENDABLE_SHARE_FLOOR * 5);
  });
});

describe("profileWallet — when it declines to have an opinion", () => {
  it("returns null below the materiality floor", () => {
    const dust = view({
      totalUsd: MATERIAL_WALLET_USD - 1,
      stablecoinsUsd: 0,
      liquidCryptoUsd: 0,
      ownTokenUsd: MATERIAL_WALLET_USD - 1,
    });
    expect(profileWallet(dust)).toBeNull();
  });

  it.each(["failed", "notInSnapshot", "neverSynced"] as const)(
    "returns null for a %s wallet rather than guessing",
    (state) => {
      const v: WalletBalanceView = {
        chain: "ethereum",
        address: "0xAAA",
        state,
        totalUsd: null,
        stablecoinsUsd: null,
        liquidCryptoUsd: null,
        ownTokenUsd: null,
        otherUsd: null,
        unpricedCount: null,
        warnings: [],
      };
      expect(profileWallet(v)).toBeNull();
    }
  );

  // A page-capped read is a floor, but the buckets it did read are real, so
  // the shape is still characterisable.
  it("still profiles a truncated wallet", () => {
    expect(
      profileWallet({ ...REAL.thresholdCouncil, state: "truncated" })
    ).not.toBeNull();
  });
});

describe("judgeWalletSet", () => {
  it("flags a set where nothing at all can be spent", () => {
    const verdict = judgeWalletSet([REAL.thresholdCouncil]);
    expect(verdict.noSpendableReserves).toBe(true);
    expect(verdict.materialCount).toBe(1);
    expect(verdict.nothingSpendableCount).toBe(1);
  });

  it("clears the real Gitcoin set", () => {
    const verdict = judgeWalletSet([
      REAL.gitcoinNewSafe,
      REAL.gitcoinMatchingPool,
      REAL.gitcoinTimelock,
      REAL.gitcoinEcosystemCollective,
    ]);
    expect(verdict.noSpendableReserves).toBe(false);
    expect(verdict.materialCount).toBe(4);
    expect(verdict.nothingSpendableCount).toBe(0);
  });

  // All-or-nothing, not any: one own-token-heavy wallet beside a funded one is
  // an ordinary treasury structure and must not raise an alarm.
  it("stays silent when one wallet is barren but another is funded", () => {
    const verdict = judgeWalletSet([REAL.thresholdCouncil, REAL.gitcoinNewSafe]);
    expect(verdict.nothingSpendableCount).toBe(1);
    expect(verdict.noSpendableReserves).toBe(false);
  });

  // The Threshold set as originally configured: one governance multisig with
  // the value, five empty wallets. The empty ones are immaterial and drop out,
  // leaving a set that is entirely unspendable.
  it("reproduces the original Threshold misconfiguration", () => {
    const empties = ["arbitrum", "optimism", "polygon", "base"].map((chain) =>
      view({ chain, totalUsd: 0, stablecoinsUsd: 0, liquidCryptoUsd: 0 })
    );
    const verdict = judgeWalletSet([REAL.thresholdCouncil, ...empties]);
    expect(verdict.materialCount).toBe(1);
    expect(verdict.noSpendableReserves).toBe(true);
  });

  it("has no opinion on a set with nothing material in it", () => {
    const verdict = judgeWalletSet([
      view({ totalUsd: 100, stablecoinsUsd: 0, liquidCryptoUsd: 0 }),
    ]);
    expect(verdict.materialCount).toBe(0);
    expect(verdict.noSpendableReserves).toBe(false);
  });

  it("has no opinion on an empty set", () => {
    expect(judgeWalletSet([]).noSpendableReserves).toBe(false);
  });
});
