import * as Sentry from "@sentry/nextjs";
import { db } from "@/server/db";
import { projects, wallets, treasurySnapshots } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import {
  snapshotPeriodConflicts,
  snapshotPeriodStart,
} from "./report-period";
import {
  fetchAllBalances,
  fetchTokenMetrics,
  type ProjectBalanceSummary,
} from "./wallet-sync";
import { fetchAndClassify } from "./transaction-sync";
import { buildTransactionSample } from "./transaction-sample";
import { fetchGitHubActivity } from "./github-sync";
import { notify } from "./notifications";
import type {
  BalanceBasis,
  CarriedForwardWallet,
  ReconstructionMeta,
  ReconstructionTransfer,
} from "./balance-reconstruction";

export function getLastMonthPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  return { start, end };
}

/**
 * Balances the caller already has, instead of a live read.
 *
 * Absent — the default, and what every existing caller does — means "read the
 * wallets live and record the result as observed". That is correct for a
 * snapshot dated today and wrong for any other date, which is the whole reason
 * this option exists: `projects.sync` walks periods backwards, reconstructs
 * each older period's balances from the next-newer ones, and hands them in
 * here already computed. See balance-reconstruction.ts.
 *
 * `basis` and `meta` travel WITH the balances rather than as separate
 * arguments so a caller cannot supply reconstructed figures and forget to say
 * so — the pairing is the disclosure.
 */
export interface PrecomputedBalances {
  balances: ProjectBalanceSummary;
  basis: BalanceBasis;
  /** Null for `observed`; the walk-back's own account of itself otherwise. */
  meta: ReconstructionMeta | null;
}

export interface CreateSnapshotOptions {
  precomputedBalances?: PrecomputedBalances | null;
  /**
   * The exact `(period_start, snapshot_date)` pair to store, when the caller
   * already knows it.
   *
   * WHY A CALLER WOULD EVER NEED THIS. The pair is normally DERIVED from
   * `period`, and that derivation runs through two different timezone
   * conventions: `snapshot_date` is `period.end` projected onto a UTC day,
   * while `snapshotPeriodStart` decides whether the range is a calendar month
   * by reading `period`'s LOCAL components. Both are correct for the monthly
   * path, whose Dates are built with local constructors and whose start is
   * re-derived from `snapshot_date`'s month anyway.
   *
   * An arbitrary window has neither property, and the derivation misreads it in
   * both directions: at UTC-4 a window of 2 → 31 July has a `start` whose local
   * day is the 1st, so `monthsInDateRange` calls it a calendar month and
   * `snapshotPeriodStart` stores 1 July — a different, wrong window, wearing a
   * `kind: "month"` label. Since a report's period must EXACTLY match its
   * snapshot's, the window the founder asked for would then be unselectable
   * forever.
   *
   * So `projects.sync` passes the window it validated, verbatim. Absent — every
   * existing caller — the derivation is unchanged, which is what keeps the
   * monthly path bit-for-bit identical.
   *
   * Both values are 'YYYY-MM-DD'.
   */
  storedPeriod?: { start: string; end: string } | null;
}

/**
 * Everything a snapshot row needs, plus the two by-products the caller needs to
 * walk the PREVIOUS period back: this period's transfer legs, and the wallets
 * for which there are none.
 *
 * The prepare/write split exists so `projects.sync` can run its two passes in
 * opposite directions — fetch newest→oldest (each period's legs walk the next
 * older period's balances back) but write oldest→newest. One combined function
 * can only do both in the same order.
 */
export interface PreparedSnapshot {
  values: typeof treasurySnapshots.$inferInsert;
  balanceLegs: ReconstructionTransfer[];
  unreconstructableWallets: CarriedForwardWallet[];
}

export async function createMonthlySnapshot(
  projectId: string,
  period: { start: Date; end: Date },
  options: CreateSnapshotOptions = {}
) {
  const prepared = await prepareMonthlySnapshot(projectId, period, options);
  return writeSnapshot(prepared);
}

/**
 * Persists a prepared snapshot. Split out of `createMonthlySnapshot` so a
 * caller can buffer several and write them in an order of its choosing; on its
 * own it does no fetching and no validation, because both already happened in
 * `prepareMonthlySnapshot`.
 */
export async function writeSnapshot(prepared: PreparedSnapshot) {
  const [snapshot] = await db
    .insert(treasurySnapshots)
    .values(prepared.values)
    .onConflictDoUpdate({
      target: [treasurySnapshots.projectId, treasurySnapshots.snapshotDate],
      // Re-syncs for the same (project, date) must overwrite all derived
      // fields, not just totalBalanceUsd — otherwise expense breakdowns and
      // GitHub metrics get stuck on the first sync of the day.
      set: prepared.values,
    })
    .returning();
  return snapshot;
}

export async function prepareMonthlySnapshot(
  projectId: string,
  period: { start: Date; end: Date },
  options: CreateSnapshotOptions = {}
): Promise<PreparedSnapshot> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) throw new Error(`Project ${projectId} not found`);

  // An explicit window wins outright — see `storedPeriod`. Otherwise the pair
  // is derived exactly as it always was.
  const snapshotDate =
    options.storedPeriod?.end ?? period.end.toISOString().split("T")[0];
  // The other end of the same window. Derived through `snapshotPeriodStart`
  // rather than as `period.start.toISOString().split("T")[0]`, because the
  // naive projection turns an ordinary monthly sync into a 31-day CUSTOM
  // period in any timezone east of Greenwich and restates its burn by 1.8% —
  // read that function's header, it owns the reasoning. For a calendar month
  // it returns exactly what `periodFromSnapshot` already reconstructs from a
  // NULL column, so writing this cannot change any existing report.
  const periodStart =
    options.storedPeriod?.start ?? snapshotPeriodStart(period, snapshotDate);

  // Collision guard, checked BEFORE the fetches below rather than beside the
  // upsert, so a refusal costs one indexed lookup instead of a full round of
  // Alchemy, GitHub and price-feed calls.
  //
  // The unique index is on (project_id, snapshot_date) alone, so two reporting
  // periods that END on the same day — a monthly snapshot and a grant window
  // both dated today — map to the same row and the second silently overwrites
  // the first. Any report already pointing at that snapshot then describes a
  // different window, and nothing downstream can tell. Widening the index is a
  // separate migration (it would break this very `ON CONFLICT` target the
  // instant it landed), so the refusal lives here.
  //
  // The decision itself is `snapshotPeriodConflicts` in report-period.ts —
  // pure and unit-tested, because this file imports `db` and cannot be tested
  // at all. A NULL stored `period_start` is resolved to the calendar month it
  // means, not waived; re-syncing the SAME period is not a conflict and still
  // upserts, which the `set:` on the upsert depends on.
  const existingSnapshot = await db.query.treasurySnapshots.findFirst({
    where: and(
      eq(treasurySnapshots.projectId, projectId),
      eq(treasurySnapshots.snapshotDate, snapshotDate)
    ),
    columns: { snapshotDate: true, periodStart: true },
  });
  const periodCheck = snapshotPeriodConflicts(existingSnapshot, {
    snapshotDate,
    periodStart,
  });
  if (!periodCheck.ok) throw new Error(periodCheck.reason);

  const walletList = await db.query.wallets.findMany({
    where: eq(wallets.projectId, projectId),
  });

  // Precomputed balances short-circuit the live read entirely. `Promise.all`
  // still wraps it so the GitHub fetch keeps running in parallel with whatever
  // the first slot turns out to be.
  const precomputed = options.precomputedBalances ?? null;
  const balanceBasis: BalanceBasis = precomputed?.basis ?? "observed";

  // Fetch balances and transactions in parallel
  const [balances, github] = await Promise.all([
    precomputed
      ? Promise.resolve(precomputed.balances)
      : fetchAllBalances(walletList, project.tokenSymbol),
    project.githubOrg
      ? fetchGitHubActivity(
          project.githubOrg,
          project.githubTokenEncrypted ?? undefined,
          period
        ).catch(() => null) // partial failure: skip GitHub, don't crash
      : Promise.resolve(null),
  ]);

  // Fetch transactions (depends on balance for runway calculation)
  const txResult = await fetchAndClassify(
    walletList,
    period,
    balances.totalBalanceUsd
  ).catch(() => null);

  // Fetch token metrics (optional).
  //
  // SKIPPED ENTIRELY FOR A RECONSTRUCTED ROW, and the four columns below are
  // written NULL. `fetchTokenMetrics` reads Dune's token-info endpoint, which
  // is current-value only and has no historical mode — there is no such thing
  // as "the market cap as of last March" available here. Writing today's price,
  // market cap, supply or holder count under a past date is exactly the class
  // of lie this whole stage exists to remove, and it would be the most
  // convincing one on the page, because those four figures look like
  // measurements no matter what date sits above them. Skipping the call also
  // saves a round trip per backfilled period.
  const tokenMetrics =
    balanceBasis === "observed" && project.tokenContract && project.tokenChain
      ? await fetchTokenMetrics(project.tokenContract, project.tokenChain).catch(
          () => null
        )
      : null;

  // Which transfer legs get persisted, and whether anything was left out, is
  // decided by transaction-sample.ts — pure and unit-tested, because this
  // file imports `db` and cannot be. Aggregates are computed inside
  // fetchAndClassify over the FULL list, so nothing here affects them; this
  // only bounds the JSONB blob (~60KB instead of 1MB+).
  //
  // `legCount` and `sampleBasis` are additive envelope keys. readEnvelope in
  // major-transactions.ts ignores keys it does not know, so every snapshot
  // already in the database keeps reading exactly as before.
  const allTx = txResult?.transactions ?? [];
  const sampled = buildTransactionSample(allTx);
  const transactionsRaw = txResult
    ? {
        sample: sampled.sample,
        totalCount: allTx.length,
        capped: sampled.capped,
        legCount: sampled.legCount,
        sampleBasis: sampled.basis,
      }
    : null;

  // Aggregate per-chain totals from each wallet's balance summary. Lets
  // the dashboard render a "Treasury by chain" bar and the LLM prompt
  // include a per-chain section (so multi-chain treasuries don't read as
  // one monolithic blob). Single-chain projects just get one entry.
  const balancesByChain: Record<string, number> = {};
  for (const w of balances.balancesDetail) {
    if (w.totalUsd > 0) {
      balancesByChain[w.chain] = (balancesByChain[w.chain] ?? 0) + w.totalUsd;
    }
  }

  const snapshotValues = {
    projectId,
    snapshotDate,
    periodStart,
    totalBalanceUsd: balances.totalBalanceUsd.toFixed(2),
    stablecoinsUsd: balances.stablecoinsUsd.toFixed(2),
    ethUsd: balances.ethUsd.toFixed(2),
    nativeTokenUsd: balances.nativeTokenUsd.toFixed(2),
    otherAssetsUsd: balances.otherAssetsUsd.toFixed(2),
    balancesDetail: balances.balancesDetail as unknown as Record<string, unknown>[],
    balancesByChain:
      Object.keys(balancesByChain).length > 0
        ? (balancesByChain as unknown as Record<string, unknown>)
        : null,

    totalInflowsUsd: txResult?.totalInflowsUsd.toFixed(2) ?? null,
    totalOutflowsUsd: txResult?.totalOutflowsUsd.toFixed(2) ?? null,
    netFlowUsd: txResult?.netFlowUsd.toFixed(2) ?? null,
    burnRateUsd: txResult?.burnRateUsd.toFixed(2) ?? null,
    runwayMonths: txResult?.runwayMonths?.toFixed(1) ?? null,
    expensesByCategory: txResult?.expensesByCategory ?? null,
    incomeByCategory: txResult?.incomeByCategory ?? null,
    transactionsRaw: transactionsRaw as unknown as Record<string, unknown> | null,

    githubCommitsCount: github?.githubCommitsCount ?? null,
    githubPrsMerged: github?.githubPrsMerged ?? null,
    githubContributorsActive: github?.githubContributorsActive ?? null,

    tokenHoldersCount: tokenMetrics?.tokenHoldersCount ?? null,
    tokenPriceUsd: tokenMetrics?.tokenPriceUsd?.toFixed(8) ?? null,
    tokenMarketCapUsd: tokenMetrics?.tokenMarketCapUsd?.toFixed(2) ?? null,
    tokenCirculatingSupply: tokenMetrics?.tokenCirculatingSupply?.toFixed(2) ?? null,

    // Combined wallet-level sync failures (balance fetch + tx fetch).
    // Empty array means all wallets succeeded for this snapshot.
    syncWarnings: ((): unknown => {
      const all = [...balances.warnings, ...(txResult?.warnings ?? [])];
      return all.length > 0 ? (all as unknown as Record<string, unknown>[]) : null;
    })(),

    // Provenance of every balance figure above. Written on every row from now
    // on, including the observed ones — the NULL fallback in `balanceBasisOf`
    // stays because rows already in the database have none, not because new
    // rows are allowed to omit it.
    balanceBasis,
    reconstructionMeta:
      (precomputed?.meta ?? null) as unknown as Record<string, unknown> | null,
  };

  return {
    values: snapshotValues,
    balanceLegs: txResult?.balanceLegs ?? [],
    unreconstructableWallets: txResult?.unreconstructableWallets ?? [],
  };
}

export async function syncAllProjects() {
  const all = await db.query.projects.findMany({
    where: eq(projects.isActive, true),
  });
  // Plan-aware soft-block: users over their limit (e.g. after downgrade) get
  // the most recent N synced; the rest are silently skipped here.
  const { filterEligibleProjects } = await import("@/server/lib/plan-limits");
  const activeProjects = await filterEligibleProjects(all);
  const period = getLastMonthPeriod();

  const results = await Promise.allSettled(
    activeProjects.map((p) => createMonthlySnapshot(p.id, period))
  );

  // Per-project notifications: success = inbox row, failure = sync_failed row.
  await Promise.all(
    results.map((r, i) => {
      const project = activeProjects[i];
      if (r.status === "fulfilled") {
        return notify(project.userId, {
          type: "snapshot_ready",
          title: `${project.name} treasury snapshot is ready`,
          body: "Generate this month's report or wait for the auto-run on the 3rd.",
          href: `/projects/${project.id}/reports`,
        });
      }
      Sentry.captureException(r.reason, {
        tags: { area: "monthly-sync", projectId: project.id },
      });
      return notify(project.userId, {
        type: "sync_failed",
        title: `Sync failed for ${project.name}`,
        body:
          r.reason instanceof Error
            ? r.reason.message.slice(0, 200)
            : "Unknown error",
        href: `/projects/${project.id}`,
      });
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return { succeeded, failed, total: activeProjects.length };
}
