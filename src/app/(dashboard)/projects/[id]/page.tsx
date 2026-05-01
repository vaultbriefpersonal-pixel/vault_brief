import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects, treasurySnapshots } from "@/server/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { Wallet, FileText, Users, Settings } from "lucide-react";
import { formatUsd, formatDate } from "@/lib/utils";
import { TreasuryChart } from "@/components/charts/TreasuryChart";
import { BurnRateChart } from "@/components/charts/BurnRateChart";
import { ExpenseBreakdown } from "@/components/charts/ExpenseBreakdown";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session!.user!.id!)),
    with: { wallets: true, reports: true, investors: true },
  });

  if (!project) notFound();

  const snapshots = await db.query.treasurySnapshots.findMany({
    where: eq(treasurySnapshots.projectId, id),
    orderBy: [desc(treasurySnapshots.snapshotDate)],
    limit: 12,
  });

  const latestSnapshot = snapshots[0];

  const treasuryChartData = [...snapshots]
    .reverse()
    .map((s) => ({
      date: formatDate(s.snapshotDate),
      totalBalanceUsd: Number(s.totalBalanceUsd ?? 0),
    }));

  const burnChartData = [...snapshots]
    .reverse()
    .map((s) => ({
      date: formatDate(s.snapshotDate),
      burnRateUsd: Number(s.burnRateUsd ?? 0),
    }));

  const expenseData =
    (latestSnapshot?.expensesByCategory as Record<string, number> | null) ?? {};

  const NAV = [
    { href: `/projects/${id}/wallets`, label: "Wallets", icon: Wallet, count: project.wallets.length },
    { href: `/projects/${id}/reports`, label: "Reports", icon: FileText, count: project.reports.length },
    { href: `/projects/${id}/investors`, label: "Investors", icon: Users, count: project.investors.length },
    { href: `/projects/${id}/settings`, label: "Settings", icon: Settings },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">{project.name}</h2>
        {project.description && (
          <p className="mt-1 text-slate-400 text-sm">{project.description}</p>
        )}
      </div>

      {/* Quick stats */}
      {latestSnapshot && (
        <div className="grid grid-cols-2 gap-4 mb-6 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400 mb-1">Treasury</p>
            <p className="text-xl font-bold text-white">
              {formatUsd(Number(latestSnapshot.totalBalanceUsd ?? 0))}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400 mb-1">Burn rate / mo</p>
            <p className="text-xl font-bold text-amber-400">
              {latestSnapshot.burnRateUsd
                ? formatUsd(Number(latestSnapshot.burnRateUsd))
                : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400 mb-1">Runway</p>
            <p className="text-xl font-bold text-green-400">
              {latestSnapshot.runwayMonths
                ? `${Number(latestSnapshot.runwayMonths).toFixed(0)} mo`
                : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400 mb-1">Stablecoins</p>
            <p className="text-xl font-bold text-blue-400">
              {formatUsd(Number(latestSnapshot.stablecoinsUsd ?? 0))}
            </p>
          </div>
        </div>
      )}

      {/* Navigation cards */}
      <div className="grid grid-cols-2 gap-4 mb-8 lg:grid-cols-4">
        {NAV.map(({ href, label, icon: Icon, count }) => (
          <Link
            key={href}
            href={href}
            className="rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-slate-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Icon className="h-5 w-5 text-indigo-400" />
              <div>
                <p className="text-xs text-slate-400">{label}</p>
                {count !== undefined && (
                  <p className="text-lg font-semibold text-white">{count}</p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">
            Treasury over time
          </h3>
          <TreasuryChart data={treasuryChartData} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">
            Monthly burn rate
          </h3>
          <BurnRateChart data={burnChartData} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">
            Expense breakdown
          </h3>
          <ExpenseBreakdown data={expenseData} />
        </div>
        {latestSnapshot?.githubCommitsCount !== null && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">
              Development activity
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-white">
                  {latestSnapshot?.githubCommitsCount ?? 0}
                </p>
                <p className="text-xs text-slate-400 mt-1">Commits</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-white">
                  {latestSnapshot?.githubPrsMerged ?? 0}
                </p>
                <p className="text-xs text-slate-400 mt-1">PRs merged</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-white">
                  {latestSnapshot?.githubContributorsActive ?? 0}
                </p>
                <p className="text-xs text-slate-400 mt-1">Contributors</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
