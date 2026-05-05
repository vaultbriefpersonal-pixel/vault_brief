"use client";

import { use, useState, useEffect } from "react";
import { trpc } from "@/lib/api";
import { ReportTemplateEditor } from "@/components/settings/ReportTemplateEditor";
import type { SectionConfigEntry } from "@/server/services/report-sections";

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

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 14,
  color: "var(--vb-muted)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  marginBottom: 8,
};

export default function ProjectSettingsPage({ params }: Props) {
  const { id } = use(params);
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
    primaryColor: "#6366F1",
    logoUrl: "",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (project) {
      // customBranding is optional JSONB — pull primaryColor/logoUrl out
      // defensively. Older projects (created before branding existed) just
      // get the default accent.
      const branding = (project.customBranding as {
        primaryColor?: string;
        logoUrl?: string;
      } | null) ?? null;
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
        primaryColor: branding?.primaryColor ?? "#6366F1",
        logoUrl: branding?.logoUrl ?? "",
      });
    }
  }, [project]);

  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Branding: only send when at least one field changed from the default.
    // null clears the row → no styles → falls back to Vault Brief default.
    const hasBrand =
      form.primaryColor.toLowerCase() !== "#6366f1" || form.logoUrl.trim();
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
      customBranding: hasBrand
        ? {
            primaryColor: form.primaryColor,
            logoUrl: form.logoUrl.trim(),
          }
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
    <div style={{ padding: "24px 28px", minHeight: "100dvh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          margin: "0 0 20px",
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: 18,
            fontWeight: 700,
            color: "var(--vb-text)",
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          Project settings
        </h2>
      </div>

      <form
        onSubmit={handleSubmit}
        className="vb-form-2col"
        style={{ gap: 20, marginBottom: 40 }}
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

        {/* Branding sub-section. Saved into projects.customBranding (JSONB),
            consumed by the PDF template (header logo + accent dots) and the
            investor email shell (header background + CTA + accent border). */}
        <div style={{ gridColumn: "1 / -1", marginTop: 8 }}>
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
            Branding
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
            These flow into the investor PDF (header logo + accent color) and
            the email your investors receive.
          </p>
        </div>
        <div>
          <label style={labelStyle}>Brand color</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="color"
              value={form.primaryColor}
              onChange={(e) =>
                setForm((f) => ({ ...f, primaryColor: e.target.value }))
              }
              aria-label="Pick brand color"
              style={{
                width: 48,
                height: 44,
                border: "1px solid var(--vb-border)",
                borderRadius: 8,
                background: "transparent",
                cursor: "pointer",
                padding: 4,
              }}
            />
            <input
              type="text"
              value={form.primaryColor}
              onChange={(e) =>
                setForm((f) => ({ ...f, primaryColor: e.target.value }))
              }
              placeholder="#6366F1"
              maxLength={7}
              style={{ ...inputStyle, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase" }}
              aria-label="Brand color hex"
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Logo URL</label>
          <input
            type="url"
            placeholder="https://yoursite.com/logo.png"
            value={form.logoUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, logoUrl: e.target.value }))
            }
            style={inputStyle}
          />
          {/* Live preview pill — confirms the URL resolves before save. */}
          {form.logoUrl && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 10px",
                background: "var(--vb-alt)",
                border: "1px solid var(--vb-border)",
                borderRadius: 6,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                maxWidth: "100%",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.logoUrl}
                alt="Logo preview"
                style={{ maxHeight: 28, maxWidth: 120, objectFit: "contain" }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 11,
                  color: "var(--vb-dim)",
                }}
              >
                Preview
              </span>
            </div>
          )}
        </div>

        {/* Report-template constructor. Self-contained — owns its own
            state + save mutation, doesn't share with the metadata form
            above. Saving here only writes `reportSections`, leaving every
            other field untouched. */}
        {project && (
          <ReportTemplateEditor
            projectId={id}
            initial={
              (project.reportSections as SectionConfigEntry[] | null) ?? null
            }
          />
        )}

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
    </div>
  );
}
