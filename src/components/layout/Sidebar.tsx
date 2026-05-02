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
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Logo } from "@/components/marketing/Logo";

const NAV = [
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

const SECONDARY = [
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "help", label: "Help & Docs", icon: HelpCircle },
];

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
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
      }}
    >
      <Icon size={20} strokeWidth={active ? 2 : 1.5} />
      {label}
    </Link>
  );
}

function DisabledItem({
  label,
  icon: Icon,
}: {
  label: string;
  icon: React.ElementType;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 10,
        fontSize: 16,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontWeight: 400,
        color: hovered ? "#777777" : "#555555",
        background: hovered ? "rgba(255,255,255,0.02)" : "transparent",
        cursor: "default",
        transition: "all 0.2s ease",
      }}
    >
      <Icon size={20} strokeWidth={1.5} />
      {label}
    </div>
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
        minHeight: "100vh",
        position: "sticky",
        top: 0,
        height: "100vh",
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
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={active}
            />
          );
        })}

        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.06)",
            margin: "12px 6px",
          }}
        />

        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: "#444444",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "6px 16px 6px",
            margin: 0,
          }}
        >
          Coming soon
        </p>

        {SECONDARY.map(({ key, label, icon }) => (
          <DisabledItem key={key} label={label} icon={icon} />
        ))}
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
