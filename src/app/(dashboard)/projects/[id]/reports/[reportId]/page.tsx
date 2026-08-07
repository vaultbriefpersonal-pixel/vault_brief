"use client";

import { use, useState } from "react";
import { trpc } from "@/lib/api";
import { ReportEditor } from "@/components/report/ReportEditor";
import { ReportWidgets } from "@/components/report/ReportWidgets";
import { ReportEngagements } from "@/components/report/ReportEngagements";
import {
  Download,
  Send,
  RefreshCw,
  ChevronLeft,
  Copy,
  FileDown,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { normalizeForExport } from "@/lib/report-markdown";

interface Props {
  params: Promise<{ id: string; reportId: string }>;
}

// Stage labels. Per copy rules, never expose the raw "Draft" word to a
// user — it would imply the product output is a draft. The DB column
// stays `draft` (it's the internal workflow stage), but the UI shows
// "Pending review".
const STATUS_LABELS: Record<string, string> = {
  draft: "Pending review",
  review: "Ready to send",
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
  const { data: safes } = trpc.wallets.getSafeInfo.useQuery({ projectId });
  const { data: trend } = trpc.projects.getSnapshotTrend.useQuery({ projectId });
  const { data: milestoneList } = trpc.milestones.list.useQuery({ projectId });

  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const update = trpc.reports.update.useMutation({ onSuccess: () => refetch() });
  const updateStatus = trpc.reports.updateStatus.useMutation({
    onSuccess: () => refetch(),
    // This mutation had no error handler at all, so a refused or failed
    // status change looked exactly like a successful one: nothing moved and
    // nothing was said. Now that it can refuse on purpose, silence is worse.
    onError: (err) => setSendError(err.message || "Could not update status"),
  });
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
      // Distinguish full success from partial. The router now returns
      // `failures` only when at least one delivery failed; treat that as
      // a degraded result so the founder doesn't trust a green checkmark
      // when investors X and Y silently bounced.
      if (res.failures && res.failures.length > 0) {
        const sample = res.failures
          .slice(0, 2)
          .map((f) => `${f.email}: ${f.reason}`)
          .join("; ");
        setSendError(
          `Partially sent (${res.sent} of ${res.total}). Failed: ${sample}`
        );
        setSendSuccess(null);
      } else {
        setSendSuccess(`Sent to ${res.sent} of ${res.total} investors`);
        setTimeout(() => setSendSuccess(null), 4000);
      }
      refetch();
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

  // Both handlers normalize the SAME raw contentMd through the SAME
  // function, so clipboard and downloaded-file content can never drift
  // from each other. See report-markdown.ts's normalizeForExport for why
  // this is needed (mainly: the disclaimer, which every other surface
  // renders but a raw copy/paste or file download otherwise wouldn't).
  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(
        normalizeForExport(report.contentMd ?? "")
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      alert(`Copy failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const handleDownloadMarkdown = () => {
    try {
      const text = normalizeForExport(report.contentMd ?? "");
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      // Mirrors pdf-generator.ts's filename convention, swapping the extension.
      const filename = `${report.project.name.replace(/\s+/g, "-").toLowerCase()}-report-${report.periodEnd}.md`;
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(
        `Download failed: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  };

  // A preset's defaultExportFormat is a hint about which action a founder
  // reaches for first, never a restriction — both actions stay reachable
  // regardless. null/undefined/"pdf" all fall through to today's PDF-first
  // order.
  const markdownFirst = report.preset?.defaultExportFormat === "markdown";

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

  const pdfButton = (
    <button
      key="pdf"
      onClick={() => downloadPdf.mutate({ reportId })}
      disabled={downloadPdf.isPending}
      style={{ ...btnBase, opacity: downloadPdf.isPending ? 0.5 : 1 }}
    >
      <Download size={13} />
      PDF
    </button>
  );

  const markdownButtons = (
    <>
      <button key="copy-md" onClick={handleCopyMarkdown} style={btnBase}>
        <Copy size={13} />
        {copied ? "Copied!" : "Copy Markdown"}
      </button>
      <button key="download-md" onClick={handleDownloadMarkdown} style={btnBase}>
        <FileDown size={13} />
        MD
      </button>
    </>
  );

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
            {/* `report_type`'s first reader anywhere in the product. The
                column has been written since Stage 6 and read by nothing, so
                two structurally different documents — one answering to
                investors, one to a grant funder — looked identical in the UI. */}
            {report.reportType === "grant" && (
              <span
                style={{
                  display: "inline-block",
                  marginTop: 2,
                  marginLeft: 6,
                  padding: "1px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontWeight: 500,
                  background: "rgba(129,140,248,0.14)",
                  color: "#a5b4fc",
                }}
                title="Scoped to a grant award or generated from a grant template"
              >
                Grant
              </span>
            )}
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

          {markdownFirst ? (
            <>
              {markdownButtons}
              {pdfButton}
            </>
          ) : (
            <>
              {pdfButton}
              {markdownButtons}
            </>
          )}

          {nextStatus && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <button
                onClick={() => {
                  setSendError(null);

                  // Naming the specific problems, not a generic "are you
                  // sure". A founder can only make this call if they are told
                  // what is wrong with the document in front of them.
                  const blockers = report.shipBlockers ?? [];
                  if (blockers.length > 0) {
                    const list = blockers.map((b) => `  • ${b}`).join("\n");
                    if (
                      !window.confirm(
                        `This report has ${blockers.length} unresolved issue${blockers.length === 1 ? "" : "s"}:\n\n${list}\n\nRegenerating or re-syncing may fix ${blockers.length === 1 ? "it" : "them"}. Continue anyway?`
                      )
                    ) {
                      return;
                    }
                  }

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
                      // Set only on this path, and only after the dialog
                      // above actually showed the issues.
                      acknowledgeIssues: blockers.length > 0 ? true : undefined,
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

      {/* What the product already knew and never said.
          `validation_issues` is the verdict `generateReport` used to compute
          and discard; the coverage lines come from the snapshot's own
          `sync_warnings`, which was joined into this query all along and read
          by nobody. Same array the send gate enforces — see
          report-ship-check.ts. */}
      {(report.shipBlockers?.length ?? 0) > 0 && (
        <div
          style={{
            margin: "0 0 16px",
            padding: "12px 16px",
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: 10,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          <AlertTriangle
            size={16}
            style={{ color: "#fbbf24", flexShrink: 0, marginTop: 1 }}
            aria-hidden="true"
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#fbbf24",
                margin: "0 0 6px",
              }}
            >
              {report.shipBlockers.length} unresolved issue
              {report.shipBlockers.length === 1 ? "" : "s"} in this report
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 12,
                color: "var(--vb-muted)",
                lineHeight: 1.65,
              }}
            >
              {report.shipBlockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <p style={{ fontSize: 12, color: "var(--vb-dim)", margin: "6px 0 0" }}>
              <strong>Regenerate</strong> rebuilds the text;{" "}
              <strong>Sync now</strong> re-reads the wallets. You can still
              send — you will be asked to confirm.
            </p>
          </div>
        </div>
      )}

      {/* Editor — widget strip rendered above so the founder previews
          exactly what the investor will see when the report ships.
          ReportWidgets self-hides if the report has no linked snapshot,
          so legacy / orphan reports still mount cleanly with just the
          editor below. The strip and the editor share the scroll
          container — both scroll together as one column. */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <ReportWidgets
          snapshot={report.snapshot ?? null}
          accent={
            (report.project as { customBranding?: { primaryColor?: string } } | null)
              ?.customBranding?.primaryColor ?? "#00e87b"
          }
          safes={safes ?? []}
          trend={trend}
          milestones={milestoneList ?? []}
          // The own-token identity the composition classifier needs. Without
          // it the project's own holdings fall into "Other assets".
          // `reports.getById` already joins the project row (`with: { project:
          // true }`), so this is threaded from data the query returns, not
          // fetched again.
          project={
            (report.project as {
              tokenSymbol?: string | null;
              tokenContract?: string | null;
            } | null) ?? null
          }
        />
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
        {/* Per-investor engagement — self-hides until the report is sent
            and events land, so it only appears on reports that have an
            audience to report on. */}
        <ReportEngagements reportId={reportId} />
      </div>
    </div>
  );
}
