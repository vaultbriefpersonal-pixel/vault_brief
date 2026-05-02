"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReportPreview } from "./ReportPreview";

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
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "#111111",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          color: "#555555",
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Editor pane */}
      <div
        style={{
          width: "50%",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255,255,255,0.08)",
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
                  color: "#555555",
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
            background: "#0a0a0a",
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
            borderTop: "1px solid rgba(255,255,255,0.08)",
            padding: 16,
            background: "#0a0a0a",
            flexShrink: 0,
          }}
        >
          <label
            style={{
              display: "block",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 11,
              fontWeight: 600,
              color: "#555555",
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
              background: "#111111",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              fontSize: 13.5,
              color: "#f0f0f0",
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
        </div>
      </div>

      {/* Preview pane */}
      <div style={{ width: "50%", display: "flex", flexDirection: "column" }}>
        <PaneHeader label="Preview" />
        <div style={{ flex: 1, overflowY: "auto", background: "#0a0a0a" }}>
          <ReportPreview content={content} />
        </div>
      </div>
    </div>
  );
}
