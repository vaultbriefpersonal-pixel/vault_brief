/**
 * Shared HTML shell for all transactional emails.
 *
 * Why string concatenation and not React-Email or MJML:
 * - Magic-link emails fire from server actions and Trigger.dev tasks; both
 *   run with a slim runtime and we don't want to add a render step.
 * - The total payload is < 200 LoC; the saved abstraction isn't worth a
 *   build-time dependency.
 *
 * Conventions:
 * - All literal hex colors live in PALETTE so a project's brand color can
 *   override the accent in one place. Never hardcode in a per-email body.
 * - Inline styles only (Gmail / Outlook drop <style> in some configs).
 * - 600px container, 40px outer margin — the Resend / Postmark consensus.
 */

export interface BrandPalette {
  /** Header background. Falls back to navy. */
  navy: string;
  /** Primary action / accent — the brand color from project.customBranding. */
  accent: string;
  text: string;
  textMuted: string;
  border: string;
  bgPage: string;
  bgCard: string;
}

const DEFAULT_PALETTE: BrandPalette = {
  navy: "#1B2A4A",
  accent: "#6366F1",
  text: "#374151",
  textMuted: "#9CA3AF",
  border: "#E5E7EB",
  bgPage: "#F9FAFB",
  bgCard: "#FFFFFF",
};

export function paletteFor(brand?: { primaryColor?: string }): BrandPalette {
  if (!brand?.primaryColor) return DEFAULT_PALETTE;
  return { ...DEFAULT_PALETTE, accent: brand.primaryColor };
}

export interface EmailLayoutArgs {
  /** Top-of-email title — typically the project name. */
  title: string;
  /** Subtitle under the title — period / "Investor report (pending review)" / etc. */
  subtitle?: string;
  /** Optional logo URL. When present, rendered at top-left of header. */
  logoUrl?: string | null;
  /** Email body HTML — already styled, inline. */
  bodyHtml: string;
  palette?: BrandPalette;
  /** Footer attribution. Falls back to default Vault Brief tagline. */
  footerHtml?: string;
}

/**
 * Render the shared chrome (header + body + footer) around an inner HTML
 * snippet. Inner blocks should use `paragraphStyle()` / `metricRowHtml()`
 * helpers below for consistent typography across emails.
 */
export function renderEmailLayout(args: EmailLayoutArgs): string {
  const palette = args.palette ?? DEFAULT_PALETTE;
  const footer =
    args.footerHtml ??
    `Sent via <a href="https://vaultbrief.io" style="color: ${palette.accent}; text-decoration: none;">Vault Brief</a> · Automated investor reporting for Web3`;

  const logoBlock = args.logoUrl
    ? `<img src="${args.logoUrl}" alt="" style="max-height: 32px; max-width: 140px; margin-bottom: 12px; display: block;" />`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(args.title)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: ${palette.text}; margin: 0; padding: 0; background: ${palette.bgPage};">
  <div style="max-width: 600px; margin: 40px auto; background: ${palette.bgCard}; border-radius: 12px; overflow: hidden; border: 1px solid ${palette.border};">
    <div style="background: ${palette.navy}; padding: 24px 32px;">
      ${logoBlock}
      <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700; line-height: 1.3;">${escapeHtml(args.title)}</h1>
      ${args.subtitle ? `<p style="color: #94a3b8; margin: 4px 0 0; font-size: 14px;">${escapeHtml(args.subtitle)}</p>` : ""}
    </div>
    <div style="padding: 32px;">
      ${args.bodyHtml}
    </div>
    <div style="text-align: center; font-size: 12px; color: ${palette.textMuted}; padding: 20px 32px; border-top: 1px solid ${palette.border};">
      <p style="margin: 0;">${footer}</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── helpers usable inside `bodyHtml` ──────────────────────────────────────

export function paragraphStyle(palette: BrandPalette = DEFAULT_PALETTE) {
  return `font-size: 15px; color: ${palette.text}; line-height: 1.6; margin: 0 0 16px;`;
}

/** Inline executive-summary block with accent-colored left border. */
export function execSummaryHtml(text: string, palette: BrandPalette): string {
  return `<div style="font-size: 14px; color: ${palette.text}; line-height: 1.6; margin: 16px 0; border-left: 3px solid ${palette.accent}; padding-left: 16px;">${escapeHtml(text)}</div>`;
}

/** A metric-card grid: pairs of (label, value) rendered as Treasury/Burn/Runway. */
export function metricsGridHtml(
  pairs: Array<{ label: string; value: string }>,
  palette: BrandPalette
): string {
  if (pairs.length === 0) return "";
  // 2-up grid using table cells — Outlook doesn't lay out flex/grid reliably.
  const cells = pairs
    .map(
      (p) => `
      <td style="width: 50%; padding: 10px 14px; vertical-align: top;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: ${palette.textMuted}; margin-bottom: 4px;">${escapeHtml(p.label)}</div>
        <div style="font-size: 18px; font-weight: 700; color: ${palette.text};">${escapeHtml(p.value)}</div>
      </td>`
    )
    .join("");
  // Two cells per row.
  const rows: string[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const row = pairs.slice(i, i + 2);
    rows.push(
      `<tr>${row.map((p) => `
      <td style="width: 50%; padding: 10px 14px; vertical-align: top;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: ${palette.textMuted}; margin-bottom: 4px;">${escapeHtml(p.label)}</div>
        <div style="font-size: 18px; font-weight: 700; color: ${palette.text};">${escapeHtml(p.value)}</div>
      </td>`).join("")}</tr>`
    );
  }
  void cells; // unused; kept the variable so the per-row code reads clearly
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width: 100%; margin: 16px 0; background: #f8fafc; border: 1px solid ${palette.border}; border-radius: 8px; border-collapse: separate;"><tbody>${rows.join("")}</tbody></table>`;
}

/** Big rounded primary CTA button. */
export function ctaButtonHtml(
  href: string,
  label: string,
  palette: BrandPalette
): string {
  return `<a href="${href}" style="display: block; background: ${palette.accent}; color: white !important; text-decoration: none; text-align: center; padding: 14px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 24px 0;">${escapeHtml(label)}</a>`;
}

/** Pill badge — used for Draft / Sent statuses inline, and critical alerts. */
export function badgeHtml(
  text: string,
  color: "amber" | "green" | "red" = "amber"
): string {
  const fg = color === "amber" ? "#92400E" : color === "green" ? "#065F46" : "#991B1B";
  const bg = color === "amber" ? "#FEF3C7" : color === "green" ? "#D1FAE5" : "#FEE2E2";
  return `<span style="display: inline-block; background: ${bg}; color: ${fg}; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 10px; border-radius: 999px;">${escapeHtml(text)}</span>`;
}

// ─── HTML escape ───────────────────────────────────────────────────────────
// Resists the most common XSS-via-investor-name vector. Tags applied to any
// user-controlled string interpolated above.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
