// How a project's branding is read, in one place.
//
// It was read in five, each with its own defensive cast of the same untyped
// JSONB column and its own idea of what the default is:
//
//   src/app/r/[reportId]/page.tsx        -> #00e87b
//   .../projects/[id]/reports/[reportId] -> #00e87b
//   .../projects/[id]/settings           -> #6366F1
//   src/server/services/email-sender.ts  -> #6366F1  (via email-layout)
//   src/server/jobs/anomaly-alerts.ts    -> #6366F1
//
// So a founder who never opened the colour picker got a green report page and
// an indigo email for the same report, and nothing in the codebase said which
// was intended. There is now one answer, and `DEFAULT_ACCENT` in
// report-theme.ts is it.
//
// SCOPE, deliberately: this converts the two web/PDF call sites and the tRPC
// validator. The two email-path sites keep their inline reads for now — the
// email surface is a different medium with its own constraints (no custom
// properties, no @font-face, table layout) and retheming it is its own piece
// of work. That leaves the email's accent visibly disagreeing with the
// report's for one release; it is logged rather than half-fixed.

import { DEFAULT_ACCENT, isHexColor } from "./report-theme";

export interface ReportBranding {
  /** Always a valid hex colour. Safe to interpolate into CSS. */
  primaryColor: string;
  /** Absolute URL, or null when the project has no logo. */
  logoUrl: string | null;
}

/**
 * The shape this reads. Loose on purpose — `customBranding` is untyped JSONB
 * and `logoUrl` is a separate legacy column, so callers pass the whole project
 * row and this decides.
 */
export interface BrandableProject {
  customBranding?: unknown;
  logoUrl?: string | null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Resolve a project's branding.
 *
 * Never throws and never returns an invalid colour: `primaryColor` reaching a
 * CSS property or a PDF style must not be able to break the render, and the
 * column has no format constraint (it was declared `z.string()` until this
 * stage, so rows written before it may hold anything).
 */
export function brandingFor(project: BrandableProject | null | undefined): ReportBranding {
  const raw =
    project && typeof project.customBranding === "object" && project.customBranding !== null
      ? (project.customBranding as Record<string, unknown>)
      : null;

  const candidate = asString(raw?.primaryColor);

  return {
    primaryColor: isHexColor(candidate) ? candidate.toLowerCase() : DEFAULT_ACCENT,
    // `customBranding.logoUrl` wins over the legacy `projects.logo_url`
    // column: the JSONB is what the settings form writes today, and the
    // column predates it.
    logoUrl: asString(raw?.logoUrl) ?? asString(project?.logoUrl),
  };
}
