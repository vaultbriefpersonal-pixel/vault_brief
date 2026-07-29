import { describe, it, expect } from "vitest";
import { buildEvidenceLedger, type EvidenceItem } from "./report-evidence";
import type { ReportSectionContext } from "./report-sections";
import type { TreasurySnapshot, Project } from "@/server/db/schema";

// The tests that matter here are the ones about what the ledger REFUSES to
// say. A ledger that emits an item it should have withheld puts a sentence in
// front of an investor that the data does not support — and the model, which
// is told to select from this list and quote its figures, has no way to catch
// it. So most of what follows asserts absence.

// ─── fixtures ──────────────────────────────────────────────────────────────

interface TokenRow {
  symbol: string;
  amount: number;
  priceUsd: number;
  contractAddress?: string | null;
}

/** A `balances_detail` payload in the shape wallet-sync.ts stores. */
function detail(tokens: TokenRow[], walletAddress = "0xaaa") {
  return [
    {
      walletAddress,
      chain: "ethereum",
      tokens: tokens.map((t) => ({
        symbol: t.symbol,
        amount: t.amount,
        priceUsd: t.priceUsd,
        valueUsd: t.amount * t.priceUsd,
        contractAddress: t.contractAddress ?? null,
      })),
    },
  ];
}

function snapshot(over: Partial<TreasurySnapshot> = {}): TreasurySnapshot {
  return {
    id: "s1",
    projectId: "p1",
    snapshotDate: "2026-04-30",
    totalBalanceUsd: "1000000",
    ...over,
  } as unknown as TreasurySnapshot;
}

function project(over: Partial<Project> = {}): Project {
  return { id: "p1", name: "Test", tokenSymbol: null, ...over } as unknown as Project;
}

function ctxOf(over: Partial<ReportSectionContext> = {}): ReportSectionContext {
  const snap = over.snapshot ?? snapshot();
  const total = Number(snap.totalBalanceUsd ?? 0);
  return {
    snapshot: snap,
    prevSnapshot: null,
    trailing: [],
    project: project(),
    milestones: [],
    period: String(snap.snapshotDate).slice(0, 7),
    grants: [],
    governanceProposals: [],
    partners: [],
    asks: [],
    qaHighlights: [],
    anomalies: [],
    total,
    minSignificant: total > 0 ? total * 0.001 : 0,
    ...over,
  } as ReportSectionContext;
}

function ids(items: EvidenceItem[]): string[] {
  return items.map((i) => i.id);
}

// ─── the treasury-growth gate ──────────────────────────────────────────────
//
// Three conditions, and each test below removes exactly one of them so a
// failure names which gate stopped holding.

describe("treasury growth as a positive — the gate", () => {
  it("emits a positive when growth is flow-driven and the transactions agree", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      totalBalanceUsd: "1000000",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1200000",
      netFlowUsd: "200000",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_200_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);

    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).toContain("treasury-growth-flow");
    // The figure has to carry the flow number, not the headline delta — the
    // whole point is that the model quotes what actually moved.
    const found = positives.find((p) => p.id === "treasury-growth-flow")!;
    expect(found.figure).toContain("+$200.0K");
  });

  it("emits NO positive when the rise is price-driven, even with a real inflow alongside", () => {
    // 1,000,000 units at $1.00 → 1,010,000 units at $1.50.
    //   flow  = +10,000 units x $1.00   = +$10K   (positive! condition 1 passes)
    //   price = 1,000,000 x +$0.50      = +$500K  (dominant — condition 2 fails)
    // netFlowUsd matches the flow exactly, so reconciliation is CONSISTENT and
    // condition 3 passes too. The dominant-driver gate is the only thing
    // standing between a market rally and a "win", and this asserts it holds.
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      totalBalanceUsd: "1000000",
      balancesDetail: detail([{ symbol: "MEME", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1515000",
      netFlowUsd: "10000",
      balancesDetail: detail([{ symbol: "MEME", amount: 1_010_000, priceUsd: 1.5 }]),
    } as Partial<TreasurySnapshot>);

    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).not.toContain("treasury-growth-flow");
    // And nothing else sneaks the rise in under another name.
    expect(
      positives.some((p) => /treasur/i.test(p.claim) || /treasur/i.test(p.figure))
    ).toBe(false);
  });

  it("emits NO positive when a pure price rally moves the treasury", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      balancesDetail: detail([{ symbol: "MEME", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "3000000",
      netFlowUsd: "0",
      balancesDetail: detail([{ symbol: "MEME", amount: 1_000_000, priceUsd: 3 }]),
    } as Partial<TreasurySnapshot>);

    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(positives).toEqual([]);
  });

  it("emits NO positive when the treasury grew only because a wallet was newly tracked", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      balancesDetail: detail(
        [{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }],
        "0xaaa"
      ),
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1500000",
      netFlowUsd: "500000",
      balancesDetail: [
        ...detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }], "0xaaa"),
        ...detail([{ symbol: "USDC", amount: 500_000, priceUsd: 1 }], "0xbbb"),
      ],
    } as Partial<TreasurySnapshot>);

    const { positives, negatives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).not.toContain("treasury-growth-flow");
    // Coverage changing is itself worth disclosing.
    expect(ids(negatives)).toContain("attribution-wallet-set-changed");
  });

  it("emits NO positive when the two flow estimates diverge, and flags the divergence", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1200000",
      // Balances say +$200K arrived; the parsed transactions say +$20K.
      netFlowUsd: "20000",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_200_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);

    const { positives, negatives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).not.toContain("treasury-growth-flow");
    expect(ids(negatives)).toContain("attribution-diverging");
  });

  it("emits NO positive when there is no transaction net flow to cross-check against", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1200000",
      netFlowUsd: null,
      balancesDetail: detail([{ symbol: "USDC", amount: 1_200_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);

    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).not.toContain("treasury-growth-flow");
  });

  it("never emits a token price rise as a positive", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      tokenPriceUsd: "0.10",
      tokenHoldersCount: 1000,
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      tokenPriceUsd: "0.90",
      tokenHoldersCount: 1000,
    } as Partial<TreasurySnapshot>);

    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(positives).toEqual([]);
  });

  it("emits holder growth, which is about the project rather than the market", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      tokenHoldersCount: 1000,
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({ tokenHoldersCount: 1400 } as Partial<TreasurySnapshot>);

    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).toContain("token-holders-up");
  });
});

// ─── GitHub nullability ────────────────────────────────────────────────────

describe("GitHub activity — null is absent, not zero", () => {
  const busy = snapshot({ githubCommitsCount: 142 } as Partial<TreasurySnapshot>);

  it("produces no item when the current period has no GitHub figure at all", () => {
    const trailing = [
      snapshot({ githubCommitsCount: 20 } as Partial<TreasurySnapshot>),
      snapshot({ githubCommitsCount: 20 } as Partial<TreasurySnapshot>),
      snapshot({ githubCommitsCount: 20 } as Partial<TreasurySnapshot>),
    ];
    const { positives } = buildEvidenceLedger(
      ctxOf({
        snapshot: snapshot({ githubCommitsCount: null } as Partial<TreasurySnapshot>),
        trailing,
      })
    );
    expect(ids(positives)).not.toContain("github-commits-up");
  });

  it("treats a trailing null as no measurement — too thin a baseline to compare", () => {
    // Two of the three prior periods carry no GitHub figure. With `?? 0` those
    // would become a baseline of ~7 commits and today's 142 would read as a
    // 2,000% surge — an achievement manufactured out of an integration that
    // wasn't connected yet.
    const trailing = [
      snapshot({ githubCommitsCount: null } as Partial<TreasurySnapshot>),
      snapshot({ githubCommitsCount: null } as Partial<TreasurySnapshot>),
      snapshot({ githubCommitsCount: 20 } as Partial<TreasurySnapshot>),
    ];
    const { positives } = buildEvidenceLedger(ctxOf({ snapshot: busy, trailing }));
    expect(ids(positives)).not.toContain("github-commits-up");
  });

  it("treats a trailing zero as a real measurement of a quiet month", () => {
    // Same three periods, but the zeros were MEASURED. That is a legitimate
    // baseline, and this period genuinely ran above it.
    const trailing = [
      snapshot({ githubCommitsCount: 0 } as Partial<TreasurySnapshot>),
      snapshot({ githubCommitsCount: 0 } as Partial<TreasurySnapshot>),
      snapshot({ githubCommitsCount: 60 } as Partial<TreasurySnapshot>),
    ];
    const { positives } = buildEvidenceLedger(ctxOf({ snapshot: busy, trailing }));
    expect(ids(positives)).toContain("github-commits-up");
  });

  it("stays silent when activity is merely in line with the baseline", () => {
    const trailing = [
      snapshot({ githubCommitsCount: 140 } as Partial<TreasurySnapshot>),
      snapshot({ githubCommitsCount: 145 } as Partial<TreasurySnapshot>),
      snapshot({ githubCommitsCount: 138 } as Partial<TreasurySnapshot>),
    ];
    const { positives } = buildEvidenceLedger(ctxOf({ snapshot: busy, trailing }));
    expect(ids(positives)).not.toContain("github-commits-up");
  });

  it("ignores a tiny baseline where a percentage move means nothing", () => {
    const trailing = [
      snapshot({ githubCommitsCount: 2 } as Partial<TreasurySnapshot>),
      snapshot({ githubCommitsCount: 3 } as Partial<TreasurySnapshot>),
    ];
    const { positives } = buildEvidenceLedger(
      ctxOf({
        snapshot: snapshot({ githubCommitsCount: 6 } as Partial<TreasurySnapshot>),
        trailing,
      })
    );
    expect(ids(positives)).not.toContain("github-commits-up");
  });
});

// ─── milestones ────────────────────────────────────────────────────────────

describe("milestones", () => {
  const inPeriod = {
    id: "m1",
    title: "Audit closed",
    status: "completed",
    completedDate: "2026-04-12",
  };
  const outOfPeriod = {
    id: "m2",
    title: "Testnet launched two years ago",
    status: "completed",
    completedDate: "2024-04-12",
  };
  const delayed = {
    id: "m3",
    title: "Mainnet v2",
    status: "delayed",
    targetDate: "2026-03-01",
  };

  it("counts only milestones completed inside the reporting period", () => {
    const { positives } = buildEvidenceLedger(
      ctxOf({
        milestones: [inPeriod, outOfPeriod] as ReportSectionContext["milestones"],
      })
    );
    const claims = positives.map((p) => p.claim).join(" ");
    expect(claims).toContain("Audit closed");
    expect(claims).not.toContain("Testnet launched two years ago");
  });

  it("surfaces delayed milestones as concerns", () => {
    const { negatives } = buildEvidenceLedger(
      ctxOf({ milestones: [delayed] as ReportSectionContext["milestones"] })
    );
    expect(negatives.map((n) => n.claim).join(" ")).toContain("Mainnet v2");
  });
});

// ─── anomaly direction ─────────────────────────────────────────────────────

describe("anomalies — only the ones pointing the wrong way", () => {
  it("takes a burn-rate spike as a concern and a burn-rate drop as neither", () => {
    const up = buildEvidenceLedger(
      ctxOf({
        anomalies: [
          {
            metric: "Burn rate",
            current: 640000,
            baseline: 320000,
            changePct: 100,
            severity: "critical",
          },
        ],
      })
    );
    expect(ids(up.negatives)).toContain("anomaly-negative-0");

    const down = buildEvidenceLedger(
      ctxOf({
        anomalies: [
          {
            metric: "Burn rate",
            current: 160000,
            baseline: 320000,
            changePct: -50,
            severity: "significant",
          },
        ],
      })
    );
    // A burn DROP is not a concern — and it is not auto-promoted to a win
    // either, because the anomaly detector carries no cause for it.
    expect(down.negatives).toEqual([]);
    expect(down.positives).toEqual([]);
  });

  it("takes a treasury drop as a concern but a treasury rise as neither", () => {
    const drop = buildEvidenceLedger(
      ctxOf({
        anomalies: [
          {
            metric: "Total balance",
            current: 500000,
            baseline: 1000000,
            changePct: -50,
            severity: "significant",
          },
        ],
      })
    );
    expect(drop.negatives).toHaveLength(1);

    const rise = buildEvidenceLedger(
      ctxOf({
        anomalies: [
          {
            metric: "Total balance",
            current: 2000000,
            baseline: 1000000,
            changePct: 100,
            severity: "critical",
          },
        ],
      })
    );
    expect(rise.negatives).toEqual([]);
    expect(rise.positives).toEqual([]);
  });

  it("says nothing about a metric whose direction it cannot interpret", () => {
    const { positives, negatives } = buildEvidenceLedger(
      ctxOf({
        anomalies: [
          {
            metric: "Something nobody has taught this module about",
            current: 5,
            baseline: 1,
            changePct: 400,
            severity: "critical",
          },
        ],
      })
    );
    expect(positives).toEqual([]);
    expect(negatives).toEqual([]);
  });
});

// ─── liquidity + burn concerns ─────────────────────────────────────────────

describe("liquidity and burn concerns", () => {
  it("flags own-token concentration above the reporting floor", () => {
    const curr = snapshot({
      totalBalanceUsd: "1000000",
      balancesDetail: detail([
        { symbol: "VLT", amount: 700_000, priceUsd: 1 },
        { symbol: "USDC", amount: 300_000, priceUsd: 1 },
      ]),
    } as Partial<TreasurySnapshot>);
    const { negatives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, project: project({ tokenSymbol: "VLT" }) })
    );
    expect(ids(negatives)).toContain("concentration-high");
  });

  it("flags thin stablecoin cover and accelerating burn against a trailing average", () => {
    const trailing = [
      snapshot({ burnRateUsd: "100000" } as Partial<TreasurySnapshot>),
      snapshot({ burnRateUsd: "100000" } as Partial<TreasurySnapshot>),
    ];
    const curr = snapshot({
      totalBalanceUsd: "200000",
      burnRateUsd: "200000",
      balancesDetail: detail([{ symbol: "USDC", amount: 200_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);

    const { negatives } = buildEvidenceLedger(ctxOf({ snapshot: curr, trailing }));
    expect(ids(negatives)).toContain("stable-cover-thin");
    expect(ids(negatives)).toContain("burn-accelerating");
  });

  it("does not call burn 'decelerating' off a single period with no trailing history", () => {
    const curr = snapshot({ burnRateUsd: "10" } as Partial<TreasurySnapshot>);
    const { positives, negatives } = buildEvidenceLedger(ctxOf({ snapshot: curr }));
    expect(ids(positives)).not.toContain("burn-decelerating");
    expect(ids(negatives)).not.toContain("burn-accelerating");
  });
});

// ─── recurring income ──────────────────────────────────────────────────────

describe("recurring income direction", () => {
  it("reports a rise, and excludes one-off capital from both sides of it", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      incomeByCategory: { revenue: 100_000, funding_round: 5_000_000 },
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      incomeByCategory: { revenue: 150_000 },
    } as Partial<TreasurySnapshot>);

    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    const found = positives.find((p) => p.id === "recurring-income-up");
    expect(found).toBeDefined();
    // $100K → $150K. The $5M raise must not appear anywhere in the figure.
    expect(found!.figure).toContain("$100.0K");
    expect(found!.figure).toContain("$150.0K");
    expect(found!.figure).not.toContain("5.0M");
  });

  it("says nothing about direction when the prior period was never classified", () => {
    const prev = snapshot({ id: "s0", snapshotDate: "2026-03-31" });
    const curr = snapshot({
      incomeByCategory: { revenue: 150_000 },
    } as Partial<TreasurySnapshot>);
    const { positives, negatives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).not.toContain("recurring-income-up");
    expect(ids(negatives)).not.toContain("recurring-income-down");
  });
});

// ─── the empty and the broken ──────────────────────────────────────────────

describe("empty input", () => {
  it("returns empty arrays rather than fabricating either side", () => {
    const ledger = buildEvidenceLedger(
      ctxOf({ snapshot: snapshot({ totalBalanceUsd: null } as Partial<TreasurySnapshot>) })
    );
    expect(ledger.positives).toEqual([]);
    expect(ledger.negatives).toEqual([]);
  });

  it("returns empty arrays for a first-ever snapshot with real balances", () => {
    const curr = snapshot({
      totalBalanceUsd: "1000000",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const ledger = buildEvidenceLedger(ctxOf({ snapshot: curr }));
    expect(ledger.positives).toEqual([]);
    expect(ledger.negatives).toEqual([]);
  });
});

describe("malformed input", () => {
  it("never throws on garbage payloads, and produces nothing from them", () => {
    const curr = snapshot({
      totalBalanceUsd: "not a number",
      burnRateUsd: "NaN",
      netFlowUsd: "oops",
      balancesDetail: "not an array",
      incomeByCategory: 42,
      tokenHoldersCount: Number.NaN,
      githubCommitsCount: Number.NaN,
    } as unknown as Partial<TreasurySnapshot>);
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      balancesDetail: { nope: true },
      incomeByCategory: ["array", "not", "object"],
    } as unknown as Partial<TreasurySnapshot>);

    let ledger!: ReturnType<typeof buildEvidenceLedger>;
    expect(() => {
      ledger = buildEvidenceLedger(
        ctxOf({
          snapshot: curr,
          prevSnapshot: prev,
          trailing: [null, undefined] as unknown as ReportSectionContext["trailing"],
          milestones: [
            null,
            { id: "m", title: null, status: "delayed" },
          ] as unknown as ReportSectionContext["milestones"],
          partners: [null] as unknown as ReportSectionContext["partners"],
          anomalies: [
            null,
            { metric: 7, changePct: "x" },
          ] as unknown as ReportSectionContext["anomalies"],
        })
      );
    }).not.toThrow();

    expect(ledger.positives).toEqual([]);
    // The one legible row — a milestone with a missing title but a real status
    // — still comes through, under a placeholder label rather than "undefined".
    expect(ledger.negatives).toHaveLength(1);
    expect(ledger.negatives[0].claim).toContain("untitled milestone");
  });
});

// ─── shape ─────────────────────────────────────────────────────────────────

describe("every item carries a figure", () => {
  it("holds no item with an empty claim or an empty figure", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      tokenHoldersCount: 1000,
      incomeByCategory: { revenue: 100_000 },
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1200000",
      netFlowUsd: "200000",
      burnRateUsd: "200000",
      tokenHoldersCount: 1400,
      incomeByCategory: { revenue: 150_000 },
      balancesDetail: detail([{ symbol: "USDC", amount: 1_200_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);

    const ledger = buildEvidenceLedger(
      ctxOf({
        snapshot: curr,
        prevSnapshot: prev,
        trailing: [
          snapshot({ burnRateUsd: "100000" } as Partial<TreasurySnapshot>),
          snapshot({ burnRateUsd: "100000" } as Partial<TreasurySnapshot>),
        ],
        milestones: [
          {
            id: "m1",
            title: "Audit closed",
            status: "completed",
            completedDate: "2026-04-12",
          },
        ] as ReportSectionContext["milestones"],
      })
    );

    const all = [...ledger.positives, ...ledger.negatives];
    expect(all.length).toBeGreaterThan(0);
    for (const i of all) {
      expect(i.id.length).toBeGreaterThan(0);
      expect(i.claim.trim().length).toBeGreaterThan(0);
      expect(i.figure.trim().length).toBeGreaterThan(0);
      expect(i.figure).not.toMatch(/undefined|NaN|\[object/);
      expect(i.claim).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});
