"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/api";

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#111111",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  padding: "13px 16px",
  fontSize: 15,
  color: "#f0f0f0",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 14,
  color: "#888888",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  marginBottom: 8,
};

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    website: "",
    description: "",
    tokenSymbol: "",
    githubOrg: "",
  });
  const [error, setError] = useState<string | null>(null);

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (project) => router.push(`/projects/${project.id}`),
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    createProject.mutate({
      name: form.name,
      website: form.website || undefined,
      description: form.description || undefined,
      tokenSymbol: form.tokenSymbol || undefined,
      githubOrg: form.githubOrg || undefined,
    });
  }

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
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
          color: "#f0f0f0",
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
        </div>

        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => router.back()}
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: "14px 24px",
              fontSize: 15,
              color: "#888888",
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
