"use client";

import { useState } from "react";
import { use } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/api";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { ChainIcon } from "@/components/ui/ChainIcon";
import { formatUsd } from "@/lib/utils";
import type { WalletBalanceView } from "@/server/services/wallet-balances";

const CHAINS = [
  { value: "ethereum", label: "Ethereum" },
  { value: "polygon", label: "Polygon" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "base", label: "Base" },
  { value: "optimism", label: "Optimism" },
  { value: "solana", label: "Solana" },
] as const;

type Chain = (typeof CHAINS)[number]["value"];

interface Props {
  params: Promise<{ id: string }>;
}

const inputStyle: React.CSSProperties = {
  background: "var(--vb-alt)",
  border: "1px solid var(--vb-border)",
  borderRadius: 8,
  padding: "13px 16px",
  fontSize: 15,
  color: "var(--vb-text)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  outline: "none",
};

/**
 * The secondary line under a wallet's figure.
 *
 * Every branch that returns a non-null caption is a case where the number
 * above it must NOT be read as a plain treasury total — either nothing was
 * measured, or what was measured is a floor. A wallet that genuinely holds
 * nothing gets no caption at all: `$0.00` is the complete and correct answer
 * there, and dressing it up would blur the one distinction this page exists
 * to make.
 */
function balanceCaption(b: WalletBalanceView): string | null {
  switch (b.state) {
    case "neverSynced":
      return "not synced yet";
    case "failed":
      return "not read in the last sync";
    case "notInSnapshot":
      return "added since the last sync";
    case "truncated":
      return "a floor — the read hit the page cap";
    case "synced":
      return b.unpricedCount && b.unpricedCount > 0
        ? `a floor — ${b.unpricedCount} holding${b.unpricedCount === 1 ? "" : "s"} unpriced`
        : null;
  }
}

export default function WalletsPage({ params }: Props) {
  const { id: projectId } = use(params);
  const searchParams = useSearchParams();
  // Set by /projects/new on successful create → tells us this is the user's
  // first time landing here and we should explain why we're here, not just
  // throw a form at them.
  const isOnboarding = searchParams.get("onboarding") === "1";
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<Chain>("ethereum");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: walletList, refetch } = trpc.wallets.list.useQuery({
    projectId,
  });

  const addWallet = trpc.wallets.add.useMutation({
    onSuccess: () => {
      setAddress("");
      setLabel("");
      setError(null);
      refetch();
    },
    onError: (e) => setError(e.message),
  });

  const removeWallet = trpc.wallets.remove.useMutation({
    onSuccess: () => refetch(),
  });

  return (
    <>
      {isOnboarding && (
        <div
          style={{
            background: "rgba(0,232,123,0.06)",
            border: "1px solid rgba(0,232,123,0.2)",
            borderRadius: 10,
            padding: "16px 20px",
            marginBottom: 24,
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--accent)",
              margin: "0 0 6px",
            }}
          >
            Add your treasury wallets
          </p>
          <p
            style={{
              fontSize: 13,
              color: "var(--vb-muted)",
              margin: 0,
              lineHeight: 1.55,
            }}
          >
            Paste the address of your treasury — multisig (Gnosis Safe), EOA,
            or exchange account. Add one per chain. We&apos;ll pull balances,
            inflows, and outflows from there. Token contract addresses don&apos;t
            count — those go in project settings.
          </p>
        </div>
      )}

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
          }}
        >
          Add wallet
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            placeholder="0x... or Solana address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <select
            // Native select caret sits flush against the right border —
            // looks crammed. Disable native chrome and paint a chevron via
            // background-image with explicit right offset so it has the
            // same breathing room as the text padding. Inline SVG keeps it
            // a single network-free request and respects var(--vb-muted).
            style={{
              ...inputStyle,
              background:
                "var(--vb-alt) url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a0a0a0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\") no-repeat right 14px center",
              padding: "13px 36px 13px 14px",
              width: 150,
              appearance: "none",
              WebkitAppearance: "none",
              MozAppearance: "none",
              cursor: "pointer",
            }}
            value={chain}
            onChange={(e) => setChain(e.target.value as Chain)}
          >
            {CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            // 140px clipped "Label (optional)"; bump to 180.
            style={{ ...inputStyle, width: 180 }}
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            onClick={() =>
              addWallet.mutate({ projectId, address, chain, label: label || undefined })
            }
            disabled={!address || addWallet.isPending}
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
              cursor: !address || addWallet.isPending ? "not-allowed" : "pointer",
              opacity: !address || addWallet.isPending ? 0.6 : 1,
            }}
          >
            <Plus size={14} />
            Add wallet
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {walletList?.length === 0 && (
          // Richer empty state — minimal hint + the two facts that come
          // up most often when founders are stuck at this step: "what
          // address type", "what wallet shape". The "Add wallet" button
          // already sits above this panel, so we don't duplicate the
          // CTA — we explain what's about to happen when they tap it.
          <div
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              textAlign: "center",
              padding: "48px 24px",
              background: "var(--vb-card)",
              border: "1px dashed var(--vb-border)",
              borderRadius: 12,
            }}
          >
            <p
              style={{
                fontSize: 16,
                color: "var(--vb-text)",
                fontWeight: 600,
                margin: "0 0 8px",
              }}
            >
              No treasury wallets yet
            </p>
            <p
              style={{
                fontSize: 13,
                color: "var(--vb-muted)",
                lineHeight: 1.6,
                margin: "0 auto",
                maxWidth: 440,
              }}
            >
              Use the <strong style={{ color: "var(--vb-text)" }}>Add wallet</strong>{" "}
              button above. Treasury wallets are{" "}
              <em>public addresses</em> you own — multisigs (Safe, Squads),
              EOAs, or exchange deposit addresses. Vault Brief only reads
              balances and transactions; it never asks for keys.
            </p>
          </div>
        )}
        {walletList?.map((w) => (
          <div
            key={w.id}
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
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 12,
                  color: "var(--vb-text)",
                  margin: "0 0 4px",
                  wordBreak: "break-all",
                }}
              >
                {w.address}
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <ChainIcon chain={w.chain} size={14} withLabel />
                {w.label && (
                  <span
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 12,
                      color: "var(--vb-muted)",
                    }}
                  >
                    · {w.label}
                  </span>
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexShrink: 0,
                paddingLeft: 16,
              }}
            >
              {w.balance && (
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 6,
                    }}
                  >
                    {w.balance.warnings.length > 0 && (
                      <AlertTriangle
                        size={13}
                        style={{ color: "#fbbf24", flexShrink: 0 }}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 14,
                        color:
                          w.balance.totalUsd === null
                            ? "var(--vb-dim)"
                            : "var(--vb-text)",
                      }}
                      // The warning text is the provider's own message. Shown
                      // on hover rather than inline so a failed wallet still
                      // occupies one row — a founder scanning for "which of
                      // these is empty" needs the column to stay readable.
                      title={
                        w.balance.warnings.length > 0
                          ? w.balance.warnings.join("\n")
                          : undefined
                      }
                    >
                      {w.balance.totalUsd === null
                        ? "—"
                        : formatUsd(w.balance.totalUsd)}
                    </span>
                  </div>
                  {balanceCaption(w.balance) && (
                    <div
                      style={{
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        fontSize: 11,
                        color: "var(--vb-dim)",
                        marginTop: 3,
                      }}
                    >
                      {balanceCaption(w.balance)}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => removeWallet.mutate({ projectId, walletId: w.id })}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "6px",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: "var(--vb-dim)",
                  display: "flex",
                }}
                aria-label={`Remove wallet ${w.label ?? w.address}`}
                title="Remove wallet"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
