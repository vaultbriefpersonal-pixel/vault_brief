"use client";

interface ReportPreviewProps {
  content: string;
}

export function ReportPreview({ content }: ReportPreviewProps) {
  if (!content) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 14,
          color: "var(--vb-dim)",
        }}
      >
        No content yet
      </div>
    );
  }

  const html = content
    .split("\n")
    .map((line) => {
      if (line.startsWith("### ")) return `<h3 style="font-family:var(--font-space-grotesk),'Space Grotesk',sans-serif;font-size:16px;font-weight:600;color:#f0f0f0;margin:28px 0 10px;letter-spacing:-0.01em">${line.slice(4)}</h3>`;
      if (line.startsWith("## ")) return `<h2 style="font-family:var(--font-space-grotesk),'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:#f0f0f0;margin:36px 0 12px;letter-spacing:-0.02em">${line.slice(3)}</h2>`;
      if (line.startsWith("# ")) return `<h1 style="font-family:var(--font-space-grotesk),'Space Grotesk',sans-serif;font-size:26px;font-weight:700;color:#f0f0f0;margin:0 0 20px;letter-spacing:-0.03em">${line.slice(2)}</h1>`;
      if (line.startsWith("- ") || line.startsWith("* ")) return `<li style="color:#888888;margin:4px 0;padding-left:4px">${line.slice(2)}</li>`;
      if (line.startsWith("| ")) return `<tr><td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);color:#888888">${line.slice(2).replace(/\s*\|\s*/g, '</td><td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);color:#888888">')}</td></tr>`;
      if (line.match(/^---+$/)) return `<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0"/>`;
      if (line.trim() === "") return `<div style="height:12px"></div>`;
      return `<p style="color:#888888;line-height:1.75;margin:0 0 4px">${line}</p>`;
    })
    .join("");

  return (
    <div
      style={{ padding: "24px 28px", fontSize: 14, maxWidth: "100%" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
