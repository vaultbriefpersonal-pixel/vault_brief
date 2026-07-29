"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/api";
import { Pencil } from "lucide-react";
import { SectionDataModal } from "./SectionDataModal";
import {
  SECTION_LIBRARY_META,
  type ReportSectionMeta,
  type SectionConfigEntry,
} from "@/server/services/report-sections";

// Sections backed by manual-entry tables — Edit data button shows here.
// milestones_completed + looking_ahead share one milestones table; the
// modal routes both section IDs to the same MilestonesRenderer.
const MANUAL_DATA_SECTIONS = new Set([
  "actual_vs_budget",
  "grants_distributed",
  "governance_updates",
  "partners_integrations",
  "asks",
  "qa_highlights",
  "milestones_completed",
  "looking_ahead",
]);

/**
 * Per-project report-template constructor.
 *
 * The founder reorders sections (drag handles) and toggles them on/off.
 * Save persists the ordered list + flags into `projects.reportSections`
 * via tRPC. Null on first load = "use product defaults" — we hydrate
 * from `SECTION_LIBRARY_META` so every section in the library shows up,
 * including off-by-default ones the founder might want to opt into.
 *
 * Native HTML5 drag-drop, no extra dependency. List length is bounded
 * (~19 entries) so a custom sortable is fine.
 */
export function ReportTemplateEditor({
  projectId,
  initial,
}: {
  projectId: string;
  initial: SectionConfigEntry[] | null;
}) {
  const [items, setItems] = useState<SectionConfigEntry[]>(() =>
    hydrate(initial)
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    },
  });

  const metaById = useMemo<Record<string, ReportSectionMeta>>(
    () => Object.fromEntries(SECTION_LIBRARY_META.map((m) => [m.id, m])),
    []
  );

  // Live readiness — server runs each section's requires(ctx) against the
  // latest snapshot + milestones and tells us which sections will actually
  // produce visible output. Founders enabling 5 manual-only sections
  // ("Asks", "Q&A") and seeing nothing change otherwise feels broken.
  const readinessQ = trpc.projects.getSectionReadiness.useQuery({
    projectId,
  });
  const readinessById = useMemo(() => {
    const m: Record<string, { ready: boolean; reason?: string }> = {};
    for (const r of readinessQ.data?.readiness ?? []) {
      m[r.id] = { ready: r.ready, reason: r.reason };
    }
    return m;
  }, [readinessQ.data]);
  const noSnapshot = readinessQ.data?.hasSnapshot === false;

  function toggle(id: string) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, enabled: !it.enabled } : it))
    );
  }

  function move(fromId: string, toId: string) {
    if (fromId === toId) return;
    setItems((prev) => {
      const from = prev.findIndex((p) => p.id === fromId);
      const to = prev.findIndex((p) => p.id === toId);
      if (from === -1 || to === -1) return prev;
      const next = prev.slice();
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked);
      return next;
    });
  }

  function reset() {
    setItems(hydrate(null));
  }

  function save() {
    update.mutate({ id: projectId, reportSections: items });
  }

  const enabledCount = items.filter((i) => i.enabled).length;

  return (
    <div style={{ gridColumn: "1 / -1", marginTop: 24 }}>
      <h3
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--vb-muted)",
          margin: "0 0 14px",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        Report template
      </h3>
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          color: "var(--vb-muted)",
          margin: "0 0 16px",
          lineHeight: 1.5,
        }}
      >
        Pick which sections appear in this project&apos;s monthly report and
        in what order. Drag to reorder; toggle to enable / disable. Sections
        whose data isn&apos;t available yet still save — they just stay
        silent until the data lands.
      </p>

      <div
        style={{
          border: "1px solid var(--vb-border)",
          borderRadius: 10,
          overflow: "hidden",
          background: "var(--vb-alt)",
        }}
      >
        {items.map((item) => {
          const meta = metaById[item.id];
          if (!meta) return null;
          const isDragTarget = dragId && dragId !== item.id;
          return (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => {
                setDragId(item.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) move(dragId, item.id);
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderBottom: "1px solid var(--vb-border)",
                background:
                  isDragTarget && dragId === item.id
                    ? "rgba(0,232,123,0.05)"
                    : "transparent",
                opacity: item.enabled ? 1 : 0.55,
                cursor: "grab",
              }}
            >
              <span
                aria-hidden
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  color: "var(--vb-dim)",
                  fontSize: 14,
                  userSelect: "none",
                }}
                title="Drag to reorder"
              >
                ≡
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                  }}
                >
                  {meta.title}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 12,
                    color: "var(--vb-muted)",
                    marginTop: 2,
                    lineHeight: 1.45,
                  }}
                >
                  {meta.description}
                </div>
                {/* Readiness chip + (for manual sections) Edit data
                    button. Together they tell the founder whether
                    enabling this row will produce visible output, and
                    give a one-click path to fix it when not. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 6,
                  }}
                >
                  {item.enabled &&
                    (() => {
                      const r = readinessById[item.id];
                      if (noSnapshot) {
                        return (
                          <ReadinessChip
                            tone="warn"
                            text="Run a sync first to see this section."
                          />
                        );
                      }
                      if (!r) return null;
                      if (r.ready) {
                        return <ReadinessChip tone="ok" text="Ready" />;
                      }
                      return (
                        <ReadinessChip
                          tone="warn"
                          text={r.reason ?? "Not yet ready"}
                        />
                      );
                    })()}
                  {MANUAL_DATA_SECTIONS.has(item.id) && (
                    <button
                      type="button"
                      onClick={() => setEditingSectionId(item.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: "transparent",
                        border: "1px solid var(--vb-border)",
                        borderRadius: 999,
                        padding: "2px 9px",
                        fontSize: 11,
                        color: "var(--vb-muted)",
                        cursor: "pointer",
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                      }}
                    >
                      <Pencil size={10} /> Edit data
                    </button>
                  )}
                </div>
              </div>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 12,
                  color: "var(--vb-muted)",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={() => toggle(item.id)}
                  style={{ accentColor: "#00e87b" }}
                />
                {item.enabled ? "On" : "Off"}
              </label>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "var(--vb-dim)",
          }}
        >
          {enabledCount} of {items.length} sections enabled
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "transparent",
              border: "1px solid var(--vb-border)",
              borderRadius: 8,
              padding: "9px 14px",
              fontSize: 13,
              color: "var(--vb-muted)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              cursor: "pointer",
            }}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={save}
            disabled={update.isPending}
            style={{
              background: savedFlash ? "rgba(0,232,123,0.15)" : "#00e87b",
              color: savedFlash ? "#00e87b" : "#0a0a0a",
              border: savedFlash ? "1px solid rgba(0,232,123,0.3)" : "none",
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              cursor: update.isPending ? "not-allowed" : "pointer",
              opacity: update.isPending ? 0.7 : 1,
            }}
          >
            {savedFlash
              ? "Saved!"
              : update.isPending
                ? "Saving..."
                : "Save template"}
          </button>
        </div>
      </div>

      {editingSectionId && (
        <SectionDataModal
          projectId={projectId}
          sectionId={editingSectionId}
          onClose={() => {
            setEditingSectionId(null);
            // Re-fetch readiness so the chip flips green if data was added.
            utils.projects.getSectionReadiness.invalidate({ projectId });
          }}
        />
      )}
    </div>
  );
}

function ReadinessChip({
  tone,
  text,
}: {
  tone: "ok" | "warn";
  text: string;
}) {
  const palette =
    tone === "ok"
      ? {
          bg: "rgba(0,232,123,0.08)",
          border: "rgba(0,232,123,0.25)",
          color: "#00e87b",
        }
      : {
          bg: "rgba(240,184,71,0.08)",
          border: "rgba(240,184,71,0.25)",
          color: "#f0b847",
        };
  return (
    <div
      style={{
        marginTop: 6,
        display: "inline-flex",
        alignItems: "center",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontWeight: 500,
        color: palette.color,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}

/**
 * Build the editing list. Stored config wins on order + enabled flags.
 * Library sections missing from the stored config are appended at the
 * end with their defaultEnabled — so adding new sections in code
 * surfaces them in every project's editor automatically.
 */
function hydrate(stored: SectionConfigEntry[] | null): SectionConfigEntry[] {
  if (!stored || stored.length === 0) {
    return SECTION_LIBRARY_META.map((m) => ({
      id: m.id,
      enabled: m.defaultEnabled,
    }));
  }
  const seen = new Set<string>();
  const result: SectionConfigEntry[] = [];
  for (const entry of stored) {
    if (!SECTION_LIBRARY_META.some((m) => m.id === entry.id)) continue;
    seen.add(entry.id);
    result.push({ id: entry.id, enabled: entry.enabled });
  }
  for (const m of SECTION_LIBRARY_META) {
    if (!seen.has(m.id)) result.push({ id: m.id, enabled: m.defaultEnabled });
  }
  return result;
}
