"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Horizontal sub-nav for project pages.
 *
 * Replaces the old "Wallets / Reports / Investors / Settings" KPI-style
 * cards on the overview, which read as empty stat tiles and got missed
 * (Settings especially). Tabs make navigation distinct from metrics and
 * give the founder a persistent way to jump between project sections —
 * not just from overview.
 *
 * Active tab is detected from pathname; counts render as small badges.
 * Settings has no count + lives in the kebab menu, so it isn't repeated
 * here — that keeps the bar tight (3 tabs) and avoids two ways to reach
 * the same place.
 */
export function ProjectTabs({
  projectId,
  counts,
}: {
  projectId: string;
  counts: { wallets: number; reports: number; investors: number };
}) {
  const pathname = usePathname();

  const tabs = [
    { href: `/projects/${projectId}`, label: "Overview", count: undefined as number | undefined },
    { href: `/projects/${projectId}/wallets`, label: "Wallets", count: counts.wallets },
    { href: `/projects/${projectId}/reports`, label: "Reports", count: counts.reports },
    { href: `/projects/${projectId}/investors`, label: "Investors", count: counts.investors },
  ];

  return (
    <nav
      role="navigation"
      aria-label="Project sections"
      style={{
        display: "flex",
        gap: 4,
        flexWrap: "wrap",
        borderBottom: "1px solid var(--vb-border)",
        marginBottom: 24,
      }}
    >
      {tabs.map(({ href, label, count }) => {
        // Overview matches only exact /projects/<id>; sub-tabs match
        // their own segment OR a deeper segment (e.g. /reports/<id>
        // still highlights "Reports").
        const isActive =
          href === `/projects/${projectId}`
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: isActive ? "var(--vb-text)" : "var(--vb-muted)",
              textDecoration: "none",
              borderBottom: isActive
                ? "2px solid #00e87b"
                : "2px solid transparent",
              marginBottom: -1, // pull the underline flush with parent border
              whiteSpace: "nowrap",
              transition: "color 120ms ease",
            }}
          >
            {label}
            {count !== undefined && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  background: isActive
                    ? "rgba(0,232,123,0.15)"
                    : "rgba(255,255,255,0.06)",
                  color: isActive ? "#00e87b" : "var(--vb-dim)",
                  padding: "1px 7px",
                  borderRadius: 999,
                  lineHeight: 1.5,
                }}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
