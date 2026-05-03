"use client";

import { useEffect, useState } from "react";

const DEFAULT_BREAKPOINT_PX = 768;

/**
 * Tracks whether the viewport is currently below the given breakpoint.
 * SSR-safe: defaults to `false` on the server, syncs on mount via matchMedia.
 *
 * The first client render after hydration may flicker once for mobile users
 * (initial desktop render → re-render as mobile). That's the same trade-off
 * Next.js makes everywhere a viewport-aware UI exists; live with it.
 */
export function useIsMobile(breakpoint = DEFAULT_BREAKPOINT_PX): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const sync = () => setIsMobile(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [breakpoint]);
  return isMobile;
}
