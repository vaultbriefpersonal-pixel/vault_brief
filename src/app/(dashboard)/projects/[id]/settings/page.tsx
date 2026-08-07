"use client";

import { use, useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/api";
import { ReportTemplateEditor } from "@/components/settings/ReportTemplateEditor";
import { ProjectMembersPanel } from "@/components/settings/ProjectMembersPanel";
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

/**
 * A logo URL worth actually fetching.
 *
 * The preview `<img>` below renders straight off the input's value, so a
 * half-typed address is still a real `src` and still a real network request.
 * Paired with the debounce on the preview state, this is what stops typing one
 * URL from firing dozens of doomed requests, each one running the `onError`
 * handler that mutates DOM style during a render commit.
 */
function isFetchableUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

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
    snapshotSpace: "",
    externalDashboardUrl: "",
    foundedDate: "",
    lastFundingRound: "",
    lastFundingAmount: "",
    primaryColor: "#6366F1",
    logoUrl: "",
    discordWebhookUrl: "",
    telegramBotToken: "",
    telegramChatId: "",
  });
  const [saved, setSaved] = useState(false);

  /**
   * Whether the founder has edited anything since the last hydrate or save.
   *
   * A ref, not state: it must not trigger a render, and it must not become a
   * dependency of the hydrate effect below — reading live form state in that
   * effect is what would make it fight itself on every keystroke.
   */
  const dirtyRef = useRef(false);

  /**
   * The only way this page may change `form`. Routing every field through one
   * helper is what keeps `dirtyRef` honest: a per-call-site flag on eight
   * inputs is a flag that eventually gets forgotten on the ninth.
   */
  const patch: typeof setForm = (updater) => {
    dirtyRef.current = true;
    setForm(updater);
  };

  // The logo preview trails the input rather than tracking it, so a request
  // goes out once the founder stops typing instead of once per character.
  const [logoPreview, setLogoPreview] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setLogoPreview(form.logoUrl), 400);
    return () => clearTimeout(timer);
  }, [form.logoUrl]);

  useEffect(() => {
    // Hydrate from the server ONLY while the form is untouched.
    //
    // `providers.tsx` builds its QueryClient with no defaults, so staleTime is
    // 0 and refetchOnWindowFocus is on; superjson also hands back fresh `Date`
    // objects, which defeats react-query's structural sharing. Together that
    // means `project` gets a NEW object reference every time the tab regains
    // focus — not only when the data actually changed. Re-hydrating there
    // silently reverted whatever had been typed and not yet saved: alt-tab to
    // copy a dashboard URL, come back, the form is blank again.
    //
    // Once there are unsaved edits the server's copy is the stale one, so the
    // correct move is to leave the founder's work alone.
    if (dirtyRef.current) return;
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
        snapshotSpace:
          (project as { snapshotSpace?: string | null }).snapshotSpace ?? "",
        externalDashboardUrl:
          (project as { externalDashboardUrl?: string | null })
            .externalDashboardUrl ?? "",
        foundedDate: project.foundedDate ?? "",
        lastFundingRound: project.lastFundingRound ?? "",
        lastFundingAmount: project.lastFundingAmount?.toString() ?? "",
        primaryColor: branding?.primaryColor ?? "#6366F1",
        logoUrl: branding?.logoUrl ?? "",
        discordWebhookUrl:
          (project as { discordWebhookUrl?: string | null })
            .discordWebhookUrl ?? "",
        telegramBotToken:
          (project as { telegramBotToken?: string | null })
            .telegramBotToken ?? "",
        telegramChatId:
          (project as { telegramChatId?: string | null }).telegramChatId ??
          "",
      });
    }
  }, [project]);

  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      // Saved means the form and the server agree again, so later refetches
      // may hydrate freely. Without this a founder who saves once would never
      // see a change made from another tab or by a teammate.
      dirtyRef.current = false;
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
      snapshotSpace: form.snapshotSpace.trim() || null,
      // Blank clears the column, which silences the Live Dashboard section
      // rather than rendering an empty pointer. The router validates it as a
      // real URL, so a half-typed value is rejected at submit instead of
      // reaching a reader as a dead link.
      externalDashboardUrl: form.externalDashboardUrl.trim() || null,
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
      discordWebhookUrl: form.discordWebhookUrl.trim() || null,
      telegramBotToken: form.telegramBotToken.trim() || null,
      telegramChatId: form.telegramChatId.trim() || null,
    });
  }

  const FIELDS = [
    ["name", "Project name", "text", true],
    ["website", "Website", "url", false],
    ["description", "Description", "text", false],
    ["tokenSymbol", "Token symbol", "text", false],
    ["githubOrg", "GitHub org", "text", false],
    ["snapshotSpace", "Snapshot space (e.g. ens.eth)", "text", false],
    [
      "externalDashboardUrl",
      "Live dashboard URL (Dune, Flipside, …)",
      "url",
      false,
    ],
    ["foundedDate", "Founded date", "date", false],
    ["lastFundingRound", "Last funding round", "text", false],
    ["lastFundingAmount", "Last funding amount (USD)", "number", false],
  ] as const;

  return (
    <>
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
                  patch((f) => ({ ...f, [key]: e.target.value }))
                }
              />
            ) : (
              <input
                type={type}
                required={required}
                style={inputStyle}
                value={form[key]}
                onChange={(e) =>
                  patch((f) => ({ ...f, [key]: e.target.value }))
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
                patch((f) => ({ ...f, primaryColor: e.target.value }))
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
                patch((f) => ({ ...f, primaryColor: e.target.value }))
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
              patch((f) => ({ ...f, logoUrl: e.target.value }))
            }
            style={inputStyle}
          />
          {/* Live preview pill — confirms the URL resolves before save. */}
          {isFetchableUrl(logoPreview) && (
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
                // `key` on the src so a corrected URL gets a FRESH element.
                // The onError below hides the node by mutating its style, and
                // a hidden node stays hidden however many times `src` changes
                // — without this, one typo left the preview blank until reload.
                key={logoPreview}
                src={logoPreview}
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

        {/* Chat notifications. Additive alongside investor email — posts a
            "new report available" ping to a team Discord channel and/or
            Telegram chat when a report is sent. Leave blank to skip either
            or both; email delivery is unaffected either way. */}
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
            Chat notifications
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
            Optional — ping a team Discord channel and/or Telegram chat when
            a report is sent to investors. Additive alongside email; leave
            blank to skip.
          </p>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Discord webhook URL</label>
          <input
            type="url"
            placeholder="https://discord.com/api/webhooks/..."
            value={form.discordWebhookUrl}
            onChange={(e) =>
              patch((f) => ({ ...f, discordWebhookUrl: e.target.value }))
            }
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Telegram bot token</label>
          <input
            type="text"
            placeholder="123456:ABC-DEF..."
            value={form.telegramBotToken}
            onChange={(e) =>
              patch((f) => ({ ...f, telegramBotToken: e.target.value }))
            }
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Telegram chat ID</label>
          <input
            type="text"
            placeholder="-1001234567890"
            value={form.telegramChatId}
            onChange={(e) =>
              patch((f) => ({ ...f, telegramChatId: e.target.value }))
            }
            style={inputStyle}
          />
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

      {/* Outside the form on purpose — its own buttons/mutations, not tied
          to the metadata form's submit/save cycle. */}
      <ProjectMembersPanel projectId={id} />
    </>
  );
}
