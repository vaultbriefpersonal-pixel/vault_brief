"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, ChevronDown } from "lucide-react";
import { trpc } from "@/lib/api";

interface Props {
  projectId: string;
}

interface SyncOption {
  label: string;
  months: number;
  /**
   * Set on every `months > 1` option until real historical reconstruction
   * lands. `createMonthlySnapshot` calls
   * `fetchAllBalances(walletList, project.tokenSymbol)` with NO period
   * argument (data-sync.ts:32), so a 12-month "backfill" writes twelve rows
   * that all carry TODAY's balances and today's token price. That is strictly
   * worse than having one snapshot: month-over-month, anomalies and the
   * forecast all read those rows as observed history and narrate a treasury
   * that was perfectly flat for a year, and nothing in the output discloses
   * that the numbers are copies.
   *
   * Real backfill — walking balances back through transfer history and pricing
   * them at each period's close, disclosed as reconstructed rather than
   * observed — is task P3.1. Re-enable these there, not before.
   */
  disabledReason?: string;
}

const BACKFILL_DISABLED_REASON =
  "Backfill is temporarily unavailable — it would record today's balances under past dates. Coming with historical reconstruction.";

const OPTIONS: SyncOption[] = [
  { label: "Last month", months: 1 },
  {
    label: "Last 3 months (backfill)",
    months: 3,
    disabledReason: BACKFILL_DISABLED_REASON,
  },
  {
    label: "Last 6 months (backfill)",
    months: 6,
    disabledReason: BACKFILL_DISABLED_REASON,
  },
  {
    label: "Last 12 months (backfill)",
    months: 12,
    disabledReason: BACKFILL_DISABLED_REASON,
  },
];

/**
 * Manual sync trigger. Default click = last month (3/hr per project).
 * Dropdown ▾ for backfill (additionally 2/day per project).
 */
export function SyncNowButton({ projectId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "syncing" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const sync = trpc.projects.sync.useMutation({
    onSuccess: (res) => {
      setStatus("ok");
      const snapCount = res.snapshotIds?.length ?? 0;
      const errCount = res.errors?.length ?? 0;
      const parts: string[] = [];
      if (snapCount > 1) parts.push(`${snapCount} months synced`);
      else parts.push("Snapshot synced");
      if (res.reportGenerated) parts.push("report generated");
      else if (res.reportId) parts.push("report exists");
      if (errCount > 0) parts.push(`${errCount} period(s) failed`);
      setMessage(parts.join(" · ") + ".");
      router.refresh();
      setTimeout(() => setStatus("idle"), 5000);
    },
    onError: (err) => {
      setStatus("error");
      setMessage(err.message);
      setTimeout(() => setStatus("idle"), 5000);
    },
  });

  const isPending = sync.isPending || status === "syncing";

  function trigger(months: number) {
    setMenuOpen(false);
    setStatus("syncing");
    setMessage(null);
    sync.mutate({ projectId, months });
  }

  return (
    <div
      ref={wrapRef}
      style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 6, position: "relative" }}
    >
      <div style={{ display: "inline-flex", alignItems: "stretch" }}>
        <button
          type="button"
          onClick={() => trigger(1)}
          disabled={isPending}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: status === "ok" ? "rgba(0,232,123,0.12)" : "var(--vb-card)",
            border: `1px solid ${status === "ok" ? "var(--vb-border-hover)" : "var(--vb-border)"}`,
            borderRight: "none",
            borderRadius: "8px 0 0 8px",
            padding: "9px 14px",
            fontSize: 13,
            fontWeight: 500,
            color: status === "ok" ? "var(--accent)" : "var(--vb-text)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor: isPending ? "not-allowed" : "pointer",
            opacity: isPending ? 0.7 : 1,
            transition: "background 0.15s, border-color 0.15s",
          }}
        >
          {status === "ok" ? (
            <Check size={14} />
          ) : (
            <RefreshCw
              size={14}
              style={{
                animation: isPending ? "vb-spin 1s linear infinite" : "none",
              }}
            />
          )}
          {isPending ? "Syncing..." : status === "ok" ? "Synced" : "Sync now"}
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={isPending}
          aria-label="Sync options"
          style={{
            background: status === "ok" ? "rgba(0,232,123,0.12)" : "var(--vb-card)",
            border: `1px solid ${status === "ok" ? "var(--vb-border-hover)" : "var(--vb-border)"}`,
            borderRadius: "0 8px 8px 0",
            padding: "9px 8px",
            color: status === "ok" ? "var(--accent)" : "var(--vb-muted)",
            cursor: isPending ? "not-allowed" : "pointer",
            opacity: isPending ? 0.7 : 1,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {menuOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 50,
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 8,
            padding: 4,
            minWidth: 220,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.months}
              type="button"
              disabled={Boolean(opt.disabledReason)}
              title={opt.disabledReason}
              onClick={() => trigger(opt.months)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 13,
                color: opt.disabledReason ? "var(--vb-dim)" : "var(--vb-text)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                cursor: opt.disabledReason ? "not-allowed" : "pointer",
              }}
              onMouseEnter={(e) => {
                if (opt.disabledReason) return;
                e.currentTarget.style.background = "var(--vb-card-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {opt.label}
              {opt.disabledReason ? " — coming soon" : ""}
            </button>
          ))}
        </div>
      )}

      {message && (
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 11,
            color: status === "error" ? "var(--vb-danger)" : "var(--vb-muted)",
            margin: 0,
            maxWidth: 320,
            textAlign: "right",
            lineHeight: 1.4,
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
