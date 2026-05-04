"use client";

import { use, useMemo, useState } from "react";
import { trpc } from "@/lib/api";
import { Trash2, Plus, UserPlus, Search } from "lucide-react";

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

type SortKey = "name" | "firm" | "added";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name (A→Z)" },
  { key: "firm", label: "Firm (A→Z)" },
  { key: "added", label: "Recently added" },
];

export default function InvestorsPage({ params }: Props) {
  const { id: projectId } = use(params);
  const [form, setForm] = useState({ name: "", email: "", firm: "", role: "" });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [firmFilter, setFirmFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const { data: investorList, refetch } = trpc.investors.list.useQuery({
    projectId,
  });

  // Distinct firm names for the filter dropdown — recompute only when the
  // raw list changes. Empty / null firms collapse to "—" bucket.
  const firmOptions = useMemo(() => {
    if (!investorList) return [];
    const set = new Set<string>();
    for (const inv of investorList) {
      if (inv.firm) set.add(inv.firm);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [investorList]);

  const visible = useMemo(() => {
    if (!investorList) return [];
    const q = search.trim().toLowerCase();
    const filtered = investorList.filter((inv) => {
      if (firmFilter && (inv.firm ?? "") !== firmFilter) return false;
      if (!q) return true;
      return (
        inv.name.toLowerCase().includes(q) ||
        inv.email.toLowerCase().includes(q) ||
        (inv.firm?.toLowerCase().includes(q) ?? false) ||
        (inv.role?.toLowerCase().includes(q) ?? false)
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "firm")
        return (a.firm ?? "").localeCompare(b.firm ?? "");
      // "added" — newest first; createdAt comes back as Date | string
      const at = new Date(a.createdAt ?? 0).getTime();
      const bt = new Date(b.createdAt ?? 0).getTime();
      return bt - at;
    });
    return sorted;
  }, [investorList, search, firmFilter, sortKey]);

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

      {/* Toolbar — only render once the list is meaningful enough to need
          filtering. Below 5 investors the search/sort/filter bar adds noise. */}
      {investorList && investorList.length >= 5 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div style={{ flex: "1 1 240px", minWidth: 200, position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--vb-dim)",
                pointerEvents: "none",
              }}
            />
            <input
              type="search"
              placeholder="Search by name, email, firm, role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search investors"
              style={{
                ...inputStyle,
                paddingLeft: 36,
                fontSize: 14,
                padding: "11px 14px 11px 36px",
              }}
            />
          </div>
          {firmOptions.length > 0 && (
            <select
              value={firmFilter}
              onChange={(e) => setFirmFilter(e.target.value)}
              aria-label="Filter by firm"
              style={{ ...inputStyle, width: "auto", fontSize: 14, padding: "11px 14px" }}
            >
              <option value="">All firms</option>
              {firmOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort investors"
            style={{ ...inputStyle, width: "auto", fontSize: 14, padding: "11px 14px" }}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <span
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--vb-dim)",
              marginLeft: "auto",
            }}
          >
            {visible.length} / {investorList.length}
          </span>
        </div>
      )}

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
        {investorList && investorList.length > 0 && visible.length === 0 && (
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              color: "var(--vb-dim)",
              textAlign: "center",
              padding: "40px 0",
            }}
          >
            No investors match the current filters.
          </p>
        )}
        {visible.map((inv) => (
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
