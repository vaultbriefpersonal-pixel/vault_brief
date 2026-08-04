"use client";

import Link from "next/link";
import { Wallet } from "lucide-react";

/**
 * `latestSnapshotHasReport` used to be a third prop here, driving an "Up to
 * date" branch. It was UNREACHABLE: this component renders only when the
 * project has zero reports, and the prop was computed as "does any report point
 * at the latest snapshot", which is necessarily false when there are none. It
 * went out with the same idea in `GenerateReportButton` — with a period picker,
 * "the latest snapshot already has a report" is not a reason to refuse anyway,
 * because a different period is a different report.
 *
 * The "snapshot exists, zero reports" branch that used to live here (a bare
 * "Generate report" button calling `reports.generate` with only
 * `{projectId, snapshotId}`) is gone — that path always produced an investor
 * report with no period/grant/template choice, and combined with the
 * free-plan 1-report cap it meant a grant-focused founder's only report could
 * be silently spent on the wrong type before they ever saw a choice. The
 * reports page now renders `ReportPeriodPicker` (period + "Report about" +
 * template selectors) as soon as ANY snapshot exists, so this component only
 * ever renders for the true "nothing synced yet" case.
 */
interface Props {
  projectId: string;
  /** Always null today — kept as a prop so a future "no snapshot yet" variant can be told why, without changing the call site. */
  latestSnapshot: null;
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

export function ReportsEmptyState({ projectId }: Props) {
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
