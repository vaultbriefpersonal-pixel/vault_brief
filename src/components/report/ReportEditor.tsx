"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReportPreview } from "./ReportPreview";
import { useIsMobile } from "@/lib/use-is-mobile";
import { upsertFounderNoteSection } from "@/lib/report-markdown";

interface ReportEditorProps {
  initialContent: string;
  founderNotes?: string | null;
  onSave: (content: string, notes: string) => Promise<void>;
}

function PaneHeader({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "1px solid var(--vb-border)",
        background: "var(--vb-alt)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--vb-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </span>
      {right}
    </div>
  );
}

export function ReportEditor({ initialContent, founderNotes, onSave }: ReportEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [notes, setNotes] = useState(founderNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [inserting, setInserting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobile = useIsMobile();
  // On mobile we collapse the 50/50 split to a tab switcher. Both panes stay
  // mounted (display: none toggles visibility) so textarea state is preserved
  // when the user flips between Editor and Preview.
  const [mobileTab, setMobileTab] = useState<"editor" | "preview">("editor");

  const triggerSave = useCallback(
    (c: string, n: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        await onSave(c, n).finally(() => setSaving(false));
      }, 5000);
    },
    [onSave]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Explicit, deliberate publish action (B7 fix) — pulls the founder's own
  // notes into the report body as a real "## Founder's note" section, which
  // is what the PDF/public view/email actually render. Saves immediately
  // rather than through the 5-second debounce: a one-click action should
  // feel instant, and any pending debounced autosave must be cancelled
  // first so it can't fire afterward with stale content and clobber this.
  const handleInsertFounderNote = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const updated = upsertFounderNoteSection(content, notes);
    setContent(updated);
    setInserting(true);
    try {
      await onSave(updated, notes);
    } finally {
      setInserting(false);
    }
  }, [content, notes, onSave]);

  const editorVisible = !isMobile || mobileTab === "editor";
  const previewVisible = !isMobile || mobileTab === "preview";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {isMobile && (
        <div
          style={{
            display: "flex",
            background: "var(--vb-bg)",
            borderBottom: "1px solid var(--vb-border)",
            flexShrink: 0,
          }}
        >
          {(["editor", "preview"] as const).map((t) => {
            const active = mobileTab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setMobileTab(t)}
                aria-pressed={active}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  background: active ? "#111111" : "transparent",
                  border: "none",
                  borderBottom: active
                    ? "2px solid #00e87b"
                    : "2px solid transparent",
                  color: active ? "#f0f0f0" : "var(--vb-dim)",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  cursor: "pointer",
                }}
              >
                {t === "editor" ? "Editor" : "Preview"}
              </button>
            );
          })}
        </div>
      )}

      {/* Editor pane */}
      <div
        style={{
          width: isMobile ? "100%" : "50%",
          display: editorVisible ? "flex" : "none",
          flexDirection: "column",
          borderRight: isMobile
            ? "none"
            : "1px solid rgba(255,255,255,0.08)",
          minHeight: 0,
        }}
      >
        <PaneHeader
          label="Editor"
          right={
            saving ? (
              <span
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 12,
                  color: "var(--vb-dim)",
                }}
              >
                Saving...
              </span>
            ) : undefined
          }
        />
        <textarea
          style={{
            flex: 1,
            background: "var(--vb-bg)",
            color: "#cccccc",
            fontSize: 13,
            fontFamily: "var(--font-geist-mono), monospace",
            padding: "20px",
            resize: "none",
            border: "none",
            outline: "none",
            lineHeight: 1.75,
          }}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            triggerSave(e.target.value, notes);
          }}
          placeholder="Report content (Markdown)"
        />
        <div
          style={{
            borderTop: "1px solid var(--vb-border)",
            padding: 16,
            background: "var(--vb-bg)",
            flexShrink: 0,
          }}
        >
          <label
            style={{
              display: "block",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--vb-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Founder notes
          </label>
          <textarea
            rows={3}
            style={{
              width: "100%",
              background: "var(--vb-alt)",
              border: "1px solid var(--vb-border)",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--vb-text)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              padding: "10px 12px",
              resize: "none",
              outline: "none",
              boxSizing: "border-box",
            }}
            placeholder="Add any qualitative context for this month..."
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              triggerSave(content, e.target.value);
            }}
          />
          <button
            type="button"
            onClick={handleInsertFounderNote}
            disabled={inserting}
            className="mt-2 rounded-md border border-[var(--vb-border)] bg-[var(--vb-alt)] px-3 py-1.5 text-xs font-medium text-[var(--vb-text)] hover:bg-[var(--vb-border)] disabled:opacity-50"
          >
            {inserting ? "Inserting..." : "Insert as Founder's note"}
          </button>
        </div>
      </div>

      {/* Preview pane */}
      <div
        style={{
          width: isMobile ? "100%" : "50%",
          display: previewVisible ? "flex" : "none",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {/* PaneHeader hidden on mobile — the tab switcher already labels it. */}
        {!isMobile && <PaneHeader label="Preview" />}
        {/* Stays dark on purpose: it is the gutter the page floats on, not
            the page. `sheet` gives the document an edge so the founder is
            looking at the artifact their funder receives, rather than at a
            dark-themed approximation of it. */}
        <div style={{ flex: 1, overflowY: "auto", background: "var(--vb-alt)" }}>
          <ReportPreview content={content} sheet />
        </div>
      </div>
    </div>
  );
}
