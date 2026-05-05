"use client";

import { useState } from "react";
import { use } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/api";
import { Plus, Trash2 } from "lucide-react";
import { ChainIcon } from "@/components/ui/ChainIcon";

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
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              color: "var(--vb-dim)",
              textAlign: "center",
              padding: "40px 0",
            }}
          >
            No wallets added yet.
          </p>
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
            <div>
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
        ))}
      </div>
    </>
  );
}
