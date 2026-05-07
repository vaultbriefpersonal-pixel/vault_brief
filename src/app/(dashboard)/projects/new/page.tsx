"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/api";
import { Wallet, Code, FileText, Check } from "lucide-react";

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

type WalletChain = (typeof TOKEN_CHAINS)[number];

interface WalletRow {
  address: string;
  chain: WalletChain;
  label: string;
}

const EMPTY_WALLET: WalletRow = { address: "", chain: "ethereum", label: "" };

// Step metadata. Order is fixed; the index is used as the navigation key.
// Each step renders inside the same container so progress indicator and
// nav buttons stay consistent.
const STEPS = [
  {
    key: "basics",
    title: "Project basics",
    sub: "Name, website, and a one-line description.",
    icon: FileText,
  },
  {
    key: "wallet",
    title: "Treasury wallet",
    sub: "The primary input — at least one address powers every report.",
    icon: Wallet,
  },
  {
    key: "optional",
    title: "Optional data sources",
    sub: "GitHub and token contract are optional but make reports much richer.",
    icon: Code,
  },
  {
    key: "review",
    title: "Generate report",
    sub: "Summary of what you connected. We'll create the project and route you to your first report.",
    icon: Check,
  },
] as const;

export default function NewProjectWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [form, setForm] = useState({
    name: "",
    website: "",
    description: "",
    tokenSymbol: "",
    githubOrg: "",
    foundedDate: "",
    lastFundingRound: "",
    lastFundingAmount: "",
    tokenContract: "",
    tokenChain: "",
  });
  const [walletRows, setWalletRows] = useState<WalletRow[]>([{ ...EMPTY_WALLET }]);
  const [error, setError] = useState<string | null>(null);
  const [autofillNote, setAutofillNote] = useState<string | null>(null);
  // Inputs autofill just populated flash green for 2.5s so the user
  // notices the prefill without scrolling between steps.
  const [prefilled, setPrefilled] = useState<Set<string>>(new Set());

  const autofill = trpc.projects.autofillFromContract.useMutation({
    onSuccess: (data) => {
      if (!data) {
        setAutofillNote(
          "We couldn't find this token on CoinGecko. Fill the fields manually."
        );
        return;
      }
      const filled: string[] = [];
      setForm((f) => {
        const next = { ...f };
        const set = <K extends keyof typeof f>(
          key: K,
          value: string | undefined
        ) => {
          if (value && !f[key]) {
            next[key] = value as (typeof f)[K];
            filled.push(key);
          }
        };
        set("description", data.description);
        set("website", data.website);
        set("githubOrg", data.githubOrg);
        set("tokenSymbol", data.symbol);
        set("foundedDate", data.foundedDate);
        if (!f.name && data.name) {
          next.name = data.name;
          filled.push("name");
        }
        return next;
      });
      setAutofillNote(
        filled.length === 0
          ? "Found on CoinGecko, but every relevant field was already filled."
          : `Prefilled from CoinGecko: ${filled.join(", ")}.`
      );
      if (filled.length > 0) {
        setPrefilled(new Set(filled));
        setTimeout(() => setPrefilled(new Set()), 2500);
      }
    },
    onError: (e) => setAutofillNote(e.message),
  });

  function handleAutofill() {
    setAutofillNote(null);
    if (!form.tokenContract.trim() || !form.tokenChain) {
      setAutofillNote("Enter token contract and chain first.");
      return;
    }
    autofill.mutate({
      chain: form.tokenChain,
      contract: form.tokenContract.trim(),
    });
  }

  // Land on /reports?onboarding=1 — investors and the founder both expect
  // the next thing to look at after creating a project to be the report,
  // not a wallets management screen. The reports list will read the flag
  // and show a "Generate first report" empty state.
  const createProject = trpc.projects.create.useMutation({
    onSuccess: (project) =>
      router.push(`/projects/${project.id}/reports?onboarding=1`),
    onError: (e) => setError(e.message),
  });

  const validWalletCount = walletRows.filter(
    (w) => w.address.trim().length > 0
  ).length;

  function handleSubmit() {
    setError(null);

    const lastFundingAmount = form.lastFundingAmount
      ? Number(form.lastFundingAmount)
      : undefined;

    const initialWallets = walletRows
      .map((w) => ({
        address: w.address.trim(),
        chain: w.chain,
        label: w.label.trim() || undefined,
      }))
      .filter((w) => w.address.length > 0);

    createProject.mutate({
      name: form.name,
      website: form.website || undefined,
      description: form.description || undefined,
      tokenSymbol: form.tokenSymbol || undefined,
      tokenContract: form.tokenContract || undefined,
      tokenChain: form.tokenChain || undefined,
      githubOrg: form.githubOrg || undefined,
      foundedDate: form.foundedDate || undefined,
      lastFundingRound: form.lastFundingRound || undefined,
      lastFundingAmount:
        Number.isFinite(lastFundingAmount) && (lastFundingAmount ?? 0) > 0
          ? lastFundingAmount
          : undefined,
      initialWallets: initialWallets.length > 0 ? initialWallets : undefined,
    });
  }

  function updateWallet(index: number, patch: Partial<WalletRow>) {
    setWalletRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r))
    );
  }
  function addWalletRow() {
    setWalletRows((rows) => [...rows, { ...EMPTY_WALLET }]);
  }
  function removeWalletRow(index: number) {
    setWalletRows((rows) =>
      rows.length === 1 ? rows : rows.filter((_, i) => i !== index)
    );
  }

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (
        e: React.ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >
      ) => setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  function styleFor(key: keyof typeof form): React.CSSProperties {
    return prefilled.has(key)
      ? {
          ...inputStyle,
          borderColor: "rgba(0,232,123,0.55)",
          background: "rgba(0,232,123,0.08)",
          transition: "background 0.4s, border-color 0.4s",
        }
      : { ...inputStyle, transition: "background 0.4s, border-color 0.4s" };
  }

  // Per-step "can we move forward" predicate. Wallet step is the only one
  // that gates progress (project basics is collected as required + step 0
  // already enforces non-empty name; step 2 is fully optional; step 3 is
  // submit-only).
  function canAdvance(): boolean {
    if (step === 0) return form.name.trim().length > 0;
    if (step === 1) return validWalletCount > 0;
    return true;
  }

  return (
    <div style={{ padding: "24px 28px", minHeight: "100dvh", maxWidth: 760, margin: "0 auto" }}>
      <h2
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 22,
          fontWeight: 700,
          color: "var(--vb-text)",
          margin: "0 0 20px",
          letterSpacing: "-0.02em",
        }}
      >
        New project
      </h2>

      <StepRail current={step} />

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

      <div
        style={{
          background: "var(--vb-card)",
          border: "1px solid var(--vb-border)",
          borderRadius: 14,
          padding: "28px",
          marginBottom: 20,
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 11,
              color: "var(--accent)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 600,
              margin: "0 0 6px",
            }}
          >
            Step {step + 1} of {STEPS.length}
          </p>
          <h3
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: "0 0 6px",
              letterSpacing: "-0.01em",
            }}
          >
            {STEPS[step].title}
          </h3>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              color: "var(--vb-muted)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {STEPS[step].sub}
          </p>
        </div>

        {step === 0 && (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <label style={labelStyle}>
                Project name <span style={{ color: "#f87171" }}>*</span>
              </label>
              <input
                required
                placeholder="My Web3 Project"
                style={styleFor("name")}
                {...field("name")}
              />
            </div>
            <div>
              <label style={labelStyle}>Website</label>
              <input
                type="url"
                placeholder="https://example.com"
                style={styleFor("website")}
                {...field("website")}
              />
            </div>
            <div>
              <label style={labelStyle}>Short description</label>
              <textarea
                rows={3}
                placeholder="What does your project do?"
                style={{ ...styleFor("description"), resize: "vertical" }}
                {...field("description")}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: "grid", gap: 16 }}>
            {/* Wallet step is the most important — visual treatment makes
                the input cards stand out and the helper copy spells out
                "wallet, not a token contract" so users can't conflate
                them. */}
            <div
              style={{
                background: "rgba(0,232,123,0.06)",
                border: "1px solid rgba(0,232,123,0.2)",
                borderRadius: 10,
                padding: "12px 14px",
                fontSize: 13,
                color: "var(--vb-muted)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: "var(--vb-text)", fontWeight: 600 }}>
                What goes here:
              </strong>{" "}
              your treasury address — multisig, EOA, or exchange wallet that
              holds the project funds. <strong>Not</strong> a token contract.
              We pull balances, inflows, and outflows from each wallet.
            </div>
            <label style={labelStyle}>
              Treasury wallets{" "}
              <span style={{ color: "#f87171" }}>*</span>
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {walletRows.map((row, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 1fr 160px 36px",
                    gap: 8,
                    alignItems: "stretch",
                  }}
                >
                  <select
                    value={row.chain}
                    onChange={(e) =>
                      updateWallet(i, {
                        chain: e.target.value as WalletChain,
                      })
                    }
                    style={inputStyle}
                    aria-label="Wallet chain"
                  >
                    {TOKEN_CHAINS.map((c) => (
                      <option key={c} value={c}>
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="0x… or Solana base58"
                    value={row.address}
                    onChange={(e) =>
                      updateWallet(i, { address: e.target.value })
                    }
                    style={inputStyle}
                    spellCheck={false}
                    aria-label="Wallet address"
                  />
                  <input
                    placeholder="Label (optional)"
                    value={row.label}
                    onChange={(e) =>
                      updateWallet(i, { label: e.target.value })
                    }
                    style={inputStyle}
                    aria-label="Wallet label"
                  />
                  <button
                    type="button"
                    onClick={() => removeWalletRow(i)}
                    disabled={walletRows.length === 1}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--vb-border)",
                      borderRadius: 8,
                      color: "var(--vb-dim)",
                      cursor:
                        walletRows.length === 1 ? "not-allowed" : "pointer",
                      fontSize: 18,
                      lineHeight: 1,
                      opacity: walletRows.length === 1 ? 0.4 : 1,
                    }}
                    aria-label="Remove wallet row"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addWalletRow}
                style={{
                  alignSelf: "flex-start",
                  background: "transparent",
                  border: "1px dashed var(--vb-border)",
                  borderRadius: 8,
                  padding: "8px 14px",
                  fontSize: 13,
                  color: "var(--vb-muted)",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  cursor: "pointer",
                }}
              >
                + Add another wallet
              </button>
            </div>
            <p style={helperStyle}>
              Add as many wallets as you need. Each address counts as one
              wallet against your plan limit.
            </p>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <label style={labelStyle}>GitHub org</label>
              <input
                placeholder="my-org"
                style={styleFor("githubOrg")}
                {...field("githubOrg")}
              />
              <p style={helperStyle}>
                Pulls commits, PRs, and active contributors into every monthly
                report.
              </p>
            </div>
            <div
              className="vb-form-2col"
              style={{ gap: 16 }}
            >
              <div>
                <label style={labelStyle}>Token contract</label>
                <input
                  placeholder="0x..."
                  style={inputStyle}
                  {...field("tokenContract")}
                />
                <p style={helperStyle}>
                  Distinct from a treasury wallet — this is the token your
                  project issued.
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
            </div>
            <div>
              <button
                type="button"
                onClick={handleAutofill}
                disabled={
                  autofill.isPending ||
                  !form.tokenContract.trim() ||
                  !form.tokenChain
                }
                style={{
                  background: "rgba(0,232,123,0.1)",
                  border: "1px solid rgba(0,232,123,0.4)",
                  borderRadius: 8,
                  padding: "10px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#00e87b",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  cursor:
                    autofill.isPending ||
                    !form.tokenContract.trim() ||
                    !form.tokenChain
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    autofill.isPending ||
                    !form.tokenContract.trim() ||
                    !form.tokenChain
                      ? 0.5
                      : 1,
                }}
              >
                {autofill.isPending
                  ? "Looking up…"
                  : "Autofill from CoinGecko"}
              </button>
              {autofillNote && (
                <p
                  style={{
                    ...helperStyle,
                    marginTop: 10,
                    color: autofill.isError ? "#f87171" : "var(--vb-muted)",
                  }}
                >
                  {autofillNote}
                </p>
              )}
            </div>
            <p
              style={{
                ...helperStyle,
                marginTop: 4,
              }}
            >
              All fields here are optional — skip and generate your first
              report from treasury data alone.
            </p>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: "grid", gap: 14 }}>
            {/* Read-only summary so the user sees exactly what we're about
                to register before clicking submit. */}
            <SummaryRow label="Project" value={form.name || "—"} primary />
            {form.website && (
              <SummaryRow label="Website" value={form.website} />
            )}
            <SummaryRow
              label="Treasury wallets"
              value={
                walletRows
                  .filter((w) => w.address.trim())
                  .map((w) => `${w.chain} · ${truncate(w.address.trim())}`)
                  .join(" · ") || "—"
              }
              primary
            />
            {form.githubOrg && (
              <SummaryRow label="GitHub org" value={form.githubOrg} />
            )}
            {form.tokenContract && (
              <SummaryRow
                label="Token"
                value={`${form.tokenSymbol || "?"} on ${form.tokenChain || "?"} · ${truncate(form.tokenContract)}`}
              />
            )}
            <p
              style={{
                ...helperStyle,
                marginTop: 8,
                lineHeight: 1.6,
              }}
            >
              We&apos;ll create the project, sync the wallets, and route you
              to your reports page so you can generate your first investor
              report.
            </p>
          </div>
        )}
      </div>

      {/* Wizard navigation */}
      <div
        style={{
          display: "flex",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <button
          type="button"
          onClick={() => (step === 0 ? router.back() : setStep((s) => s - 1))}
          style={{
            background: "transparent",
            border: "1px solid var(--vb-border)",
            borderRadius: 8,
            padding: "12px 24px",
            fontSize: 14,
            color: "var(--vb-muted)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          {step === 0 ? "Cancel" : "Back"}
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            disabled={!canAdvance()}
            onClick={() => setStep((s) => s + 1)}
            style={{
              background: canAdvance() ? "#00e87b" : "rgba(0,232,123,0.3)",
              color: "#0a0a0a",
              border: "none",
              borderRadius: 8,
              padding: "12px 28px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              cursor: canAdvance() ? "pointer" : "not-allowed",
            }}
            aria-label="Continue to next step"
          >
            Continue →
          </button>
        ) : (
          <button
            type="button"
            disabled={createProject.isPending}
            onClick={handleSubmit}
            style={{
              background: "#00e87b",
              color: "#0a0a0a",
              border: "none",
              borderRadius: 8,
              padding: "12px 28px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              cursor: createProject.isPending ? "not-allowed" : "pointer",
              opacity: createProject.isPending ? 0.7 : 1,
            }}
          >
            {createProject.isPending
              ? "Creating project…"
              : "Generate Investor Report"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function StepRail({ current }: { current: number }) {
  return (
    <ol
      aria-label="Onboarding progress"
      style={{
        listStyle: "none",
        padding: 0,
        margin: "0 0 24px",
        display: "grid",
        gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`,
        gap: 8,
      }}
    >
      {STEPS.map((s, i) => {
        const status =
          i < current ? "done" : i === current ? "active" : "pending";
        const Icon = s.icon;
        return (
          <li
            key={s.key}
            aria-current={status === "active" ? "step" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 10,
              background:
                status === "active"
                  ? "rgba(0,232,123,0.08)"
                  : "var(--vb-alt)",
              border: `1px solid ${
                status === "active"
                  ? "rgba(0,232,123,0.4)"
                  : "var(--vb-border)"
              }`,
              opacity: status === "pending" ? 0.6 : 1,
              transition: "all 0.25s",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  status === "done"
                    ? "var(--accent)"
                    : status === "active"
                      ? "rgba(0,232,123,0.2)"
                      : "rgba(255,255,255,0.04)",
                color:
                  status === "done"
                    ? "#0a0a0a"
                    : status === "active"
                      ? "var(--accent)"
                      : "var(--vb-dim)",
                flexShrink: 0,
              }}
            >
              {status === "done" ? <Check size={14} /> : <Icon size={14} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 11,
                  color: "var(--vb-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 600,
                }}
              >
                Step {i + 1}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color:
                    status === "pending" ? "var(--vb-muted)" : "var(--vb-text)",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.title}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SummaryRow({
  label,
  value,
  primary,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: "12px 14px",
        background: primary ? "rgba(0,232,123,0.06)" : "var(--vb-alt)",
        border: `1px solid ${primary ? "rgba(0,232,123,0.2)" : "var(--vb-border)"}`,
        borderRadius: 10,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 12,
          color: "var(--vb-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          fontWeight: 600,
          minWidth: 130,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 14,
          color: "var(--vb-text)",
          fontWeight: 500,
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function truncate(s: string): string {
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
