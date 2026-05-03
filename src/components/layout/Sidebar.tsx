"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  FolderOpen,
  CreditCard,
  LogOut,
  BarChart3,
  Settings,
  HelpCircle,
  Bell,
  ExternalLink,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut } from "next-auth/react";
import { Logo } from "@/components/marketing/Logo";
import { trpc } from "@/lib/api";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  external?: boolean;
  showUnread?: boolean;
}

const NAV: NavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/notifications", label: "Notifications", icon: Bell, showUnread: true },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/docs", label: "Help & Docs", icon: HelpCircle, external: true },
];

function UnreadBadge() {
  // No interval polling — react-query refetches on window focus by default,
  // and mutations that create notifications invalidate this query directly.
  // Idle tabs don't burn DB calls, fresh tabs feel live.
  const { data } = trpc.notifications.unreadCount.useQuery(undefined, {
    staleTime: 30_000,
  });
  if (!data || data === 0) return null;
  return (
    <span
      style={{
        marginLeft: "auto",
        background: "#00e87b",
        color: "#0a0a0a",
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 999,
        minWidth: 20,
        textAlign: "center",
      }}
    >
      {data > 99 ? "99+" : data}
    </span>
  );
}

function NavLink({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const Icon = item.icon;

  const sharedStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderRadius: 10,
    fontSize: 16,
    fontFamily: "var(--font-inter), Inter, sans-serif",
    fontWeight: active ? 600 : 400,
    color: active ? "#00e87b" : hovered ? "#f0f0f0" : "#888888",
    background: active
      ? "rgba(0,232,123,0.08)"
      : hovered
        ? "rgba(255,255,255,0.04)"
        : "transparent",
    textDecoration: "none",
    transition: "all 0.2s ease",
    transform: hovered && !active ? "translateX(2px)" : "none",
  };

  const inner = (
    <>
      <Icon size={20} strokeWidth={active ? 2 : 1.5} />
      {item.label}
      {item.external && (
        <ExternalLink size={12} style={{ marginLeft: 4, opacity: 0.6 }} />
      )}
      {item.showUnread && <UnreadBadge />}
    </>
  );

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={sharedStyle}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={sharedStyle}
    >
      {inner}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [signOutHovered, setSignOutHovered] = useState(false);

  return (
    <aside
      style={{
        width: 260,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: "#111111",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        minHeight: "100dvh",
        position: "sticky",
        top: 0,
        height: "100dvh",
      }}
    >
      <Link
        href="/"
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
          textDecoration: "none",
          transition: "opacity 0.2s ease",
        }}
      >
        <Logo size={22} />
      </Link>

      <nav
        style={{
          flex: 1,
          padding: "12px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflowY: "auto",
        }}
      >
        {NAV.map((item) => {
          const active =
            !item.external &&
            (pathname === item.href || pathname.startsWith(item.href + "/"));
          return <NavLink key={item.href} item={item} active={active} />;
        })}
      </nav>

      <div
        style={{
          padding: "10px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          onMouseEnter={() => setSignOutHovered(true)}
          onMouseLeave={() => setSignOutHovered(false)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: 10,
            fontSize: 16,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: signOutHovered ? "#f87171" : "#555555",
            background: signOutHovered
              ? "rgba(248,113,113,0.06)"
              : "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            transition: "all 0.2s ease",
          }}
        >
          <LogOut size={20} strokeWidth={1.5} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
