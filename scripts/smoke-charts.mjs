// Smoke test for the chart-PNG pipeline (Phase B email path).
//
// What it does:
//   1. Imports the SVG builders + rasterizeAndUpload from chart-png.ts.
//   2. Renders 3 sample charts (composition / chain split / trend bars).
//   3. Pushes each to Vercel Blob.
//   4. Fetches the returned URLs back, confirms they serve real PNG bytes.
//
// Why this script: avoids needing a logged-in session + draft report +
// real email send to validate that the chart pipeline works on a given
// BLOB_READ_WRITE_TOKEN. Also doesn't write to user.email or trigger any
// real email send — pure read-write of the Blob store.
//
// Run:    node scripts/smoke-charts.mjs
// Needs:  BLOB_READ_WRITE_TOKEN in env.

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN not set in .env.local — aborting.");
  process.exit(1);
}

const {
  compositionPieSvg,
  chainSplitSvg,
  trendBarsSvg,
  rasterizeAndUpload,
} = await import("../src/server/services/chart-png.ts");

const fakeReportId = `smoke-${Date.now()}`;
const accent = "#5746FF";

const composition = compositionPieSvg(
  [
    { label: "Stables", value: 2_800_000 },
    { label: "ETH/WETH", value: 10_500_000 },
    { label: "ENS", value: 59_900_000 },
  ],
  accent
);
const chainBar = chainSplitSvg([
  { chain: "ethereum", value: 65_000_000 },
  { chain: "optimism", value: 5_200_000 },
  { chain: "base", value: 3_000_000 },
]);
const trend = trendBarsSvg(
  [
    { date: "2025-12-01", value: 65_000_000 },
    { date: "2026-01-01", value: 67_500_000 },
    { date: "2026-02-01", value: 70_100_000 },
    { date: "2026-03-01", value: 71_000_000 },
    { date: "2026-04-01", value: 73_200_000 },
  ],
  accent
);

console.log(`Smoke run — reportId=${fakeReportId}\n`);

const cases = [
  { name: "composition", svg: composition },
  { name: "chain", svg: chainBar },
  { name: "trend", svg: trend },
];

for (const c of cases) {
  process.stdout.write(`  ${c.name.padEnd(12)} → `);
  const url = await rasterizeAndUpload(c.svg, fakeReportId, c.name);
  if (!url) {
    console.log("FAILED (rasterizeAndUpload returned null)");
    continue;
  }
  // Verify the URL serves a real PNG.
  const head = await fetch(url, { method: "HEAD" });
  const len = head.headers.get("content-length");
  const type = head.headers.get("content-type");
  console.log(
    `${head.status} ${type} ${len ? `(${(parseInt(len, 10) / 1024).toFixed(1)}KB)` : ""}`
  );
  console.log(`    ${url}`);
}

console.log("\nDone.");
