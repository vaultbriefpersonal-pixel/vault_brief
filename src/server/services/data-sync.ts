import { db } from "@/server/db";
import { projects, wallets, treasurySnapshots } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { fetchAllBalances, fetchTokenMetrics } from "./wallet-sync";
import { fetchAndClassify } from "./transaction-sync";
import { fetchGitHubActivity } from "./github-sync";
import { notify } from "./notifications";

export function getLastMonthPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  return { start, end };
}

export async function createMonthlySnapshot(
  projectId: string,
  period: { start: Date; end: Date }
) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) throw new Error(`Project ${projectId} not found`);

  const walletList = await db.query.wallets.findMany({
    where: eq(wallets.projectId, projectId),
  });

  // Fetch balances and transactions in parallel
  const [balances, github] = await Promise.all([
    fetchAllBalances(walletList, project.tokenSymbol),
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

  // Fetch token metrics (optional)
  const tokenMetrics =
    project.tokenContract && project.tokenChain
      ? await fetchTokenMetrics(project.tokenContract, project.tokenChain).catch(
          () => null
        )
      : null;

  const snapshotDate = period.end.toISOString().split("T")[0];

  const [snapshot] = await db
    .insert(treasurySnapshots)
    .values({
      projectId,
      snapshotDate,
      totalBalanceUsd: balances.totalBalanceUsd.toFixed(2),
      stablecoinsUsd: balances.stablecoinsUsd.toFixed(2),
      ethUsd: balances.ethUsd.toFixed(2),
      nativeTokenUsd: balances.nativeTokenUsd.toFixed(2),
      otherAssetsUsd: balances.otherAssetsUsd.toFixed(2),
      balancesDetail: balances.balancesDetail as unknown as Record<string, unknown>[],

      totalInflowsUsd: txResult?.totalInflowsUsd.toFixed(2) ?? null,
      totalOutflowsUsd: txResult?.totalOutflowsUsd.toFixed(2) ?? null,
      netFlowUsd: txResult?.netFlowUsd.toFixed(2) ?? null,
      burnRateUsd: txResult?.burnRateUsd.toFixed(2) ?? null,
      runwayMonths: txResult?.runwayMonths?.toFixed(1) ?? null,
      expensesByCategory: txResult?.expensesByCategory ?? null,
      incomeByCategory: txResult?.incomeByCategory ?? null,
      transactionsRaw: txResult?.transactions as unknown as Record<string, unknown>[] ?? null,

      githubCommitsCount: github?.githubCommitsCount ?? null,
      githubPrsMerged: github?.githubPrsMerged ?? null,
      githubContributorsActive: github?.githubContributorsActive ?? null,

      tokenHoldersCount: tokenMetrics?.tokenHoldersCount ?? null,
      tokenPriceUsd: tokenMetrics?.tokenPriceUsd?.toFixed(8) ?? null,
      tokenMarketCapUsd: tokenMetrics?.tokenMarketCapUsd?.toFixed(2) ?? null,
      tokenCirculatingSupply: tokenMetrics?.tokenCirculatingSupply?.toFixed(2) ?? null,
    })
    .onConflictDoUpdate({
      target: [treasurySnapshots.projectId, treasurySnapshots.snapshotDate],
      set: {
        totalBalanceUsd: balances.totalBalanceUsd.toFixed(2),
      },
    })
    .returning();

  return snapshot;
}

export async function syncAllProjects() {
  const activeProjects = await db.query.projects.findMany({
    where: eq(projects.isActive, true),
  });
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
