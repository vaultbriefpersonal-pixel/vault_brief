import { describe, it, expect } from "vitest";
import {
  buildEvidenceLedger,
  decisionLedger,
  type EvidenceItem,
} from "./report-evidence";
import { getSectionById, type ReportSectionContext } from "./report-sections";
import { periodFromRange, periodFromSnapshot } from "./report-period";
import type { TreasurySnapshot, Project, ProjectBudget } from "@/server/db/schema";

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
    // The calendar month ending on the snapshot date — exactly what the bare
    // `snapshotDate.slice(0, 7)` string stood for, and what
    // `periodFromSnapshot` reconstructs while `period_start` does not exist.
    period: periodFromSnapshot(snap),
    grants: [],
    governanceProposals: [],
    partners: [],
    asks: [],
    qaHighlights: [],
    // Added deliberately rather than left to the cast below to supply: this
    // builder ends in `as ReportSectionContext`, so a context missing a field
    // compiles silently. The evidence ledger does not read grant data today —
    // both grant sections narrate directly — but a builder that omits half the
    // context is a trap for whoever adds the first grant-derived signal.
    grantAwards: [],
    grantTranches: [],
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

// ─── the reconstruction gate (P3.1) ────────────────────────────────────────
//
// A reconstructed baseline must never produce a win. Everything the walk-back
// cannot see pushes the reconstructed opening balance DOWN, so an apparent
// increase from it is exactly what a systematically understated starting point
// produces.

describe("balance basis — a reconstructed snapshot cannot produce a win", () => {
  /** The same flow-driven growth the first suite asserts DOES emit a positive. */
  function growthPair(over: Partial<TreasurySnapshot> = {}) {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      totalBalanceUsd: "1000000",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
      ...over,
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1200000",
      netFlowUsd: "200000",
      tokenHoldersCount: 5000,
      balancesDetail: detail([{ symbol: "USDC", amount: 1_200_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    return { prev, curr };
  }

  it("still emits the win when both sides are observed — the baseline case", () => {
    const { prev, curr } = growthPair();
    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).toContain("treasury-growth-flow");
  });

  it("treats a NULL balance_basis as observed — every existing row", () => {
    const { prev, curr } = growthPair();
    expect(prev.balanceBasis).toBeUndefined();
    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).toContain("treasury-growth-flow");
  });

  it("suppresses the win when the BASELINE was reconstructed", () => {
    const { prev, curr } = growthPair({
      balanceBasis: "reconstructed",
    } as Partial<TreasurySnapshot>);
    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).not.toContain("treasury-growth-flow");
  });

  it("suppresses the win when the CURRENT snapshot was reconstructed", () => {
    const { prev, curr } = growthPair();
    const reconstructedCurr = snapshot({
      ...curr,
      balanceBasis: "reconstructed",
    } as Partial<TreasurySnapshot>);
    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: reconstructedCurr, prevSnapshot: prev })
    );
    expect(ids(positives)).not.toContain("treasury-growth-flow");
  });

  it("suppresses the win when only a TRAILING snapshot was reconstructed", () => {
    const { prev, curr } = growthPair();
    const older = snapshot({
      id: "s-1",
      snapshotDate: "2026-02-28",
      balanceBasis: "reconstructed",
    } as Partial<TreasurySnapshot>);
    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev, trailing: [prev, older] })
    );
    expect(ids(positives)).not.toContain("treasury-growth-flow");
  });

  it("suppresses holder growth too — it comes from a current-value-only feed", () => {
    const { prev, curr } = growthPair({
      tokenHoldersCount: 4000,
      balanceBasis: "reconstructed",
    } as Partial<TreasurySnapshot>);
    const { positives } = buildEvidenceLedger(
      ctxOf({ snapshot: curr, prevSnapshot: prev })
    );
    expect(ids(positives)).not.toContain("token-holders-up");
  });

  it("does NOT suppress a completed milestone — it owes nothing to the walk-back", () => {
    const { prev, curr } = growthPair({
      balanceBasis: "reconstructed",
    } as Partial<TreasurySnapshot>);
    const { positives } = buildEvidenceLedger(
      ctxOf({
        snapshot: curr,
        prevSnapshot: prev,
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
    expect(ids(positives)).toContain("milestone-completed-0");
  });

  it("does NOT suppress negatives — a false concern errs toward caution", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      balanceBasis: "reconstructed",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1000000",
      burnRateUsd: "500000",
      balancesDetail: detail([
        { symbol: "OWN", amount: 1_000_000, priceUsd: 1, contractAddress: null },
      ]),
    } as Partial<TreasurySnapshot>);
    const { negatives } = buildEvidenceLedger(
      ctxOf({
        snapshot: curr,
        prevSnapshot: prev,
        project: project({ tokenSymbol: "OWN" }),
      })
    );
    expect(ids(negatives)).toContain("concentration-high");
  });

  it("tags the decision-ledger's balance-derived entries so Recommendations cannot quote them bare", () => {
    // decisionLedger is a SECOND path to the reader — it bypasses `requires`
    // entirely — so the disclosure has to be applied here as well.
    const curr = snapshot({
      balanceBasis: "reconstructed",
      burnRateUsd: "100000",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const entries = decisionLedger(ctxOf({ snapshot: curr }));
    const balanceDerived = entries.filter(
      (e) => e.source === "liquidity" || e.source === "composition"
    );
    expect(balanceDerived.length).toBeGreaterThan(0);
    for (const e of balanceDerived) {
      expect(e.figure).toContain("RECONSTRUCTED BALANCES");
    }
  });

  it("leaves the decision ledger untagged for an observed snapshot", () => {
    const curr = snapshot({
      burnRateUsd: "100000",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const entries = decisionLedger(ctxOf({ snapshot: curr }));
    for (const e of entries) {
      expect(e.figure).not.toContain("RECONSTRUCTED");
    }
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

  // Confirmed live production bug: a milestone attached to a grant award
  // leaked into an investor report's Wins/Lows even with every grant section
  // toggled off. Grant-owned milestones belong only to
  // `grant_milestone_progress` (report-derived.ts), never to the generic
  // Wins/Lows evidence ledger.
  it("excludes a grant-owned completed milestone from positives", () => {
    const grantOwned = { ...inPeriod, grantAwardId: "award-1" };
    const { positives } = buildEvidenceLedger(
      ctxOf({
        milestones: [grantOwned] as ReportSectionContext["milestones"],
      })
    );
    expect(positives.map((p) => p.claim).join(" ")).not.toContain(
      "Audit closed"
    );
  });

  it("excludes a grant-owned delayed milestone from negatives", () => {
    const grantOwnedDelayed = { ...delayed, grantAwardId: "award-1" };
    const { negatives } = buildEvidenceLedger(
      ctxOf({
        milestones: [grantOwnedDelayed] as ReportSectionContext["milestones"],
      })
    );
    expect(negatives.map((n) => n.claim).join(" ")).not.toContain(
      "Mainnet v2"
    );
  });

  // `milestones.completedDate` is a real `date` column, so the period match is
  // the exact one and not a 'YYYY-MM' prefix. For a month the two agree; for a
  // window starting mid-month only the exact one is right.
  it("matches on the real date, not the month, at a custom period's edge", () => {
    const period = periodFromRange("2026-04-14", "2026-09-30");
    const before = {
      id: "m4",
      title: "Shipped on the 3rd",
      status: "completed",
      completedDate: "2026-04-03",
    };
    const after = {
      id: "m5",
      title: "Shipped on the 20th",
      status: "completed",
      completedDate: "2026-04-20",
    };
    const { positives } = buildEvidenceLedger(
      ctxOf({
        period,
        milestones: [before, after] as ReportSectionContext["milestones"],
      })
    );
    const claims = positives.map((p) => p.claim).join(" ");
    // Both sit in 2026-04, which the period touches — a month-prefix match
    // would have admitted the one dated eleven days before the period began.
    expect(claims).toContain("Shipped on the 20th");
    expect(claims).not.toContain("Shipped on the 3rd");
  });
});

describe("partners across a custom period", () => {
  const partner = (period: string, name: string) =>
    ({ id: `p-${period}`, period, name, type: "integration", notes: null }) as
      unknown as ReportSectionContext["partners"][number];

  it("includes rows from every month the period touches", () => {
    const { positives } = buildEvidenceLedger(
      ctxOf({
        period: periodFromRange("2026-02-14", "2026-07-31"),
        partners: [partner("2026-02", "Boundary"), partner("2026-05", "Middle")],
      })
    );
    const claims = positives.map((p) => p.claim).join(" ");
    expect(claims).toContain("Boundary");
    expect(claims).toContain("Middle");
  });

  it("quotes the ROW's own month, never the period identifier", () => {
    const { positives } = buildEvidenceLedger(
      ctxOf({
        period: periodFromRange("2026-02-14", "2026-07-31"),
        partners: [partner("2026-05", "Middle")],
      })
    );
    const figures = positives.map((p) => p.figure).join(" ");
    expect(figures).toContain("recorded against 2026-05");
    // "recorded against 2026-02-14..2026-07-31" would be a false statement
    // about where the founder filed the row.
    expect(figures).not.toContain("2026-02-14..2026-07-31");
  });

  it("still quotes the period's own month for a monthly report", () => {
    const { positives } = buildEvidenceLedger(
      ctxOf({ partners: [partner("2026-04", "Monthly Co")] })
    );
    expect(positives.map((p) => p.figure).join(" ")).toContain(
      "recorded against 2026-04"
    );
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

// ─── material net outflow ───────────────────────────────────────────────────
//
// Confirmed production gap: a large one-off outflow that doesn't trip the
// anomaly threshold and doesn't shrink runway by the reporting floor produced
// ZERO negative evidence, while the net-flow figure printed elsewhere in the
// same report — leaving "no material concerns" legitimately true from the
// evidence ledger's point of view despite a real, material outflow.

describe("material net outflow", () => {
  it("flags a materially negative net flow when nothing else does", () => {
    const curr = snapshot({
      totalBalanceUsd: "10000000",
      netFlowUsd: "-2000000",
    } as Partial<TreasurySnapshot>);
    const { negatives } = buildEvidenceLedger(ctxOf({ snapshot: curr }));
    expect(ids(negatives)).toContain("material-net-outflow");
    expect(negatives).toHaveLength(1);
  });

  it("does not fire below the materiality floor", () => {
    const curr = snapshot({
      totalBalanceUsd: "10000000",
      netFlowUsd: "-500",
    } as Partial<TreasurySnapshot>);
    const { negatives } = buildEvidenceLedger(ctxOf({ snapshot: curr }));
    expect(ids(negatives)).not.toContain("material-net-outflow");
  });

  it("does not fire on a positive or zero net flow", () => {
    const positive = snapshot({
      totalBalanceUsd: "10000000",
      netFlowUsd: "500000",
    } as Partial<TreasurySnapshot>);
    expect(
      ids(buildEvidenceLedger(ctxOf({ snapshot: positive })).negatives)
    ).not.toContain("material-net-outflow");

    const zero = snapshot({
      totalBalanceUsd: "10000000",
      netFlowUsd: "0",
    } as Partial<TreasurySnapshot>);
    expect(
      ids(buildEvidenceLedger(ctxOf({ snapshot: zero })).negatives)
    ).not.toContain("material-net-outflow");
  });

  it("says nothing when netFlowUsd was never synced", () => {
    const curr = snapshot({ totalBalanceUsd: "10000000" } as Partial<TreasurySnapshot>);
    const { negatives } = buildEvidenceLedger(ctxOf({ snapshot: curr }));
    expect(ids(negatives)).not.toContain("material-net-outflow");
  });

  it("keeps delayed milestones ahead of net-outflow concerns", () => {
    const curr = snapshot({
      totalBalanceUsd: "10000000",
      netFlowUsd: "-2000000",
    } as Partial<TreasurySnapshot>);
    const delayed = {
      id: "m1",
      title: "Mainnet v2",
      status: "delayed",
      targetDate: "2026-03-01",
    };
    const { negatives } = buildEvidenceLedger(
      ctxOf({
        snapshot: curr,
        milestones: [delayed] as ReportSectionContext["milestones"],
      })
    );
    expect(negatives[0].id).toBe("milestone-delayed-0");
    expect(negatives[1].id).toBe("material-net-outflow");
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

// ─── decisionLedger — what a Recommendations bullet is allowed to cite ─────

function budgetRow(over: Partial<ProjectBudget> = {}): ProjectBudget {
  return {
    id: "b1",
    projectId: "p1",
    period: "2026-04",
    kind: "expense",
    category: "payroll",
    plannedUsd: "100000",
    notes: null,
    createdAt: new Date("2026-04-01"),
    updatedAt: new Date("2026-04-01"),
    ...over,
  } as unknown as ProjectBudget;
}

describe("decisionLedger", () => {
  it("returns empty when the context carries no evidence, liquidity, budget or composition", () => {
    expect(decisionLedger(ctxOf({}))).toEqual([]);
  });

  it("includes the current liquid runway when liq.derived and a trailing burn basis exist", () => {
    const trailing = [
      snapshot({ burnRateUsd: "100000" } as Partial<TreasurySnapshot>),
      snapshot({ burnRateUsd: "100000" } as Partial<TreasurySnapshot>),
    ];
    const curr = snapshot({
      totalBalanceUsd: "200000",
      burnRateUsd: "200000",
      balancesDetail: detail([{ symbol: "USDC", amount: 200_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);

    const ledger = decisionLedger(ctxOf({ snapshot: curr, trailing }));
    const runway = ledger.find((e) => e.source === "liquidity");
    expect(runway).toBeDefined();
    expect(runway!.finding).toBe("Liquid runway");
    expect(runway!.figure).toMatch(/months/);
  });

  it("omits the liquid runway entry when there is no usable burn basis", () => {
    const curr = snapshot({
      totalBalanceUsd: "200000",
      balancesDetail: detail([{ symbol: "USDC", amount: 200_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const ledger = decisionLedger(ctxOf({ snapshot: curr }));
    expect(ledger.find((e) => e.source === "liquidity")).toBeUndefined();
  });

  it("includes a MATERIAL budget line but not an immaterial one", () => {
    const curr = snapshot({
      snapshotDate: "2026-04-30",
      expensesByCategory: { payroll: 150_000, marketing: 10_200 },
    } as Partial<TreasurySnapshot>);
    const budgets = [
      budgetRow({ id: "b1", category: "payroll", plannedUsd: "100000" }),
      budgetRow({ id: "b2", category: "marketing", plannedUsd: "10000" }),
    ];

    const ledger = decisionLedger(
      ctxOf({
        snapshot: curr,
        budgets: budgets as unknown as ReportSectionContext["budgets"],
      })
    );
    const budgetFindings = ledger
      .filter((e) => e.source === "budget")
      .map((e) => e.finding);
    // payroll: planned $100K, actual $150K -> +50%, clears both floors.
    expect(budgetFindings).toContain("payroll variance");
    // marketing: planned $10K, actual $10.2K -> +2%/$200, clears neither floor.
    expect(budgetFindings).not.toContain("marketing variance");
  });

  it("lists the top 3 holdings by value, largest first, and no more", () => {
    const curr = snapshot({
      totalBalanceUsd: "1000000",
      balancesDetail: detail([
        { symbol: "USDC", amount: 500_000, priceUsd: 1 }, // $500K
        { symbol: "WBTC", amount: 5, priceUsd: 60_000 }, // $300K
        { symbol: "ETH", amount: 50, priceUsd: 3_000 }, // $150K
        { symbol: "DAI", amount: 50_000, priceUsd: 1 }, // $50K — 4th, excluded
      ]),
    } as Partial<TreasurySnapshot>);

    const ledger = decisionLedger(ctxOf({ snapshot: curr }));
    const compositionFindings = ledger
      .filter((e) => e.source === "composition")
      .map((e) => e.finding);
    expect(compositionFindings).toEqual([
      "USDC holding",
      "WBTC holding",
      "ETH holding",
    ]);
  });

  it("skips composition entries entirely when the treasury has no priced holdings", () => {
    const ledger = decisionLedger(ctxOf({}));
    expect(ledger.filter((e) => e.source === "composition")).toEqual([]);
  });

  it("anchoring: every figure the Recommendations fragment renders comes from the ledger, and nothing else", () => {
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      tokenHoldersCount: 1000,
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1000000",
      tokenHoldersCount: 1400,
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const ctx = ctxOf({ snapshot: curr, prevSnapshot: prev });

    const ledger = decisionLedger(ctx);
    expect(ledger.length).toBeGreaterThan(0);

    const section = getSectionById("recommendations");
    expect(section).toBeDefined();
    const fragment = section!.userPromptFragment(ctx);

    // Every ledger figure is quoted verbatim in the rendered fragment...
    for (const entry of ledger) {
      expect(fragment).toContain(entry.figure);
    }
    // ...and the fragment has exactly one bullet per ledger entry — it is
    // built ENTIRELY from decisionLedger(ctx), with no other numeral source.
    const bulletLines = fragment
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(bulletLines).toHaveLength(ledger.length);
  });

  it("requires() is false when the ledger is empty, true otherwise", () => {
    const section = getSectionById("recommendations")!;
    expect(section.requires(ctxOf({}))).toBe(false);

    const curr = snapshot({
      totalBalanceUsd: "1000000",
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    expect(section.requires(ctxOf({ snapshot: curr }))).toBe(true);
  });

  it("never throws, and stays within the size cap, on a saturated context", () => {
    const trailing = [
      snapshot({ burnRateUsd: "100000" } as Partial<TreasurySnapshot>),
      snapshot({ burnRateUsd: "100000" } as Partial<TreasurySnapshot>),
    ];
    const prev = snapshot({
      id: "s0",
      snapshotDate: "2026-03-31",
      tokenHoldersCount: 1000,
      incomeByCategory: { revenue: 100_000 },
      balancesDetail: detail([{ symbol: "USDC", amount: 1_000_000, priceUsd: 1 }]),
    } as Partial<TreasurySnapshot>);
    const curr = snapshot({
      totalBalanceUsd: "1000000",
      burnRateUsd: "200000",
      tokenHoldersCount: 1400,
      incomeByCategory: { revenue: 150_000 },
      expensesByCategory: {
        payroll: 150_000,
        infrastructure: 90_000,
        marketing: 80_000,
      },
      balancesDetail: detail([
        { symbol: "USDC", amount: 500_000, priceUsd: 1 },
        { symbol: "WBTC", amount: 5, priceUsd: 60_000 },
        { symbol: "ETH", amount: 50, priceUsd: 3_000 },
      ]),
    } as Partial<TreasurySnapshot>);
    const budgets = [
      budgetRow({ id: "b1", category: "payroll", plannedUsd: "80000" }),
      budgetRow({ id: "b2", category: "infrastructure", plannedUsd: "40000" }),
      budgetRow({ id: "b3", category: "marketing", plannedUsd: "20000" }),
    ];

    let ledger!: ReturnType<typeof decisionLedger>;
    expect(() => {
      ledger = decisionLedger(
        ctxOf({
          snapshot: curr,
          prevSnapshot: prev,
          trailing,
          milestones: [
            {
              id: "m1",
              title: "Audit closed",
              status: "completed",
              completedDate: "2026-04-12",
            },
          ] as ReportSectionContext["milestones"],
          budgets: budgets as unknown as ReportSectionContext["budgets"],
        })
      );
    }).not.toThrow();

    expect(ledger.length).toBeLessThanOrEqual(20);
    for (const entry of ledger) {
      expect(entry.finding.trim().length).toBeGreaterThan(0);
      expect(entry.figure.trim().length).toBeGreaterThan(0);
      expect(entry.source.trim().length).toBeGreaterThan(0);
    }
  });
});

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
