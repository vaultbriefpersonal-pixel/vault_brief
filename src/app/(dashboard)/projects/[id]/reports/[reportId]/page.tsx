"use client";

import { use } from "react";
import { trpc } from "@/lib/api";
import { ReportEditor } from "@/components/report/ReportEditor";
import { Download, Send, RefreshCw, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string; reportId: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  review: "Ready to Review",
  sent: "Sent",
};

export default function ReportEditorPage({ params }: Props) {
  const { id: projectId, reportId } = use(params);
  const { data: report, refetch } = trpc.reports.getById.useQuery({ reportId });

  const update = trpc.reports.update.useMutation({ onSuccess: () => refetch() });
  const updateStatus = trpc.reports.updateStatus.useMutation({
    onSuccess: () => refetch(),
  });
  const regenerate = trpc.reports.regenerate.useMutation({
    onSuccess: () => refetch(),
  });
  const downloadPdf = trpc.reports.downloadPdf.useMutation({
    onSuccess: ({ url }) => window.open(url, "_blank"),
  });

  if (!report) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        Loading...
      </div>
    );
  }

  const nextStatus =
    report.status === "draft"
      ? "review"
      : report.status === "review"
      ? "sent"
      : null;

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}/reports`}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-sm font-semibold text-white">
              Report: {formatDate(report.periodEnd)}
            </h2>
            <span className="text-xs text-slate-500 capitalize">
              {STATUS_LABELS[report.status] ?? report.status}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => regenerate.mutate({ reportId })}
            disabled={regenerate.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {regenerate.isPending ? "Regenerating..." : "Regenerate"}
          </button>

          <button
            onClick={() => downloadPdf.mutate({ reportId })}
            disabled={downloadPdf.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </button>

          {nextStatus && (
            <button
              onClick={() =>
                updateStatus.mutate({ reportId, status: nextStatus as "draft" | "review" | "sent" })
              }
              disabled={updateStatus.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              {nextStatus === "review" ? "Mark Ready" : "Send"}
            </button>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <ReportEditor
          initialContent={report.contentMd ?? ""}
          founderNotes={report.founderNotes}
          onSave={async (content, notes) => {
            await update.mutateAsync({
              reportId,
              contentMd: content,
              founderNotes: notes || null,
            });
          }}
        />
      </div>
    </div>
  );
}
