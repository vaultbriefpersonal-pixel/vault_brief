"use client";

import { use, useState } from "react";
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

const STATUS_COLOR: Record<string, React.CSSProperties> = {
  draft: { background: "rgba(255,255,255,0.06)", color: "var(--vb-muted)" },
  review: { background: "rgba(251,191,36,0.12)", color: "#fbbf24" },
  sent: { background: "rgba(0,232,123,0.12)", color: "var(--accent)" },
};

export default function ReportEditorPage({ params }: Props) {
  const { id: projectId, reportId } = use(params);
  const { data: report, refetch } = trpc.reports.getById.useQuery({ reportId });

  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  const update = trpc.reports.update.useMutation({ onSuccess: () => refetch() });
  const updateStatus = trpc.reports.updateStatus.useMutation({ onSuccess: () => refetch() });
  const regenerate = trpc.reports.regenerate.useMutation({ onSuccess: () => refetch() });
  const downloadPdf = trpc.reports.downloadPdf.useMutation({
    onSuccess: ({ url }) => window.open(url, "_blank"),
  });
  // Real email send. The "Send" button (review → sent) used to bounce through
  // updateStatus, which silently skipped the actual email — this hooks the
  // real Resend-backed mutation that loops active investors.
  const sendToInvestors = trpc.investors.sendReport.useMutation({
    onSuccess: (res) => {
      setSendError(null);
      setSendSuccess(`Sent to ${res.sent} of ${res.total} investors`);
      refetch();
      setTimeout(() => setSendSuccess(null), 4000);
    },
    onError: (err) => {
      setSendSuccess(null);
      setSendError(err.message || "Send failed");
    },
  });

  if (!report) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 14,
          color: "var(--vb-dim)",
        }}
      >
        Loading...
      </div>
    );
  }

  const nextStatus =
    report.status === "draft" ? "review" : report.status === "review" ? "sent" : null;

  const btnBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid var(--vb-border)",
    background: "transparent",
    color: "var(--vb-muted)",
    borderRadius: 7,
    // 44px tap target on phones; padding alone keeps the visual pill compact.
    minHeight: 36,
    padding: "8px 12px",
    fontSize: 12,
    fontFamily: "var(--font-inter), Inter, sans-serif",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          height: 52,
          borderBottom: "1px solid var(--vb-border)",
          background: "var(--vb-bg)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href={`/projects/${projectId}/reports`}
            style={{ color: "var(--vb-dim)", display: "flex", lineHeight: 1 }}
          >
            <ChevronLeft size={16} />
          </Link>
          <div>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--vb-text)",
                margin: 0,
              }}
            >
              {formatDate(report.periodEnd)}
            </p>
            <span
              style={{
                display: "inline-block",
                marginTop: 2,
                padding: "1px 8px",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontWeight: 500,
                textTransform: "capitalize",
                ...(STATUS_COLOR[report.status] ?? STATUS_COLOR.draft),
              }}
            >
              {STATUS_LABELS[report.status] ?? report.status}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => regenerate.mutate({ reportId })}
            disabled={regenerate.isPending}
            style={{ ...btnBase, opacity: regenerate.isPending ? 0.5 : 1 }}
          >
            <RefreshCw size={13} />
            {regenerate.isPending ? "Regenerating..." : "Regenerate"}
          </button>

          <button
            onClick={() => downloadPdf.mutate({ reportId })}
            disabled={downloadPdf.isPending}
            style={{ ...btnBase, opacity: downloadPdf.isPending ? 0.5 : 1 }}
          >
            <Download size={13} />
            PDF
          </button>

          {nextStatus && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <button
                onClick={() => {
                  setSendError(null);
                  if (nextStatus === "sent") {
                    if (
                      !window.confirm(
                        "Send this report to all active investors? This cannot be undone."
                      )
                    ) {
                      return;
                    }
                    sendToInvestors.mutate({ reportId, projectId });
                  } else {
                    updateStatus.mutate({
                      reportId,
                      status: nextStatus as "draft" | "review" | "sent",
                    });
                  }
                }}
                disabled={
                  nextStatus === "sent"
                    ? sendToInvestors.isPending
                    : updateStatus.isPending
                }
                style={{
                  ...btnBase,
                  background: "#00e87b",
                  color: "#0a0a0a",
                  border: "none",
                  fontWeight: 600,
                  opacity:
                    (nextStatus === "sent"
                      ? sendToInvestors.isPending
                      : updateStatus.isPending)
                      ? 0.7
                      : 1,
                }}
              >
                <Send size={13} />
                {nextStatus === "review"
                  ? updateStatus.isPending
                    ? "Updating..."
                    : "Mark Ready"
                  : sendToInvestors.isPending
                    ? "Sending..."
                    : "Send to investors"}
              </button>
              {sendError && (
                <span
                  style={{
                    fontSize: 11,
                    color: "#f87171",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    maxWidth: 240,
                    textAlign: "right",
                  }}
                >
                  {sendError}
                </span>
              )}
              {sendSuccess && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--accent)",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                  }}
                >
                  {sendSuccess}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, overflow: "hidden" }}>
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
