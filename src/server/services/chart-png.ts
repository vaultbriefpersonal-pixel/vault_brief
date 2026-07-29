import { put } from "@vercel/blob";

// `@resvg/resvg-js` is loaded lazily (dynamic import inside
// rasterizeAndUpload) so callers that never produce a chart — most
// notably the Trigger.dev jobs that import email-sender for the
// "ready for review" path — don't drag the native binary into their
// bundle. The Trigger.dev build image is glibc-based and chokes on
// the package's musl optional dep variant during `npm i`. Combined
// with `build.external` in trigger.config.ts this keeps resvg out of
// the deploy pipeline entirely while still working in the Next.js
// runtime where Vercel handles native deps correctly.
type ResvgModule = typeof import("@resvg/resvg-js");
let resvgPromise: Promise<ResvgModule> | null = null;
function loadResvg(): Promise<ResvgModule> {
  if (!resvgPromise) {
    resvgPromise = import("@resvg/resvg-js");
  }
  return resvgPromise;
}

/**
 * Render the same chart shapes the PDF uses, but as raw SVG strings →
 * rasterize to PNG via @resvg/resvg-js → upload to Vercel Blob → return
 * the public URL. The investor email then embeds <img src=URL>.
 *
 * Why a parallel renderer (instead of reusing pdf-charts.tsx):
 *   - React-PDF's <Svg>/<Path>/<Text> are React-PDF-specific JSX, not raw
 *     SVG markup. Rasterizing them would mean rendering a one-page PDF and
 *     extracting an image, which is heavyweight.
 *   - The chart math here (angles, percentages, color mapping) mirrors
 *     pdf-charts.tsx — keep them in sync if either side is tweaked.
 *
 * Fail-open contract: if anything in this file throws (Blob misconfigured,
 * resvg missing native binary, etc.), the caller catches and falls back
 * to the email-without-charts path. Charts are nice-to-have; emails ship
 * either way.
 */

const SERIES = [
  "#6366F1",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
];
const CHAIN_COLORS: Record<string, string> = {
  ethereum: "#627EEA",
  polygon: "#8247E5",
  arbitrum: "#28A0F0",
  base: "#0052FF",
  optimism: "#FF0420",
  solana: "#9945FF",
};

// ─── SVG builders (raw strings) ───────────────────────────────────────────

export function compositionPieSvg(
  data: Array<{ label: string; value: number }>,
  accent?: string
): string {
  const slices = data.filter((s) => s.value > 0);
  const total = slices.reduce((a, b) => a + b.value, 0);
  if (slices.length === 0 || total === 0) return "";

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  const inner = r * 0.55;

  let startAngle = -Math.PI / 2;
  const wedges: string[] = [];
  const legend: string[] = [];
  slices.forEach((s, i) => {
    const angle = (s.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const path = donutPath(cx, cy, r, inner, startAngle, endAngle);
    const fill = i === 0 && accent ? accent : SERIES[i % SERIES.length];
    wedges.push(`<path d="${path}" fill="${fill}" />`);
    const ly = 14 + i * 24;
    legend.push(
      `<rect x="${size + 16}" y="${ly}" width="10" height="10" fill="${fill}" rx="2"/>` +
      `<text x="${size + 32}" y="${ly + 9}" font-family="Helvetica,Arial,sans-serif" font-size="11" fill="#374151">${escapeXml(s.label)}</text>` +
      `<text x="${size + 32}" y="${ly + 22}" font-family="Helvetica,Arial,sans-serif" font-size="10" fill="#6b7280">${((s.value / total) * 100).toFixed(1)}%</text>`
    );
    startAngle = endAngle;
  });

  const totalW = size + 240;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${size}" viewBox="0 0 ${totalW} ${size}">
    ${wedges.join("\n")}
    ${legend.join("\n")}
  </svg>`;
}

export function chainSplitSvg(
  data: Array<{ chain: string; value: number }>
): string {
  const items = data.filter((d) => d.value > 0);
  if (items.length < 2) return "";
  const total = items.reduce((s, d) => s + d.value, 0);
  const width = 560;
  const barH = 28;
  const sorted = [...items].sort((a, b) => b.value - a.value);

  let x = 0;
  const segs: string[] = [];
  const legend: string[] = [];
  const cols = Math.min(sorted.length, 4);
  const colW = width / cols;
  sorted.forEach((d, i) => {
    const w = (d.value / total) * width;
    const fill = CHAIN_COLORS[d.chain] ?? "#666";
    segs.push(`<rect x="${x}" y="0" width="${w}" height="${barH}" fill="${fill}"/>`);
    if (i < cols) {
      const lx = i * colW;
      legend.push(
        `<rect x="${lx}" y="${barH + 14}" width="9" height="9" fill="${fill}" rx="2"/>` +
        `<text x="${lx + 14}" y="${barH + 22}" font-family="Helvetica,Arial,sans-serif" font-size="10" fill="#374151" font-weight="600">${capitalize(d.chain)}</text>` +
        `<text x="${lx + 14}" y="${barH + 35}" font-family="Helvetica,Arial,sans-serif" font-size="9" fill="#6b7280">${((d.value / total) * 100).toFixed(0)}%</text>`
      );
    }
    x += w;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${barH + 50}" viewBox="0 0 ${width} ${barH + 50}">
    ${segs.join("\n")}
    <rect x="0" y="0" width="${width}" height="${barH}" fill="none" stroke="#E5E7EB" stroke-width="0.5" rx="4"/>
    ${legend.join("\n")}
  </svg>`;
}

export function trendBarsSvg(
  data: Array<{ date: string; value: number }>,
  accent?: string
): string {
  if (data.length < 2) return "";
  const width = 560;
  const height = 140;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 30;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(...data.map((d) => d.value));
  const range = max || 1;
  const barGap = 6;
  const barW = (innerW - barGap * (data.length - 1)) / data.length;
  const fill = accent ?? "#10B981";

  const yLabels = [
    { y: padT + 6, value: max },
    { y: padT + innerH / 2 + 4, value: max / 2 },
    { y: padT + innerH + 4, value: 0 },
  ]
    .map(
      (l) =>
        `<text x="${padL - 6}" y="${l.y}" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="9" fill="#6b7280">${abbrev(l.value)}</text>`
    )
    .join("\n");
  const grid = [0, 0.5, 1]
    .map(
      (f) =>
        `<line x1="${padL}" y1="${padT + innerH * f}" x2="${padL + innerW}" y2="${padT + innerH * f}" stroke="#E5E7EB" stroke-width="0.5"/>`
    )
    .join("\n");
  const bars = data
    .map((d, i) => {
      const h = (d.value / range) * innerH;
      const x = padL + i * (barW + barGap);
      const y = padT + innerH - h;
      const labelY = padT + innerH + 16;
      return (
        `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${fill}" rx="2"/>` +
        `<text x="${x + barW / 2}" y="${labelY}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="9" fill="#6b7280">${shortMonth(d.date)}</text>`
      );
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${yLabels}
    ${grid}
    ${bars}
  </svg>`;
}

// ─── Rasterize + upload ───────────────────────────────────────────────────

/**
 * Convert an SVG string to a PNG, upload to Vercel Blob with a path keyed
 * to (reportId, chartName), return the public URL. Returns null on any
 * failure so the caller can render the email without the chart.
 */
export async function rasterizeAndUpload(
  svg: string,
  reportId: string,
  chartName: string,
  scale = 2
): Promise<string | null> {
  if (!svg) return null;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Vercel Blob isn't configured — silently skip; email goes out without
    // charts and KPI grid still carries the numbers. Better than 500ing.
    console.warn("rasterizeAndUpload: BLOB_READ_WRITE_TOKEN not set, skipping");
    return null;
  }
  try {
    const { Resvg } = await loadResvg();
    const resvg = new Resvg(svg, {
      fitTo: { mode: "zoom", value: scale },
      // Helvetica isn't bundled by default; @resvg ships a built-in font
      // that covers Latin glyphs which is enough for our chart labels.
      font: { loadSystemFonts: false },
    });
    const png = resvg.render().asPng();
    const key = `report-charts/${reportId}/${chartName}.png`;
    const { url } = await put(key, Buffer.from(png), {
      access: "public",
      contentType: "image/png",
      // Each report regenerates → invalidate prior chart blob with the same
      // key. Vercel Blob's `addRandomSuffix=false` means we overwrite in place.
      addRandomSuffix: false,
      allowOverwrite: true,
      // key is fully deterministic (reportId + chartName, no content hash),
      // so the blob path — and its public URL — never changes across
      // regenerations. @vercel/blob's put() defaults cacheControlMaxAge to one
      // month, so without an explicit override, browsers and the Blob CDN keep
      // serving pre-regeneration bytes at this same URL for up to a month after
      // the content actually changed. 60 is the lowest value Vercel allows
      // ("Cannot be set to a value lower than 1 minute") — this isn't an
      // arbitrary magic number, it's the enforced floor.
      cacheControlMaxAge: 60,
    });
    return url;
  } catch (err) {
    console.error("rasterizeAndUpload failed", { reportId, chartName, err });
    return null;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

function donutPath(
  cx: number,
  cy: number,
  r: number,
  inner: number,
  start: number,
  end: number
): string {
  const so = polar(cx, cy, r, start);
  const eo = polar(cx, cy, r, end);
  const si = polar(cx, cy, inner, end);
  const ei = polar(cx, cy, inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${so.x} ${so.y} A ${r} ${r} 0 ${large} 1 ${eo.x} ${eo.y} L ${si.x} ${si.y} A ${inner} ${inner} 0 ${large} 0 ${ei.x} ${ei.y} Z`;
}
function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function abbrev(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function shortMonth(yyyymm: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = parseInt(yyyymm.slice(5, 7), 10);
  return months[m - 1] ?? "?";
}
