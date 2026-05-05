"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MoreVertical, Settings as SettingsIcon } from "lucide-react";

/**
 * Kebab menu sitting next to "Sync now" on the project page.
 *
 * Settings used to live in the KPI grid alongside Wallets / Reports /
 * Investors — it had no count, so it looked like an empty stat tile and
 * blended into the metrics. Pulling it into a dropdown next to the
 * primary action gives users a single, predictable place for "actions
 * on this project" and frees the KPI row for actual KPIs.
 *
 * Closes on outside click, Escape, or item click. No portal — the menu
 * lives in document flow so it inherits the page's stacking and
 * doesn't break inside scroll containers.
 */
export function ProjectActionsMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Project actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 38,
          height: 38,
          borderRadius: 8,
          background: "var(--vb-card)",
          border: "1px solid var(--vb-border)",
          color: "var(--vb-muted)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 180,
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            padding: 6,
            zIndex: 20,
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          <Link
            role="menuitem"
            href={`/projects/${projectId}/settings`}
            onClick={() => setOpen(false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              borderRadius: 6,
              fontSize: 13,
              color: "var(--vb-text)",
              textDecoration: "none",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.background =
                "rgba(0,232,123,0.06)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.background =
                "transparent")
            }
          >
            <SettingsIcon size={14} color="#00e87b" />
            Project settings
          </Link>
        </div>
      )}
    </div>
  );
}
