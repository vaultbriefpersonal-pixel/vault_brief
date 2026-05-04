import { Resend } from "resend";
import type { Report } from "@/server/db/schema";
import { db } from "@/server/db";
import { projects, treasurySnapshots } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { formatUsd, formatDate } from "@/lib/utils";
import {
  renderEmailLayout,
  paletteFor,
  paragraphStyle,
  execSummaryHtml,
  metricsGridHtml,
  ctaButtonHtml,
  badgeHtml,
  type BrandPalette,
} from "./email-layout";

// Lazy init: Trigger.dev's deploy bundler imports task files at build time
// when env vars aren't available. Constructing the Resend client at module
// load would throw "Missing API key" during deploy. Defer until first use.
let _resend: Resend | undefined;
function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM = process.env.RESEND_FROM_EMAIL ?? "reports@vaultbrief.io";

interface SendReportEmailParams {
  to: { name: string; email: string };
  projectName: string;
  report: Report;
  reportUrl: string;
}

/**
 * Pull the project's branding + the snapshot tied to this report so the
 * investor email can ship with the founder's brand color and inline KPIs.
 * Both lookups are cheap and do not block the send — caller has already
 * validated the report exists.
 */
async function loadEmailContext(report: Report): Promise<{
  palette: BrandPalette;
  logoUrl: string | null;
  metrics: Array<{ label: string; value: string }>;
}> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, report.projectId),
  });
  const branding = (project?.customBranding as {
    primaryColor?: string;
    logoUrl?: string;
  } | null) ?? null;
  const palette = paletteFor(branding ?? undefined);
  const logoUrl = branding?.logoUrl ?? project?.logoUrl ?? null;

  // Load the snapshot referenced by the report so we can pull KPIs without
  // re-parsing the markdown body. Avoids the brittle regex extraction the
  // previous template used (it grabbed "burn rate: $X" via a regex that
  // missed half the LLM's variations).
  const snapshot = report.snapshotId
    ? await db.query.treasurySnapshots.findFirst({
        where: eq(treasurySnapshots.id, report.snapshotId),
      })
    : null;

  const metrics: Array<{ label: string; value: string }> = [];
  if (snapshot) {
    if (snapshot.totalBalanceUsd != null) {
      metrics.push({
        label: "Treasury",
        value: formatUsd(Number(snapshot.totalBalanceUsd)),
      });
    }
    if (snapshot.burnRateUsd != null && Number(snapshot.burnRateUsd) > 0) {
      metrics.push({
        label: "Burn / mo",
        value: formatUsd(Number(snapshot.burnRateUsd)),
      });
    }
    if (snapshot.runwayMonths != null) {
      metrics.push({
        label: "Runway",
        value: `${Number(snapshot.runwayMonths).toFixed(0)} mo`,
      });
    }
    if (snapshot.stablecoinsUsd != null && Number(snapshot.stablecoinsUsd) > 0) {
      metrics.push({
        label: "Stablecoins",
        value: formatUsd(Number(snapshot.stablecoinsUsd)),
      });
    }
  }

  return { palette, logoUrl, metrics };
}

export async function sendReportEmail(params: SendReportEmailParams) {
  const { to, projectName, report, reportUrl } = params;
  const period = formatDate(report.periodEnd);
  const { palette, logoUrl, metrics } = await loadEmailContext(report);

  const body = `
    <p style="${paragraphStyle(palette)}">Hi ${to.name},</p>
    <p style="${paragraphStyle(palette)}">Please find below our monthly investor update for <strong>${period}</strong>.</p>
    ${metrics.length > 0 ? metricsGridHtml(metrics, palette) : ""}
    ${report.executiveSummary ? execSummaryHtml(report.executiveSummary, palette) : ""}
    ${ctaButtonHtml(reportUrl, "View Full Report →", palette)}
  `;

  const html = renderEmailLayout({
    title: projectName,
    subtitle: `Monthly Investor Update · ${period}`,
    logoUrl,
    palette,
    bodyHtml: body,
  });

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: `${to.name} <${to.email}>`,
    subject: `${projectName} — Monthly Update (${period})`,
    html,
    // Tags identify the report on Resend webhooks (email.opened/clicked) so we
    // can attribute opens back to the right row without a tracking pixel.
    tags: [
      { name: "reportId", value: report.id },
      { name: "kind", value: "investor_report" },
    ],
  });

  if (error) throw new Error(`Email send failed: ${error.message}`);
  return data;
}

interface SendReportReadyForReviewParams {
  to: { name: string; email: string };
  projectName: string;
  report: Report;
  reviewUrl: string;
}

export async function sendReportReadyForReviewEmail(
  params: SendReportReadyForReviewParams
) {
  const { to, projectName, report, reviewUrl } = params;
  const period = formatDate(report.periodEnd);
  const { palette, logoUrl } = await loadEmailContext(report);

  const body = `
    <p style="${paragraphStyle(palette)}">Hi ${to.name},</p>
    ${badgeHtml("Draft", "amber")}
    <p style="${paragraphStyle(palette)} margin-top: 12px;">Vault Brief auto-generated this month's investor report from your latest treasury snapshot. Review the numbers, edit the narrative, then send it to your investors when you're happy with it.</p>
    ${report.executiveSummary ? execSummaryHtml(report.executiveSummary, palette) : ""}
    ${ctaButtonHtml(reviewUrl, "Review and edit →", palette)}
    ${
      report.pdfUrl
        ? `<p style="text-align: center; font-size: 13px; margin: 16px 0 0;"><a href="${report.pdfUrl}" style="color: ${palette.accent}; text-decoration: underline;">Download draft PDF</a></p>`
        : ""
    }
    <p style="font-size: 12px; color: ${palette.textMuted}; margin-top: 24px; line-height: 1.5;">
      Nothing has been sent to investors yet. The draft will sit in your dashboard until you approve it.
    </p>
  `;

  const html = renderEmailLayout({
    title: projectName,
    subtitle: `Investor report draft · ${period}`,
    logoUrl,
    palette,
    bodyHtml: body,
  });

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: `${to.name} <${to.email}>`,
    subject: `Your ${projectName} report is ready for review (${period})`,
    html,
  });

  if (error) throw new Error(`Email send failed: ${error.message}`);
  return data;
}

export async function sendMagicLinkEmail(to: string, url: string) {
  // No project context for sign-in — use the default palette but render it
  // through the same layout shell so the email feels consistent with the
  // investor reports.
  const palette = paletteFor();
  const body = `
    <p style="${paragraphStyle(palette)}">Click the button below to sign in. This link expires in 24 hours.</p>
    ${ctaButtonHtml(url, "Sign in →", palette)}
    <p style="font-size: 12px; color: ${palette.textMuted}; margin-top: 24px; line-height: 1.5;">
      If you didn't request this, you can safely ignore this email.
    </p>
  `;

  const html = renderEmailLayout({
    title: "Sign in to Vault Brief",
    palette,
    bodyHtml: body,
  });

  const { error } = await getResend().emails.send({
    from: FROM,
    to,
    subject: "Sign in to Vault Brief",
    html,
  });
  if (error) throw new Error(`Magic link email failed: ${error.message}`);
}
