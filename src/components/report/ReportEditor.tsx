"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReportPreview } from "./ReportPreview";

interface ReportEditorProps {
  initialContent: string;
  founderNotes?: string | null;
  onSave: (content: string, notes: string) => Promise<void>;
}

export function ReportEditor({
  initialContent,
  founderNotes,
  onSave,
}: ReportEditorProps) {
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
    <div className="flex h-full overflow-hidden">
      {/* Editor pane */}
      <div className="w-1/2 flex flex-col border-r border-slate-800">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Editor
          </span>
          {saving && (
            <span className="text-xs text-slate-500">Saving...</span>
          )}
        </div>
        <textarea
          className="flex-1 bg-slate-950 text-slate-200 text-sm font-mono p-4 resize-none focus:outline-none"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            triggerSave(e.target.value, notes);
          }}
          placeholder="Report content (Markdown)"
        />
        <div className="border-t border-slate-800 p-4">
          <label className="block text-xs text-slate-400 mb-2 font-medium uppercase tracking-wider">
            Founder notes (private context for investors)
          </label>
          <textarea
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
      <div className="w-1/2 flex flex-col">
        <div className="px-4 py-2 border-b border-slate-800 bg-slate-900">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Preview
          </span>
        </div>
        <div className="flex-1 overflow-auto bg-slate-950">
          <ReportPreview content={content} />
        </div>
      </div>
    </div>
  );
}
