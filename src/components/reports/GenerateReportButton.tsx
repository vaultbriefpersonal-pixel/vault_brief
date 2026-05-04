"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { trpc } from "@/lib/api";

/**
 * Manual "Generate report" CTA shown above the reports list once the user
 * already has at least one report. Re-uses the existing reports.generate
 * mutation that powers ReportsEmptyState. Disabled when there's no fresh
 * snapshot or the latest snapshot has already been turned into a report —
 * with explanatory tooltip text in those cases so it's clear *why*.
 */
interface Props {
  projectId: string;
  latestSnapshotId: string | null;
  latestSnapshotHasReport: boolean;
}

export function GenerateReportButton({
  projectId,
  latestSnapshotId,
  latestSnapshotHasReport,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const generate = trpc.reports.generate.useMutation({
    onSuccess: (report) => {
      router.refresh();
      router.push(`/projects/${projectId}/reports/${report.id}`);
    },
    onError: (err) => setError(err.message || "Failed to generate report"),
  });

  // No snapshot at all → user needs to Sync first.
  if (!latestSnapshotId) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "rgba(0,232,123,0.04)",
          border: "1px solid rgba(0,232,123,0.12)",
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 16,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          color: "var(--vb-muted)",
        }}
      >
        Sync your project to pull a fresh treasury snapshot, then generate a
        report from it.
      </div>
    );
  }

  // Latest snapshot already has a report → nothing new to generate.
  // We still render a disabled button so the affordance is visible, with a
  // hint pointing the user at /sync to refresh data.
  const blocked = latestSnapshotHasReport;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={() =>
          generate.mutate({ projectId, snapshotId: latestSnapshotId })
        }
        disabled={blocked || generate.isPending}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: blocked ? "rgba(255,255,255,0.06)" : "#00e87b",
          color: blocked ? "var(--vb-dim)" : "#0a0a0a",
          border: "none",
          borderRadius: 8,
          padding: "11px 18px",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          cursor:
            blocked || generate.isPending ? "not-allowed" : "pointer",
          opacity: generate.isPending ? 0.7 : 1,
        }}
        title={
          blocked
            ? "Latest snapshot already has a report. Click Sync now on the dashboard to pull fresh data."
            : "Generate a draft report from the latest snapshot"
        }
      >
        <Sparkles size={14} />
        {generate.isPending
          ? "Generating draft..."
          : blocked
            ? "Latest snapshot already used"
            : "Generate report"}
      </button>
      {error && (
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "#f87171",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
