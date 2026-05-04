"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useIsMobile } from "@/lib/use-is-mobile";

/**
 * Wraps the dashboard layout with a mobile-aware sidebar drawer.
 * Desktop (>=768px): renders sidebar inline as a sticky column (pre-existing behaviour).
 * Mobile (<768px): hides the sidebar offscreen behind a slide-in drawer + backdrop,
 * with a fixed burger toggle in the top-left.
 */
export function DashboardShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes — a tap on a nav link should
  // navigate AND close the menu in one motion.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open so background content
  // doesn't scroll under the overlay.
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, isMobile]);

  // Desktop: original layout, sidebar is rendered inline.
  // Container is fixed to viewport height (not minHeight) and main owns the
  // scroll. This way the sidebar stays a sticky 100dvh column and its
  // background fills to the bottom of the window even when the main column's
  // content is taller — fixes the "sidebar ends mid-page" visual.
  if (!isMobile) {
    return (
      <div style={{ display: "flex", height: "100dvh", background: "var(--vb-bg)" }}>
        {sidebar}
        <main style={{ flex: 1, minWidth: 0, overflow: "auto" }}>{children}</main>
      </div>
    );
  }

  // Mobile: drawer + backdrop + main with a top burger bar.
  return (
    <div style={{ minHeight: "100dvh", background: "var(--vb-bg)" }}>
      {/* Top bar with burger */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          height: 52,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: "rgba(10,10,10,0.92)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--vb-border)",
        }}
      >
        <button
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
          style={{
            background: "transparent",
            border: "1px solid var(--vb-border)",
            borderRadius: 8,
            color: "var(--vb-text)",
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Backdrop — fades in over content while drawer is open. */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 40,
            transition: "opacity 0.2s ease",
          }}
        />
      )}

      {/* Sidebar drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: 260,
          maxWidth: "85vw",
          zIndex: 50,
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s ease",
          boxShadow: open ? "0 0 40px rgba(0,0,0,0.5)" : "none",
        }}
      >
        {sidebar}
      </div>

      <main>{children}</main>
    </div>
  );
}
