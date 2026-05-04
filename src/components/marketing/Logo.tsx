export function Logo({ size = 26 }: { size?: number }) {
  const accent = "#00e87b";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, userSelect: "none" }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect x="2" y="8" width="28" height="20" rx="3" stroke={accent} strokeWidth="2.2" fill="none" />
        <path d="M8 4h16v4H8z" fill={accent} opacity="0.7" />
        <rect x="8" y="14" width="16" height="2" rx="1" fill={accent} opacity="0.5" />
        <rect x="8" y="19" width="10" height="2" rx="1" fill={accent} opacity="0.3" />
        <rect x="8" y="24" width="6" height="1.5" rx="0.75" fill={accent} opacity="0.2" />
      </svg>
      <span style={{
        fontSize: size * 0.73,
        fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
        fontWeight: 700,
        letterSpacing: "-0.02em",
        color: "var(--vb-text)",
      }}>
        VAULT<span style={{ color: accent }}> BRIEF</span>
      </span>
    </div>
  );
}
