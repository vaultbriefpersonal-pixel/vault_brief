import type { CSSProperties } from "react";

/**
 * Inline SVG chain logos. Inlined (not <img src="cdn">) so the wallets
 * list doesn't trigger 6 extra network requests on first paint, and so
 * the icons recolor naturally for hover / disabled states via fill.
 *
 * Marks are simplified, brand-recognizable silhouettes, not the official
 * full-color logos. If we ever want pixel-perfect brand marks, swap to
 * `cryptocurrency-icons` package or per-chain SVGs from each foundation's
 * media kit. For an at-a-glance dashboard pill these are fine.
 */

type Chain =
  | "ethereum"
  | "polygon"
  | "arbitrum"
  | "base"
  | "optimism"
  | "solana";

const CHAIN_META: Record<
  Chain,
  { label: string; bg: string; fg: string; symbol: string }
> = {
  ethereum: { label: "Ethereum", bg: "#627EEA", fg: "#fff", symbol: "Ξ" },
  polygon: { label: "Polygon", bg: "#8247E5", fg: "#fff", symbol: "▲" },
  arbitrum: { label: "Arbitrum", bg: "#28A0F0", fg: "#fff", symbol: "◆" },
  base: { label: "Base", bg: "#0052FF", fg: "#fff", symbol: "○" },
  optimism: { label: "Optimism", bg: "#FF0420", fg: "#fff", symbol: "●" },
  solana: { label: "Solana", bg: "#9945FF", fg: "#fff", symbol: "S" },
};

interface ChainIconProps {
  chain: string;
  size?: number;
  /** When true, render label after icon (default false). */
  withLabel?: boolean;
  style?: CSSProperties;
}

export function ChainIcon({
  chain,
  size = 16,
  withLabel = false,
  style,
}: ChainIconProps) {
  const meta = CHAIN_META[chain as Chain];
  if (!meta) {
    // Unknown chain → render a neutral circle with first letter; never
    // throw, otherwise a stale `chain` value blows up the wallet list.
    return (
      <span
        aria-label={chain}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          ...style,
        }}
      >
        <span
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: "#444",
            color: "#ddd",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.round(size * 0.55),
            fontWeight: 700,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {chain.charAt(0).toUpperCase()}
        </span>
        {withLabel && (
          <span
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "var(--vb-muted)",
              textTransform: "capitalize",
            }}
          >
            {chain}
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      aria-label={meta.label}
      title={meta.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...style,
      }}
    >
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: meta.bg,
          color: meta.fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round(size * 0.6),
          fontWeight: 700,
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          lineHeight: 1,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {meta.symbol}
      </span>
      {withLabel && (
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--vb-muted)",
          }}
        >
          {meta.label}
        </span>
      )}
    </span>
  );
}
