"use client";

import { use, useState } from "react";
import { trpc } from "@/lib/api";
import { Trash2, Plus, UserPlus } from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--vb-alt)",
  border: "1px solid var(--vb-border)",
  borderRadius: 8,
  padding: "13px 16px",
  fontSize: 15,
  color: "var(--vb-text)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  outline: "none",
  boxSizing: "border-box",
};

export default function InvestorsPage({ params }: Props) {
  const { id: projectId } = use(params);
  const [form, setForm] = useState({ name: "", email: "", firm: "", role: "" });
  const [error, setError] = useState<string | null>(null);

  const { data: investorList, refetch } = trpc.investors.list.useQuery({
    projectId,
  });

  const add = trpc.investors.add.useMutation({
    onSuccess: () => {
      setForm({ name: "", email: "", firm: "", role: "" });
      setError(null);
      refetch();
    },
    onError: (e) => setError(e.message),
  });

  const remove = trpc.investors.remove.useMutation({
    onSuccess: () => refetch(),
  });

  return (
    <div style={{ padding: "24px 28px", minHeight: "100dvh" }}>
      <h2
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--vb-text)",
          margin: "0 0 24px",
          letterSpacing: "-0.02em",
        }}
      >
        Investors
      </h2>

      <div
        style={{
          background: "var(--vb-card)",
          border: "1px solid var(--vb-border)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--vb-muted)",
            margin: "0 0 14px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <UserPlus size={13} />
          Add investor
        </h3>
        {error && (
          <div
            style={{
              marginBottom: 12,
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.2)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "#f87171",
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
            {error}
          </div>
        )}
        <div
          className="vb-form-2col"
          style={{ gap: 8, marginBottom: 12 }}
        >
          <input
            style={inputStyle}
            placeholder="Full name *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            type="email"
            style={inputStyle}
            placeholder="Email *"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <input
            style={inputStyle}
            placeholder="Firm (e.g. a16z)"
            value={form.firm}
            onChange={(e) => setForm((f) => ({ ...f, firm: e.target.value }))}
          />
          <input
            style={inputStyle}
            placeholder="Role (e.g. Lead Investor)"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          />
        </div>
        <button
          onClick={() =>
            add.mutate({
              projectId,
              name: form.name,
              email: form.email,
              firm: form.firm || undefined,
              role: form.role || undefined,
            })
          }
          disabled={!form.name || !form.email || add.isPending}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            background: "#00e87b",
            color: "#0a0a0a",
            border: "none",
            borderRadius: 8,
            padding: "13px 20px",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor:
              !form.name || !form.email || add.isPending
                ? "not-allowed"
                : "pointer",
            opacity: !form.name || !form.email || add.isPending ? 0.6 : 1,
          }}
        >
          <Plus size={13} />
          Add investor
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {investorList?.length === 0 && (
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              color: "var(--vb-dim)",
              textAlign: "center",
              padding: "40px 0",
            }}
          >
            No investors added yet.
          </p>
        )}
        {investorList?.map((inv) => (
          <div
            key={inv.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--vb-card)",
              border: "1px solid var(--vb-border)",
              borderRadius: 10,
              padding: "12px 16px",
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--vb-text)",
                  margin: "0 0 3px",
                }}
              >
                {inv.name}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 12,
                  color: "var(--vb-dim)",
                  margin: 0,
                }}
              >
                {inv.email}
                {inv.firm && ` · ${inv.firm}`}
                {inv.role && ` · ${inv.role}`}
              </p>
            </div>
            <button
              onClick={() => remove.mutate({ investorId: inv.id })}
              style={{
                background: "transparent",
                border: "none",
                padding: "6px",
                borderRadius: 6,
                cursor: "pointer",
                color: "var(--vb-dim)",
                display: "flex",
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
