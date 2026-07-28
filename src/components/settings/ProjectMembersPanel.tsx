"use client";

import { useState } from "react";
import { trpc } from "@/lib/api";
import { Plus, Trash2 } from "lucide-react";

/**
 * TODO-026 phase 1 — invited collaborators on a project. Every member is
 * editor-equivalent today regardless of stored role (see guards.ts);
 * role is persisted so a follow-up phase can enforce viewer read-only /
 * admin-only actions without a second migration. Only the owner or a
 * member with role='admin' can invite/change-role/remove — the backend
 * enforces this (requireProjectAdmin); this panel just reflects it.
 */

const ROLES = ["admin", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number];

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--vb-alt)",
  border: "1px solid var(--vb-border)",
  borderRadius: 6,
  padding: "9px 12px",
  fontSize: 13,
  color: "var(--vb-text)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--vb-muted)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

export function ProjectMembersPanel({ projectId }: { projectId: string }) {
  // No <SessionProvider> exists anywhere in this app (confirmed — the
  // established pattern for "who am I" client-side is a tRPC query
  // through protectedProcedure, not next-auth/react's useSession, which
  // has no context to read from and would throw/return undefined here).
  const { data: me } = trpc.users.me.useQuery();
  const { data, refetch } = trpc.projectMembers.list.useQuery({ projectId });
  const invite = trpc.projectMembers.invite.useMutation({
    onSuccess: () => {
      setEmail("");
      setInviteError(null);
      refetch();
    },
    onError: (err) => setInviteError(err.message),
  });
  const updateRole = trpc.projectMembers.updateRole.useMutation({
    onSuccess: () => refetch(),
  });
  const remove = trpc.projectMembers.remove.useMutation({
    onSuccess: () => refetch(),
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const isOwner = data?.owner?.id === me?.id;
  const myMembership = data?.members.find((m) => m.userId === me?.id);
  const isAdmin = isOwner || myMembership?.role === "admin";

  function submitInvite() {
    if (!email.trim()) return;
    invite.mutate({ projectId, email: email.trim(), role });
  }

  return (
    <div style={{ marginTop: 40 }}>
      <h3
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--vb-muted)",
          margin: "0 0 14px",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        Team access
      </h3>
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          color: "var(--vb-muted)",
          margin: "0 0 16px",
          lineHeight: 1.5,
        }}
      >
        Invite co-founders or teammates to this project. They need a
        VaultBrief account already (sign in once first) — inviting an
        unknown email will ask you to try again after they&apos;ve signed in.
      </p>

      {data?.owner && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            background: "var(--vb-alt)",
            border: "1px solid var(--vb-border)",
            borderRadius: 8,
            marginBottom: 8,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
          }}
        >
          <span style={{ color: "var(--vb-text)" }}>
            {data.owner.name || data.owner.email}{" "}
            <span style={{ color: "var(--vb-dim)" }}>({data.owner.email})</span>
          </span>
          <span style={{ color: "var(--vb-dim)", fontSize: 11 }}>Owner</span>
        </div>
      )}

      {(data?.members ?? []).map((m) => (
        <div
          key={m.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "10px 12px",
            background: "var(--vb-alt)",
            border: "1px solid var(--vb-border)",
            borderRadius: 8,
            marginBottom: 8,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, color: "var(--vb-text)" }}>
            {m.name || m.email}{" "}
            <span style={{ color: "var(--vb-dim)" }}>({m.email})</span>
          </span>
          {isAdmin ? (
            <>
              <select
                value={m.role}
                onChange={(e) =>
                  updateRole.mutate({
                    projectId,
                    memberId: m.id,
                    role: e.target.value as Role,
                  })
                }
                style={{ ...inputStyle, width: "auto", fontSize: 11, padding: "5px 8px" }}
                aria-label={`Role for ${m.email}`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => remove.mutate({ projectId, memberId: m.id })}
                aria-label={`Remove ${m.email}`}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 6,
                  borderRadius: 4,
                  cursor: "pointer",
                  color: "#f87171",
                  display: "flex",
                }}
              >
                <Trash2 size={13} />
              </button>
            </>
          ) : (
            <span style={{ color: "var(--vb-dim)", fontSize: 11, textTransform: "capitalize" }}>
              {m.role}
            </span>
          )}
        </div>
      ))}

      {isAdmin && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr auto",
            gap: 8,
            marginTop: 12,
            alignItems: "end",
          }}
        >
          <div>
            <label style={labelStyle}>Invite by email</label>
            <input
              type="email"
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cofounder@example.com"
            />
          </div>
          <div>
            <label style={labelStyle}>Role</label>
            <select
              style={inputStyle}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={submitInvite}
            disabled={!email.trim() || invite.isPending}
            style={{
              background: "#00e87b",
              color: "#0a0a0a",
              border: "none",
              borderRadius: 6,
              padding: "9px 14px",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              cursor: invite.isPending ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            <Plus size={12} /> {invite.isPending ? "Inviting…" : "Invite"}
          </button>
        </div>
      )}
      {inviteError && (
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "#f87171",
            marginTop: 8,
          }}
        >
          {inviteError}
        </p>
      )}
    </div>
  );
}
