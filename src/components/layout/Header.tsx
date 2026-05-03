"use client";

import { useSession } from "next-auth/react";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const { data: session } = useSession();

  return (
    <header
      style={{
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 28px",
        borderBottom: "1px solid var(--vb-border)",
        background: "var(--vb-bg)",
        flexShrink: 0,
      }}
    >
      <h1
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 16,
          fontWeight: 600,
          color: "var(--vb-text)",
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h1>
      {session?.user && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {session.user.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt={session.user.name ?? ""}
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            />
          )}
          <span
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "var(--vb-dim)",
            }}
          >
            {session.user.email}
          </span>
        </div>
      )}
    </header>
  );
}
