import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsd(amount: number, decimals = 2): string {
  // Negative balances are uncommon (overdrawn / pending settlement) but
  // surface naturally in net flow. Preserve the sign.
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  // Threshold escalation: B → M → K → cents. Two decimals once we cross
  // 100B (else "$2400.0M" leaks through for whale-tier treasuries; that's
  // the literal bug we just hit on the Whale Treasury mock).
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}$${abs.toFixed(decimals)}`;
}

/** `2026-04-30` — a calendar date, as Postgres `date` columns arrive. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(date: Date | string): string {
  // A "YYYY-MM-DD" string is a CALENDAR DATE, not an instant. `new Date()`
  // parses it as UTC midnight, and `toLocaleDateString` then renders it in the
  // runtime's own zone — so anywhere west of Greenwich the label slides back a
  // day, and with it the month, and at a year boundary the year:
  //
  //     formatDate("2026-01-01")  ->  "December 2025"   (America/New_York)
  //
  // This reaches `reports.period_end` and `treasury_snapshots.snapshot_date`,
  // both `date` columns, on the report header, the PDF, the public page and
  // the investor email. Vercel's runtimes are UTC, which is the only reason it
  // has not shipped a mislabelled report — but the dashboard also formats in
  // the BROWSER, so a founder in the US already sees the wrong month.
  //
  // Pinning the formatter to UTC for this shape keeps the label equal to the
  // date that was stored. `report-period.ts` avoids this helper entirely and
  // hand-rolls its labels from MONTH_NAMES for the same reason; this is the
  // same judgement, applied here rather than routed around.
  if (typeof date === "string" && DATE_ONLY.test(date)) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  // A real timestamp IS an instant, and rendering it in the reader's own zone
  // is correct. Left alone.
  return new Date(date).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
