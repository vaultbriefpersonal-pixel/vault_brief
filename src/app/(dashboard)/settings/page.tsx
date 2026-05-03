"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { trpc } from "@/lib/api";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "#888888",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#111111",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 14,
  color: "#f0f0f0",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  outline: "none",
  boxSizing: "border-box",
};

export default function GlobalSettingsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: me } = trpc.users.me.useQuery();
  const [name, setName] = useState("");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (me) {
      setName(me.name ?? "");
      setEmailNotifications(me.emailNotifications ?? true);
    }
  }, [me]);

  const update = trpc.users.update.useMutation({
    onSuccess: () => {
      utils.users.me.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const deleteMe = trpc.users.delete.useMutation({
    onSuccess: () => {
      signOut({ callbackUrl: "/" });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({ name: name.trim() || null, emailNotifications });
  }

  return (
    <div style={{ padding: "24px 28px", minHeight: "100dvh", maxWidth: 720 }}>
      <h2
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 22,
          fontWeight: 700,
          color: "#f0f0f0",
          margin: "0 0 4px",
          letterSpacing: "-0.02em",
        }}
      >
        Account settings
      </h2>
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13.5,
          color: "#888888",
          margin: "0 0 28px",
          lineHeight: 1.6,
        }}
      >
        Profile and notification preferences for your VaultBrief account.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{
          background: "#161616",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          marginBottom: 24,
        }}
      >
        <div>
          <label style={labelStyle}>Display name</label>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            disabled
            value={me?.email ?? ""}
            style={{ ...inputStyle, opacity: 0.6, cursor: "not-allowed" }}
          />
          <p
            style={{
              fontSize: 11,
              color: "#555",
              margin: "6px 0 0",
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
            Tied to your sign-in provider. Cannot be changed here.
          </p>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            cursor: "pointer",
            padding: "12px 14px",
            background: "rgba(255,255,255,0.02)",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <input
            type="checkbox"
            checked={emailNotifications}
            onChange={(e) => setEmailNotifications(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#00e87b" }}
          />
          <div>
            <p
              style={{
                fontSize: 14,
                color: "#f0f0f0",
                margin: 0,
                fontWeight: 500,
                fontFamily: "var(--font-inter), Inter, sans-serif",
              }}
            >
              Email me when reports are ready
            </p>
            <p
              style={{
                fontSize: 12,
                color: "#888",
                margin: "2px 0 0",
                fontFamily: "var(--font-inter), Inter, sans-serif",
              }}
            >
              Auto-generated drafts trigger a notification email. Uncheck to
              rely on the in-app inbox only.
            </p>
          </div>
        </label>

        <button
          type="submit"
          disabled={update.isPending}
          style={{
            background: saved ? "rgba(0,232,123,0.15)" : "#00e87b",
            color: saved ? "#00e87b" : "#0a0a0a",
            border: saved ? "1px solid rgba(0,232,123,0.3)" : "none",
            borderRadius: 8,
            padding: "12px 24px",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor: update.isPending ? "not-allowed" : "pointer",
            opacity: update.isPending ? 0.7 : 1,
            alignSelf: "flex-start",
          }}
        >
          {saved ? "Saved!" : update.isPending ? "Saving..." : "Save changes"}
        </button>
      </form>

      <div
        style={{
          border: "1px solid rgba(248,113,113,0.2)",
          background: "rgba(248,113,113,0.04)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: "#f87171",
            margin: "0 0 8px",
          }}
        >
          Danger zone
        </h3>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "#888888",
            margin: "0 0 16px",
            lineHeight: 1.6,
          }}
        >
          Deleting your account permanently removes all projects, wallets,
          snapshots, reports, and investor lists. This cannot be undone.
        </p>
        <button
          onClick={() => {
            if (
              window.confirm(
                "Delete your account and all data? This cannot be undone."
              )
            ) {
              deleteMe.mutate();
            }
          }}
          disabled={deleteMe.isPending}
          style={{
            background: "transparent",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 13,
            color: "#f87171",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor: deleteMe.isPending ? "not-allowed" : "pointer",
            opacity: deleteMe.isPending ? 0.6 : 1,
          }}
        >
          {deleteMe.isPending ? "Deleting..." : "Delete account"}
        </button>
      </div>

      {/* Avoid hooks rule warning when router is unused: keep silent reference */}
      {router && null}
    </div>
  );
}
