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

export function formatDate(date: Date | string): string {
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
