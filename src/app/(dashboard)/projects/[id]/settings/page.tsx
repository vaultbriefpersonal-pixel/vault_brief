"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/api";

interface Props {
  params: Promise<{ id: string }>;
}

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

export default function ProjectSettingsPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { data: project } = trpc.projects.getById.useQuery({ id });
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
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (project) {
      setForm({
        name: project.name,
        website: project.website ?? "",
        description: project.description ?? "",
        tokenSymbol: project.tokenSymbol ?? "",
        githubOrg: project.githubOrg ?? "",
        teamSize: project.teamSize?.toString() ?? "",
        foundedDate: project.foundedDate ?? "",
        lastFundingRound: project.lastFundingRound ?? "",
        lastFundingAmount: project.lastFundingAmount?.toString() ?? "",
      });
    }
  }, [project]);

  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => router.push("/projects"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({
      id,
      name: form.name,
      website: form.website || null,
      description: form.description || null,
      tokenSymbol: form.tokenSymbol || null,
      githubOrg: form.githubOrg || null,
      teamSize: form.teamSize ? parseInt(form.teamSize) : null,
      foundedDate: form.foundedDate || null,
      lastFundingRound: form.lastFundingRound || null,
      lastFundingAmount: form.lastFundingAmount
        ? parseFloat(form.lastFundingAmount)
        : null,
    });
  }

  const FIELDS = [
    ["name", "Project name", "text", true],
    ["website", "Website", "url", false],
    ["description", "Description", "text", false],
    ["tokenSymbol", "Token symbol", "text", false],
    ["githubOrg", "GitHub org", "text", false],
    ["teamSize", "Team size", "number", false],
    ["foundedDate", "Founded date", "date", false],
    ["lastFundingRound", "Last funding round", "text", false],
    ["lastFundingAmount", "Last funding amount (USD)", "number", false],
  ] as const;

  return (
    <div style={{ padding: "24px 28px", minHeight: "100vh" }}>
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
        Project settings
      </h2>

      <form
        onSubmit={handleSubmit}
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 40 }}
      >
        {FIELDS.map(([key, label, type, required]) => (
          <div
            key={key}
            style={
              key === "name" || key === "description"
                ? { gridColumn: "1 / -1" }
                : undefined
            }
          >
            <label style={labelStyle}>
              {label}
              {required && (
                <span style={{ color: "#f87171", marginLeft: 4 }}>*</span>
              )}
            </label>
            {key === "description" ? (
              <textarea
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
                value={form[key]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [key]: e.target.value }))
                }
              />
            ) : (
              <input
                type={type}
                required={required}
                style={inputStyle}
                value={form[key]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [key]: e.target.value }))
                }
              />
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={update.isPending}
          style={{
            gridColumn: "1 / -1",
            width: "100%",
            background: saved ? "rgba(0,232,123,0.15)" : "#00e87b",
            color: saved ? "#00e87b" : "#0a0a0a",
            border: saved ? "1px solid rgba(0,232,123,0.3)" : "none",
            borderRadius: 8,
            padding: "14px 24px",
            fontSize: 15,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor: update.isPending ? "not-allowed" : "pointer",
            opacity: update.isPending ? 0.7 : 1,
            transition: "background 0.3s, color 0.3s",
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
          Deleting this project will remove all wallets, snapshots, and reports
          permanently.
        </p>
        <button
          onClick={() => {
            if (window.confirm("Delete this project? This cannot be undone.")) {
              deleteProject.mutate({ id });
            }
          }}
          disabled={deleteProject.isPending}
          style={{
            background: "transparent",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 13,
            color: "#f87171",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor: deleteProject.isPending ? "not-allowed" : "pointer",
            opacity: deleteProject.isPending ? 0.6 : 1,
          }}
        >
          {deleteProject.isPending ? "Deleting..." : "Delete project"}
        </button>
      </div>
    </div>
  );
}
