"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/api";

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

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 14,
  color: "var(--vb-muted)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  marginBottom: 8,
};

const helperStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 11,
  color: "var(--vb-dim)",
  margin: "6px 0 0",
  lineHeight: 1.4,
};

const TOKEN_CHAINS = [
  "ethereum",
  "polygon",
  "arbitrum",
  "base",
  "optimism",
  "solana",
] as const;

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    website: "",
    description: "",
    tokenSymbol: "",
    githubOrg: "",
    teamSize: "",
    foundedDate: "",
    lastFundingRound: "",
    lastFundingAmount: "",
    tokenContract: "",
    tokenChain: "",
  });
  const [contextOpen, setContextOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (project) => router.push(`/projects/${project.id}`),
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const teamSize = form.teamSize ? parseInt(form.teamSize, 10) : undefined;
    const lastFundingAmount = form.lastFundingAmount
      ? Number(form.lastFundingAmount)
      : undefined;

    createProject.mutate({
      name: form.name,
      website: form.website || undefined,
      description: form.description || undefined,
      tokenSymbol: form.tokenSymbol || undefined,
      tokenContract: form.tokenContract || undefined,
      tokenChain: form.tokenChain || undefined,
      githubOrg: form.githubOrg || undefined,
      teamSize:
        Number.isFinite(teamSize) && (teamSize ?? 0) > 0 ? teamSize : undefined,
      foundedDate: form.foundedDate || undefined,
      lastFundingRound: form.lastFundingRound || undefined,
      lastFundingAmount:
        Number.isFinite(lastFundingAmount) && (lastFundingAmount ?? 0) > 0
          ? lastFundingAmount
          : undefined,
    });
  }

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
      ) => setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  return (
    <div style={{ padding: "24px 28px", minHeight: "100dvh" }}>
      <h2
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--vb-text)",
          margin: "0 0 20px",
          letterSpacing: "-0.02em",
        }}
      >
        New project
      </h2>

      {error && (
        <div
          style={{
            marginBottom: 20,
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 14,
            color: "#f87171",
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="vb-form-2col"
        style={{ gap: 20 }}
      >
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>
            Project name <span style={{ color: "#f87171" }}>*</span>
          </label>
          <input
            required
            placeholder="My Web3 Project"
            style={inputStyle}
            {...field("name")}
          />
        </div>
        <div>
          <label style={labelStyle}>Website</label>
          <input
            type="url"
            placeholder="https://example.com"
            style={inputStyle}
            {...field("website")}
          />
        </div>
        <div>
          <label style={labelStyle}>Token symbol</label>
          <input
            placeholder="ETH"
            style={inputStyle}
            {...field("tokenSymbol")}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Description</label>
          <textarea
            rows={4}
            placeholder="What does your project do?"
            style={{ ...inputStyle, resize: "vertical" }}
            {...field("description")}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>GitHub org</label>
          <input
            placeholder="my-org"
            style={inputStyle}
            {...field("githubOrg")}
          />
          <p style={helperStyle}>
            Pulls commits, PRs and active contributors into every monthly report.
          </p>
        </div>

        {/* Optional context — improves report quality */}
        <div style={{ gridColumn: "1 / -1", marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--vb-muted)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ transform: contextOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
            {contextOpen ? "Hide" : "Add"} project context (optional, used in reports)
          </button>
        </div>

        {contextOpen && (
          <>
            <div>
              <label style={labelStyle}>Team size</label>
              <input
                type="number"
                min="1"
                placeholder="8"
                style={inputStyle}
                {...field("teamSize")}
              />
              <p style={helperStyle}>e.g. 8 — used in the executive summary.</p>
            </div>
            <div>
              <label style={labelStyle}>Founded</label>
              <input
                type="date"
                style={inputStyle}
                {...field("foundedDate")}
              />
              <p style={helperStyle}>YYYY-MM-DD. Helps frame "we&apos;re N months in".</p>
            </div>
            <div>
              <label style={labelStyle}>Last funding round</label>
              <input
                placeholder="Series A"
                style={inputStyle}
                {...field("lastFundingRound")}
              />
              <p style={helperStyle}>e.g. Seed, Series A, Strategic.</p>
            </div>
            <div>
              <label style={labelStyle}>Amount raised (USD)</label>
              <input
                type="number"
                min="0"
                placeholder="5000000"
                style={inputStyle}
                {...field("lastFundingAmount")}
              />
              <p style={helperStyle}>Whole dollars. e.g. 5000000 → "$5.0M raised".</p>
            </div>
            <div>
              <label style={labelStyle}>Token contract</label>
              <input
                placeholder="0x..."
                style={inputStyle}
                {...field("tokenContract")}
              />
              <p style={helperStyle}>
                Pulls live price, market cap, and holder count via Dune Sim.
              </p>
            </div>
            <div>
              <label style={labelStyle}>Token chain</label>
              <select style={inputStyle} {...field("tokenChain")}>
                <option value="">Select chain…</option>
                {TOKEN_CHAINS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
              <p style={helperStyle}>Required if token contract is set.</p>
            </div>
          </>
        )}

        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => router.back()}
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid var(--vb-border)",
              borderRadius: 8,
              padding: "14px 24px",
              fontSize: 15,
              color: "var(--vb-muted)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createProject.isPending}
            style={{
              flex: 1,
              background: "#00e87b",
              color: "#0a0a0a",
              border: "none",
              borderRadius: 8,
              padding: "14px 24px",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              cursor: createProject.isPending ? "not-allowed" : "pointer",
              opacity: createProject.isPending ? 0.7 : 1,
            }}
          >
            {createProject.isPending ? "Creating..." : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
