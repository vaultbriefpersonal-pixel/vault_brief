import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects, reports } from "@/server/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { FileText, Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-700 text-slate-300",
  review: "bg-amber-900 text-amber-300",
  sent: "bg-green-900 text-green-300",
};

export default async function ReportsPage({ params }: Props) {
  const { id: projectId } = await params;
  const session = await auth();

  const project = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectId),
      eq(projects.userId, session!.user!.id!)
    ),
  });
  if (!project) notFound();

  const reportList = await db.query.reports.findMany({
    where: eq(reports.projectId, projectId),
    orderBy: [desc(reports.periodEnd)],
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">Reports</h2>
      </div>

      {reportList.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-12 text-center">
          <FileText className="h-8 w-8 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No reports yet.</p>
          <p className="text-slate-500 text-xs mt-1">
            Reports are generated automatically each month when data syncs.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reportList.map((report) => (
            <Link
              key={report.id}
              href={`/projects/${projectId}/reports/${report.id}`}
              className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 hover:border-slate-700 transition-colors"
            >
              <div>
                <p className="font-medium text-white">
                  {formatDate(report.periodEnd)}
                </p>
                {report.executiveSummary && (
                  <p className="text-sm text-slate-400 mt-0.5 line-clamp-1">
                    {report.executiveSummary}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {(report.sentToCount ?? 0) > 0 && (
                  <span className="text-xs text-slate-500">
                    Sent to {report.sentToCount ?? 0} · {report.openedCount ?? 0} opened
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_COLORS[report.status] ?? STATUS_COLORS.draft}`}
                >
                  {report.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
