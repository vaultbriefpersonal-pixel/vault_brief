"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
  Trash2,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Send,
} from "lucide-react";
import { trpc } from "@/lib/api";
import type { Notification } from "@/server/db/schema";

const TYPE_ICON: Record<string, React.ReactNode> = {
  snapshot_ready: <Clock size={16} color="#00e87b" />,
  report_generated: <FileText size={16} color="#00e87b" />,
  report_sent: <Send size={16} color="#00e87b" />,
  sync_failed: <AlertCircle size={16} color="#f87171" />,
};

function timeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return date.toLocaleDateString();
}

export default function NotificationsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: list, isLoading } = trpc.notifications.list.useQuery();

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });
  const clear = trpc.notifications.clear.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  function handleClick(n: Notification) {
    if (!n.readAt) markRead.mutate({ id: n.id });
    if (n.href) router.push(n.href);
  }

  const unreadCount = list?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div style={{ padding: "24px 28px", minHeight: "100vh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <h2 style={titleStyle}>Notifications</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => markAllRead.mutate()}
            disabled={unreadCount === 0 || markAllRead.isPending}
            style={{
              ...secondaryBtn,
              opacity: unreadCount === 0 ? 0.4 : 1,
              cursor: unreadCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            <CheckCheck size={13} />
            Mark all read
          </button>
          <button
            onClick={() => {
              if (window.confirm("Delete all notifications?")) clear.mutate();
            }}
            disabled={!list?.length || clear.isPending}
            style={{
              ...secondaryBtn,
              opacity: !list?.length ? 0.4 : 1,
              cursor: !list?.length ? "not-allowed" : "pointer",
            }}
          >
            <Trash2 size={13} />
            Clear
          </button>
        </div>
      </div>

      {isLoading && (
        <p style={{ fontSize: 13, color: "#555", fontFamily: "var(--font-inter), Inter, sans-serif" }}>
          Loading...
        </p>
      )}

      {!isLoading && (!list || list.length === 0) && (
        <div
          style={{
            background: "#161616",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 14,
            padding: "64px 24px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "rgba(0,232,123,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <Bell size={20} color="#00e87b" />
          </div>
          <p
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 16,
              fontWeight: 600,
              color: "#f0f0f0",
              margin: "0 0 6px",
            }}
          >
            All caught up
          </p>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "#555",
              margin: 0,
            }}
          >
            New events will show up here when your snapshots sync or reports are
            generated.
          </p>
        </div>
      )}

      {list && list.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((n) => {
            const isUnread = !n.readAt;
            const Inner = (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  alignItems: "start",
                  gap: 14,
                  padding: "14px 18px",
                  borderRadius: 12,
                  border: `1px solid ${isUnread ? "rgba(0,232,123,0.2)" : "rgba(255,255,255,0.06)"}`,
                  background: isUnread ? "rgba(0,232,123,0.04)" : "#161616",
                  cursor: n.href ? "pointer" : "default",
                  transition: "background 0.15s",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.04)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 2,
                  }}
                >
                  {TYPE_ICON[n.type] ?? <CheckCircle2 size={16} color="#888" />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#f0f0f0",
                      margin: "0 0 4px",
                    }}
                  >
                    {n.title}
                  </p>
                  {n.body && (
                    <p
                      style={{
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        fontSize: 13,
                        color: "#888",
                        margin: 0,
                        lineHeight: 1.5,
                      }}
                    >
                      {n.body}
                    </p>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 11,
                    color: "#555",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isUnread && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#00e87b",
                      }}
                    />
                  )}
                  {timeAgo(new Date(n.createdAt!))}
                </div>
              </div>
            );

            if (n.href) {
              return (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {Inner}
                </button>
              );
            }
            return <div key={n.id}>{Inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
  fontSize: 22,
  fontWeight: 700,
  color: "#f0f0f0",
  letterSpacing: "-0.02em",
  margin: 0,
};

const secondaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 500,
  color: "#f0f0f0",
  fontFamily: "var(--font-inter), Inter, sans-serif",
};

// Avoid unused-import warning since Link is referenced in a code path that
// may be tree-shaken — keep as side-effect-free reference.
void Link;
