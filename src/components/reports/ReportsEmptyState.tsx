"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles, Wallet } from "lucide-react";
import { trpc } from "@/lib/api";
import { formatDate } from "@/lib/utils";

/**
 * `latestSnapshotHasReport` used to be a third prop here, driving an "Up to
 * date" branch. It was UNREACHABLE: this component renders only when the
 * project has zero reports, and the prop was computed as "does any report point
 * at the latest snapshot", which is necessarily false when there are none. It
 * went out with the same idea in `GenerateReportButton` — with a period picker,
 * "the latest snapshot already has a report" is not a reason to refuse anyway,
 * because a different period is a different report.
 */
interface Props {
  projectId: string;
  /** Latest snapshot for the project, or null if none has been synced yet. */
  latestSnapshot: { id: string; snapshotDate: string } | null;
}

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--vb-border)",
  background: "var(--vb-card)",
  borderRadius: 14,
  padding: "64px 24px",
  textAlign: "center",
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
};

const iconWrap: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 12,
  background: "rgba(0,232,123,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "0 auto 16px",
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
  fontSize: 16,
  fontWeight: 600,
  color: "var(--vb-text)",
  margin: "0 0 8px",
};

const bodyStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 13,
  color: "var(--vb-muted)",
  margin: 0,
  lineHeight: 1.6,
  maxWidth: 380,
};

const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "#00e87b",
  color: "#0a0a0a",
  border: "none",
  borderRadius: 8,
  padding: "11px 18px",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "var(--font-inter), Inter, sans-serif",
  cursor: "pointer",
  marginTop: 24,
  textDecoration: "none",
};

const secondaryBtn: React.CSSProperties = {
  ...primaryBtn,
  background: "transparent",
  color: "var(--vb-muted)",
  border: "1px solid rgba(255,255,255,0.12)",
};

export function ReportsEmptyState({ projectId, latestSnapshot }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const generate = trpc.reports.generate.useMutation({
    onSuccess: (report) => {
      // Refresh the SSR page so the new draft row appears in the list.
      router.refresh();
      // Optional: jump straight into the editor.
      router.push(`/projects/${projectId}/reports/${report.id}`);
    },
    onError: (err) => {
      setError(err.message || "Failed to generate report");
    },
  });

  // Branch 1 — no snapshot has ever synced for this project.
  if (!latestSnapshot) {
    return (
      <div style={cardStyle}>
        <div style={iconWrap}>
          <Wallet size={20} color="#00e87b" />
        </div>
        <p style={titleStyle}>No data synced yet</p>
        <p style={bodyStyle}>
          Add at least one wallet so Vault Brief can pull treasury data.
          Reports also generate automatically on the 1st of each month.
        </p>
        <Link href={`/projects/${projectId}/wallets`} style={primaryBtn}>
          <Wallet size={14} />
          Add a wallet
        </Link>
      </div>
    );
  }

  // Branch 2 — a snapshot exists and the project has no reports → offer manual
  // generate. No period argument: the server defaults to the snapshot's own
  // window, which is the only window this snapshot can honestly be reported
  // over. Once a first report exists the page swaps this out for the full
  // period picker.
  const monthLabel = formatDate(latestSnapshot.snapshotDate);

  return (
    <div style={cardStyle}>
      <div style={iconWrap}>
        <Sparkles size={20} color="#00e87b" />
      </div>
      <p style={titleStyle}>Ready to generate</p>
      <p style={bodyStyle}>
        Your {monthLabel} snapshot is ready. Generate an investor report now
        or wait for the automatic run on the 3rd of next month.
      </p>
      <button
        type="button"
        onClick={() =>
          generate.mutate({ projectId, snapshotId: latestSnapshot.id })
        }
        disabled={generate.isPending}
        style={{
          ...primaryBtn,
          opacity: generate.isPending ? 0.7 : 1,
          cursor: generate.isPending ? "not-allowed" : "pointer",
        }}
      >
        <Sparkles size={14} />
        {generate.isPending
          ? "Generating report..."
          : `Generate report from ${monthLabel} snapshot`}
      </button>
      {error && (
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "#f87171",
            margin: "12px 0 0",
          }}
        >
          {error}
        </p>
      )}
      <Link
        href={`/projects/${projectId}`}
        style={{ ...secondaryBtn, marginTop: 12 }}
      >
        Back to project
      </Link>
    </div>
  );
}
