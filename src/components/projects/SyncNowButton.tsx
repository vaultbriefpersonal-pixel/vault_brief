"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, ChevronDown } from "lucide-react";
import { trpc } from "@/lib/api";

interface Props {
  projectId: string;
}

/**
 * WHAT BACKFILL DOES, now that it does something.
 *
 * These options were hard-disabled until 2026-07 because `createMonthlySnapshot`
 * read balances live and took no period argument, so a 12-month "backfill"
 * wrote twelve rows all carrying TODAY's balances and today's token price.
 * Month-over-month, anomalies and the forecast read those rows as observed
 * history and narrated a treasury that had been perfectly flat for a year, with
 * nothing in the output to say the numbers were copies.
 *
 * `projects.sync` now runs two passes. It takes ONE live balance read, for the
 * most recent period, and walks each older period's balances backwards through
 * that period's own transfer history —
 * `qty(t−1) = qty(t) − inbound(t) + outbound(t)` — pricing them at that
 * period's close rather than at today's price. Only the newest snapshot is
 * `observed`; every older one is written with `balance_basis:
 * 'reconstructed'`, and the report says so wherever a figure derived from
 * those balances appears.
 *
 * A reconstruction is an estimate and is labelled as one. Quantities it cannot
 * see — rebasing, staking accruals, mints, gas — all push a reconstructed
 * balance down, so an older snapshot's balances are a floor. The flow figures
 * on those rows (inflows, outflows, burn, expense and income breakdowns,
 * GitHub activity) are measured over the period exactly as they are for a
 * live sync; only the balances are walked back.
 *
 * Backfill costs one Alchemy transfer sweep per period per wallet plus a
 * historical price lookup per token per period, which is why it carries its own
 * 2/day limiter on top of the 3/hr sync limiter.
 */
interface SyncOption {
  label: string;
  months: number;
}

const OPTIONS: SyncOption[] = [
  { label: "Last month", months: 1 },
  { label: "Last 3 months (backfill)", months: 3 },
  { label: "Last 6 months (backfill)", months: 6 },
  { label: "Last 12 months (backfill)", months: 12 },
];

/** Shown under the dropdown so the estimate is disclosed before it is created, not only after. */
const BACKFILL_NOTE =
  "Backfill reconstructs past balances from transfer history and labels them as estimates.";

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
      const snapCount = res.snapshotIds?.length ?? 0;
      const errCount = res.errors?.length ?? 0;
      // A 200 that wrote nothing is not a success. Every period can be refused
      // — the period-collision guard does exactly that — and reporting
      // "Snapshot synced" over an empty write would be the most misleading
      // thing on the page.
      setStatus(snapCount === 0 ? "error" : "ok");
      const parts: string[] = [];
      if (snapCount === 0) parts.push("Nothing was synced");
      else if (snapCount > 1) parts.push(`${snapCount} months synced`);
      else parts.push("Snapshot synced");
      if (res.reportGenerated) parts.push("report generated");
      else if (res.reportId) parts.push("report exists");
      if (errCount > 0) parts.push(`${errCount} period(s) failed`);
      // The first failure's own words, not just a count. A period can fail
      // because a snapshot already exists at that date describing a DIFFERENT
      // reporting window — `snapshotPeriodConflicts` refuses rather than
      // overwrite the data under an existing report — and that refusal is only
      // actionable if the founder can read it.
      const firstError = res.errors?.[0]?.error;
      setMessage(
        parts.join(" · ") + "." + (firstError ? ` ${firstError}` : "")
      );
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
                color: "var(--vb-text)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--vb-card-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {opt.label}
            </button>
          ))}
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 11,
              lineHeight: 1.4,
              color: "var(--vb-muted)",
              margin: 0,
              padding: "6px 12px 4px",
              borderTop: "1px solid var(--vb-border)",
            }}
          >
            {BACKFILL_NOTE}
          </p>
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
