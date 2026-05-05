"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreVertical,
  Settings as SettingsIcon,
  Download,
  Copy,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/api";

/**
 * Kebab menu sitting next to "Sync now" on the project page.
 *
 * Settings used to live in the KPI grid alongside Wallets / Reports /
 * Investors. It carried no count, so it looked like an empty stat tile
 * and blended into the metrics. Pulling it into a dropdown next to the
 * primary action gives users a single, predictable place for "actions
 * on this project" and frees the KPI row for actual KPIs.
 *
 * Items, in display order:
 *   1) Project settings — primary nav, every founder needs it
 *   2) Export data       — JSON dump (project + wallets + snapshots + reports)
 *   3) Duplicate         — clone project + wallets, fresh sync downstream
 *   --- separator ---
 *   4) Delete project    — destructive, last, red. Confirm via window.confirm.
 *
 * Closes on outside click, Escape, or item click.
 */
export function ProjectActionsMenu({
  projectId,
  projectSlug,
}: {
  projectId: string;
  projectSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"export" | "duplicate" | "delete" | null>(
    null
  );
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const utils = trpc.useUtils();

  const duplicate = trpc.projects.duplicate.useMutation({
    onSuccess: (copy) => {
      utils.projects.list.invalidate();
      router.push(`/projects/${copy.id}`);
    },
    onSettled: () => setBusy(null),
    onError: (err) => alert(`Duplicate failed: ${err.message}`),
  });

  const del = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      router.push("/projects");
    },
    onSettled: () => setBusy(null),
    onError: (err) => alert(`Delete failed: ${err.message}`),
  });

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

  // Export uses a one-shot fetch via tRPC then triggers a browser
  // download. We intentionally skip the React-Query cache: each export
  // should be a fresh snapshot, and the JSON can be large.
  async function handleExport() {
    setBusy("export");
    try {
      const data = await utils.projects.export.fetch({ id: projectId });
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${projectSlug}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      alert(
        `Export failed: ${err instanceof Error ? err.message : "unknown"}`
      );
    } finally {
      setBusy(null);
    }
  }

  function handleDuplicate() {
    setBusy("duplicate");
    setOpen(false);
    duplicate.mutate({ id: projectId });
  }

  function handleDelete() {
    if (
      !window.confirm(
        "Delete this project? Wallets, snapshots, and reports will be permanently removed. This cannot be undone."
      )
    )
      return;
    setBusy("delete");
    setOpen(false);
    del.mutate({ id: projectId });
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Project actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={busy !== null}
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
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.6 : 1,
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
            minWidth: 200,
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
            style={menuItemStyle}
            onMouseEnter={menuItemHover}
            onMouseLeave={menuItemUnhover}
          >
            <SettingsIcon size={14} color="#00e87b" />
            Project settings
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={handleExport}
            disabled={busy !== null}
            style={menuItemStyle}
            onMouseEnter={menuItemHover}
            onMouseLeave={menuItemUnhover}
          >
            <Download size={14} color="var(--vb-muted)" />
            {busy === "export" ? "Exporting…" : "Export data"}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={handleDuplicate}
            disabled={busy !== null}
            style={menuItemStyle}
            onMouseEnter={menuItemHover}
            onMouseLeave={menuItemUnhover}
          >
            <Copy size={14} color="var(--vb-muted)" />
            {busy === "duplicate" ? "Duplicating…" : "Duplicate"}
          </button>

          <div
            style={{
              height: 1,
              background: "var(--vb-border)",
              margin: "6px 4px",
            }}
            aria-hidden
          />

          <button
            type="button"
            role="menuitem"
            onClick={handleDelete}
            disabled={busy !== null}
            style={{ ...menuItemStyle, color: "#f87171" }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "rgba(248,113,113,0.08)")
            }
            onMouseLeave={menuItemUnhover}
          >
            <Trash2 size={14} color="#f87171" />
            {busy === "delete" ? "Deleting…" : "Delete project"}
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 10px",
  borderRadius: 6,
  fontSize: 13,
  color: "var(--vb-text)",
  textDecoration: "none",
  background: "transparent",
  border: "none",
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

function menuItemHover(e: React.MouseEvent<HTMLElement>) {
  (e.currentTarget as HTMLElement).style.background = "rgba(0,232,123,0.06)";
}

function menuItemUnhover(e: React.MouseEvent<HTMLElement>) {
  (e.currentTarget as HTMLElement).style.background = "transparent";
}
