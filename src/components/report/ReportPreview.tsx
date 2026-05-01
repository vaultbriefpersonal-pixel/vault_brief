"use client";

interface ReportPreviewProps {
  content: string;
}

export function ReportPreview({ content }: ReportPreviewProps) {
  if (!content) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        No content yet
      </div>
    );
  }

  // Simple markdown → HTML for preview (no external lib needed)
  const html = content
    .split("\n")
    .map((line) => {
      if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
      if (line.startsWith("- ") || line.startsWith("* "))
        return `<li>${line.slice(2)}</li>`;
      if (line.startsWith("| ")) return `<tr><td>${line.slice(2).replace(/\s*\|\s*/g, "</td><td>")}</td></tr>`;
      if (line.match(/^---+$/)) return `<hr/>`;
      if (line.trim() === "") return `<br/>`;
      return `<p>${line}</p>`;
    })
    .join("\n");

  return (
    <div
      className="prose prose-invert prose-sm max-w-none px-6 py-4 text-slate-300 overflow-auto"
      style={{
        ["--tw-prose-headings" as string]: "#e2e8f0",
        ["--tw-prose-hr" as string]: "#334155",
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
