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

type WalletChain = (typeof TOKEN_CHAINS)[number];

interface WalletRow {
  address: string;
  chain: WalletChain;
  label: string;
}

const EMPTY_WALLET: WalletRow = { address: "", chain: "ethereum", label: "" };

export default function NewProjectPage() {
  const router = useRouter();
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
  const [contextOpen, setContextOpen] = useState(false);
  const [walletRows, setWalletRows] = useState<WalletRow[]>([{ ...EMPTY_WALLET }]);
  const [error, setError] = useState<string | null>(null);
  const [autofillNote, setAutofillNote] = useState<string | null>(null);
  // Tracks which form fields were just populated by autofill so we can
  // briefly flash them green. Cleared after 2.5s — long enough to notice,
  // short enough that it doesn't linger when the user starts editing.
  const [prefilled, setPrefilled] = useState<Set<string>>(new Set());

  // Pulls metadata from CoinGecko by token contract. Only fills *empty*
  // fields so we never clobber what the user already typed. Failures are
  // surfaced as a soft note, not a blocking error — manual entry still works.
  const autofill = trpc.projects.autofillFromContract.useMutation({
    onSuccess: (data) => {
      if (!data) {
        setAutofillNote(
          "We couldn't find this contract on CoinGecko. Fill the fields below manually."
        );
        return;
      }
      const filled: string[] = [];
      setForm((f) => {
        const next = { ...f };
        const set = <K extends keyof typeof f>(key: K, value: string | undefined) => {
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
      // Auto-expand the optional context block so the user can see what
      // landed in `description` / `foundedDate` etc.
      if (filled.length > 0) setContextOpen(true);
      setAutofillNote(
        filled.length === 0
          ? "Found on CoinGecko, but every relevant field was already filled."
          : `Prefilled from CoinGecko: ${filled.join(", ")}.`
      );
      if (filled.length > 0) {
        setPrefilled(new Set(filled));
        // Auto-clear so the highlight doesn't stick once the user
        // navigates away and comes back.
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

  // Land on /wallets, not the empty dashboard. Without at least one wallet
  // the dashboard shows all-zeros and users get confused (no field on this
  // form makes "treasury wallet" obvious — see UX backlog #wallet-step).
  const createProject = trpc.projects.create.useMutation({
    onSuccess: (project) => router.push(`/projects/${project.id}/wallets?onboarding=1`),
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const lastFundingAmount = form.lastFundingAmount
      ? Number(form.lastFundingAmount)
      : undefined;

    // Strip empty rows; user gets one default row but isn't forced to fill it.
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
    setWalletRows((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== index)));
  }

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
      ) => setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  // Adds a soft accent border + bg flash to inputs that autofill just
  // populated. Inputs are inline-styled, so we merge an override style.
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

      {/* Discovery hint — autofill UI lives behind the collapsed
          "Add project context" toggle below; without this banner most users
          finish the form by hand and never find the prefill. */}
      <div
        style={{
          marginBottom: 20,
          background: "rgba(0,232,123,0.08)",
          border: "1px solid rgba(0,232,123,0.25)",
          borderRadius: 8,
          padding: "12px 16px",
          fontSize: 13,
          color: "var(--vb-muted)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: "var(--vb-text)", fontWeight: 600 }}>
          Have a token contract?
        </strong>{" "}
        Open <em>Add project context</em> below, paste the contract + chain,
        and click <em>Autofill from CoinGecko</em> — we&apos;ll prefill
        description, website, GitHub org, and token symbol.
      </div>

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
          <label style={labelStyle}>Token symbol</label>
          <input
            placeholder="ETH"
            style={styleFor("tokenSymbol")}
            {...field("tokenSymbol")}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Description</label>
          <textarea
            rows={4}
            placeholder="What does your project do?"
            style={{ ...styleFor("description"), resize: "vertical" }}
            {...field("description")}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>GitHub org</label>
          <input
            placeholder="my-org"
            style={styleFor("githubOrg")}
            {...field("githubOrg")}
          />
          <p style={helperStyle}>
            Pulls commits, PRs and active contributors into every monthly report.
          </p>
        </div>

        {/* Treasury wallets — primary onboarding input. Without at least one
            of these the dashboard is empty and the first sync produces a
            zeros-everywhere report. We default to one empty row to make the
            field visually obvious without forcing a wallet. */}
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>
            Treasury wallets{" "}
            <span style={{ color: "var(--vb-dim)", fontWeight: 400 }}>
              — multisig, EOA, or exchange address
            </span>
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
                    updateWallet(i, { chain: e.target.value as WalletChain })
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
                  onChange={(e) => updateWallet(i, { label: e.target.value })}
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
            Don&apos;t paste a token contract here — those go in &ldquo;Token
            contract&rdquo; under project context. We pull balances, inflows
            and outflows from each wallet you add.
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
            {/* Token contract + chain go first — they're the autofill
                primer. Layout reads top-down: paste token, hit autofill,
                fill the remaining bits manually. Founded sits with Amount
                so each row stays balanced after team_size came out. */}
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
            {/* Autofill via CoinGecko — pulls description, website, GitHub
                org, founded date, and token symbol from a single contract
                lookup. Only fills empty fields, never overwrites. */}
            <div style={{ gridColumn: "1 / -1" }}>
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
                {autofill.isPending ? "Looking up…" : "Autofill from CoinGecko"}
              </button>
              {autofillNote && (
                <p
                  style={{
                    ...helperStyle,
                    marginTop: 10,
                    color: autofill.isError
                      ? "#f87171"
                      : "var(--vb-muted)",
                  }}
                >
                  {autofillNote}
                </p>
              )}
            </div>

            {/* Founded + funding context — not pulled by autofill (CG
                doesn't expose funding rounds). Pair Founded with Amount,
                give Last funding round its own full-width row to balance. */}
            <div>
              <label style={labelStyle}>Founded</label>
              <input
                type="date"
                style={styleFor("foundedDate")}
                {...field("foundedDate")}
              />
              <p style={helperStyle}>YYYY-MM-DD. Helps frame &quot;we&apos;re N months in&quot;.</p>
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
              <p style={helperStyle}>Whole dollars. e.g. 5000000 → &quot;$5.0M raised&quot;.</p>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Last funding round</label>
              <input
                placeholder="Series A"
                style={inputStyle}
                {...field("lastFundingRound")}
              />
              <p style={helperStyle}>e.g. Seed, Series A, Strategic.</p>
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
