"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";

/**
 * Floating AI chat widget for marketing pages. Streams responses from
 * /api/chat (OpenRouter behind the scenes) and surfaces an inline mailto
 * CTA whenever the model emits the EMAIL_FALLBACK_SENTINEL.
 *
 * Storage: history persists in sessionStorage so reopening the panel
 * keeps the conversation; clears on tab close. No DB row per chat.
 */

const STORAGE_KEY = "vb-chat-history";
const SENTINEL = "<<EMAIL_FALLBACK>>";
const SUPPORT_EMAIL = "hello@vaultbrief.io";

type Role = "user" | "assistant";
interface Message {
  role: Role;
  content: string;
}

const INITIAL_GREETING: Message = {
  role: "assistant",
  content:
    "Hi — I can answer questions about Vault Brief: what it does, pricing, supported chains, security. What would help?",
};

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([INITIAL_GREETING]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore history from sessionStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      }
    } catch {
      // sessionStorage might be locked down (privacy mode) — silently fall through.
    }
  }, []);

  // Persist history on change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // see above
    }
  }, [messages]);

  // Auto-scroll the message list to the bottom on new content.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Focus input when panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    setError(null);
    setInput("");

    const next: Message[] = [
      ...messages,
      { role: "user", content },
      { role: "assistant", content: "" },
    ];
    setMessages(next);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Server adds the system prompt — we just send the visible turns.
          messages: next.slice(0, -1).filter((m) => m.content),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        // Replace last (assistant placeholder) with the running text.
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      // Drop the empty assistant placeholder we added optimistically.
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  function reset() {
    setMessages([INITIAL_GREETING]);
    setError(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Trigger button (always rendered) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close chat" : "Open chat"}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--accent)",
          color: "#0a0a0a",
          border: "none",
          boxShadow: "0 6px 24px rgba(0,232,123,0.35)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          transition: "transform 0.18s ease",
          transform: open ? "scale(0.94)" : "scale(1)",
        }}
      >
        {open ? (
          <X size={22} aria-hidden="true" />
        ) : (
          <MessageCircle size={22} aria-hidden="true" />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Vault Brief chat"
          style={{
            position: "fixed",
            bottom: 88,
            right: 20,
            width: 380,
            maxWidth: "calc(100vw - 32px)",
            height: 520,
            maxHeight: "calc(100dvh - 110px)",
            background: "var(--vb-card)",
            border: "1px solid var(--vb-border)",
            borderRadius: 16,
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 1000,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--vb-border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily:
                    "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--vb-text)",
                }}
              >
                Ask Vault Brief
              </div>
              <div
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 11,
                  color: "var(--vb-dim)",
                  marginTop: 2,
                }}
              >
                Beta — answers may be wrong. For anything important, email
                us.
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              aria-label="Clear conversation"
              style={{
                background: "transparent",
                border: "1px solid var(--vb-border)",
                borderRadius: 6,
                color: "var(--vb-dim)",
                fontSize: 11,
                padding: "5px 10px",
                cursor: "pointer",
                fontFamily: "var(--font-inter), Inter, sans-serif",
              }}
            >
              Reset
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollerRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} streaming={streaming && i === messages.length - 1} />
            ))}
            {error && (
              <div
                role="alert"
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 12,
                  color: "#f87171",
                  background: "rgba(248,113,113,0.06)",
                  border: "1px solid rgba(248,113,113,0.2)",
                  borderRadius: 8,
                  padding: "8px 12px",
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <div
            style={{
              borderTop: "1px solid var(--vb-border)",
              padding: 12,
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask anything…"
              rows={1}
              aria-label="Your message"
              style={{
                flex: 1,
                resize: "none",
                background: "var(--vb-alt)",
                border: "1px solid var(--vb-border)",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                color: "var(--vb-text)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                outline: "none",
                lineHeight: 1.4,
                minHeight: 40,
                maxHeight: 120,
              }}
            />
            <button
              type="button"
              onClick={send}
              disabled={!input.trim() || streaming}
              aria-label="Send"
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "var(--accent)",
                color: "#0a0a0a",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor:
                  !input.trim() || streaming ? "not-allowed" : "pointer",
                opacity: !input.trim() || streaming ? 0.5 : 1,
              }}
            >
              <Send size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Bubble + sentinel-aware renderer ──────────────────────────────────────

function MessageBubble({
  message,
  streaming,
}: {
  message: Message;
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  // The model emits a sentinel string when it doesn't know an answer.
  // Strip it from display and render an inline mailto block in its place.
  const sentinelHit = message.content.includes(SENTINEL);
  const displayed = sentinelHit
    ? message.content.replace(SENTINEL, "").trim()
    : message.content;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          background: isUser ? "rgba(0,232,123,0.12)" : "var(--vb-alt)",
          border: `1px solid ${
            isUser ? "rgba(0,232,123,0.25)" : "var(--vb-border)"
          }`,
          borderRadius: 12,
          padding: "10px 14px",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 14,
          color: "var(--vb-text)",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {displayed || (streaming ? <ThinkingDots /> : "")}
        {sentinelHit && (
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            style={{
              display: "inline-block",
              marginTop: 10,
              padding: "8px 14px",
              background: "var(--accent)",
              color: "#0a0a0a",
              borderRadius: 8,
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Email {SUPPORT_EMAIL} →
          </a>
        )}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span
      aria-label="thinking"
      style={{ display: "inline-flex", gap: 4, alignItems: "center" }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--vb-dim)",
            animation: `vb-chat-dot 1.2s ease-in-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes vb-chat-dot {
        0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
        30% { opacity: 1; transform: translateY(-2px); }
      }`}</style>
    </span>
  );
}
