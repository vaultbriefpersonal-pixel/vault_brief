import { Resend } from "resend";
import type { Report } from "@/server/db/schema";
import { db } from "@/server/db";
import { projects, treasurySnapshots } from "@/server/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";
import { formatUsd, formatDate } from "@/lib/utils";
import type { Anomaly } from "./anomalies";
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
import {
  compositionPieSvg,
  chainSplitSvg,
  trendBarsSvg,
  rasterizeAndUpload,
} from "./chart-png";
import {
  composeTreasury,
  compositionSlices,
} from "./treasury-composition";
import { REPORT_DISCLAIMER } from "@/lib/report-disclaimer";

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
  chartUrls: { composition?: string; chain?: string; trend?: string };
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

  // Composition derived at read time from the snapshot's per-token
  // `balances_detail` through the shared classifier, exactly as the PDF and the
  // report widget strip now do. The four frozen snapshot columns are a
  // write-only cache computed against whatever the project had entered at sync
  // time; on the fixture treasury they made this donut read "Other 100.0%" and
  // the Stablecoins KPI vanish. See treasury-composition.ts for the full
  // account. `project` may be null for an orphaned report — `composeTreasury`
  // reads that as "no own token configured" rather than throwing.
  const composition = snapshot
    ? composeTreasury(snapshot.balancesDetail, project ?? null)
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
    if (composition && composition.liquidStableUsd > 0) {
      metrics.push({
        label: "Stablecoins",
        value: formatUsd(composition.liquidStableUsd),
      });
    }
  }

  // Render chart PNGs and upload to Vercel Blob. All three calls are
  // concurrent and fail-open: if Blob isn't configured (local dev, missing
  // BLOB_READ_WRITE_TOKEN) they each return null and the email goes out
  // without charts. KPI grid still carries the numbers either way.
  const chartUrls: { composition?: string; chain?: string; trend?: string } = {};
  if (snapshot) {
    const compositionSvg = compositionPieSvg(
      composition ? compositionSlices(composition, project ?? null) : [],
      palette.accent
    );
    const chainEntries = snapshot.balancesByChain
      ? Object.entries(snapshot.balancesByChain as Record<string, number>).map(
          ([chain, value]) => ({ chain, value: Number(value) })
        )
      : [];
    const chainSvg = chainSplitSvg(chainEntries);

    // Pull trailing snapshots for the trend bar.
    const trailing = await db.query.treasurySnapshots.findMany({
      where: and(
        eq(treasurySnapshots.projectId, report.projectId),
        lt(treasurySnapshots.snapshotDate, snapshot.snapshotDate)
      ),
      orderBy: [desc(treasurySnapshots.snapshotDate)],
      limit: 5,
    });
    const trendData = [...trailing, snapshot]
      .reverse()
      .map((s) => ({
        date: typeof s.snapshotDate === "string" ? s.snapshotDate : String(s.snapshotDate),
        value: Number(s.totalBalanceUsd ?? 0),
      }));
    const trendSvg = trendBarsSvg(trendData, palette.accent);

    const [c, ch, t] = await Promise.all([
      rasterizeAndUpload(compositionSvg, report.id, "composition"),
      rasterizeAndUpload(chainSvg, report.id, "chain"),
      rasterizeAndUpload(trendSvg, report.id, "trend"),
    ]);
    if (c) chartUrls.composition = c;
    if (ch) chartUrls.chain = ch;
    if (t) chartUrls.trend = t;
  }

  return { palette, logoUrl, metrics, chartUrls };
}

export async function sendReportEmail(params: SendReportEmailParams) {
  const { to, projectName, report, reportUrl } = params;
  const period = formatDate(report.periodEnd);
  const { palette, logoUrl, metrics, chartUrls } = await loadEmailContext(
    report
  );

  // Chart embeds. Each falls open if the URL is missing — sections just
  // don't render. We never send an <img src=""> placeholder.
  const chartImg = (url: string | undefined, alt: string, maxW = 540) =>
    url
      ? `<img src="${url}" alt="${alt}" style="display: block; width: 100%; max-width: ${maxW}px; height: auto; margin: 8px auto 16px; border-radius: 8px;" />`
      : "";

  const body = `
    <p style="${paragraphStyle(palette)}">Hi ${to.name},</p>
    <p style="${paragraphStyle(palette)}">Please find below our monthly investor update for <strong>${period}</strong>.</p>
    ${metrics.length > 0 ? metricsGridHtml(metrics, palette) : ""}
    ${report.executiveSummary ? execSummaryHtml(report.executiveSummary, palette) : ""}
    ${chartImg(chartUrls.composition, "Treasury composition")}
    ${chartImg(chartUrls.chain, "Treasury split by chain")}
    ${chartImg(chartUrls.trend, "Treasury over time")}
    ${ctaButtonHtml(reportUrl, "View Full Report →", palette)}
  `;

  // Investor-facing send only — `renderEmailLayout`'s default footer is
  // shared with magic-link, review-ready and anomaly-alert emails, none of
  // which should carry a financial disclaimer. Keep the default attribution
  // line and append the disclaimer beneath it rather than replacing it.
  const footerHtml = `Sent via <a href="https://vaultbrief.io" style="color: ${palette.accent}; text-decoration: none;">Vault Brief</a> · Automated investor reporting for Web3<br/><br/><span style="font-size: 11px; color: ${palette.textMuted};">${REPORT_DISCLAIMER}</span>`;

  const html = renderEmailLayout({
    title: projectName,
    subtitle: `Monthly Investor Update · ${period}`,
    logoUrl,
    palette,
    bodyHtml: body,
    footerHtml,
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
    ${badgeHtml("Pending review", "amber")}
    <p style="${paragraphStyle(palette)} margin-top: 12px;">Vault Brief generated this month's investor report from your latest treasury snapshot. Review the numbers, edit the narrative, then send it to your investors when you're ready.</p>
    ${report.executiveSummary ? execSummaryHtml(report.executiveSummary, palette) : ""}
    ${ctaButtonHtml(reviewUrl, "Review and edit →", palette)}
    ${
      report.pdfUrl
        ? `<p style="text-align: center; font-size: 13px; margin: 16px 0 0;"><a href="${report.pdfUrl}" style="color: ${palette.accent}; text-decoration: underline;">Download report PDF</a></p>`
        : ""
    }
    <p style="font-size: 12px; color: ${palette.textMuted}; margin-top: 24px; line-height: 1.5;">
      Nothing has been sent to investors yet. The report stays in your dashboard until you approve it.
    </p>
  `;

  const html = renderEmailLayout({
    title: projectName,
    subtitle: `Investor report · ${period} (pending review)`,
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

/** Renders one anomaly as a list row — reused HTML list, not the LLM's
 * plain-text prompt format from anomalies.ts. */
function anomalyRowHtml(a: Anomaly): string {
  const dir = a.changePct > 0 ? "+" : "";
  const detail = a.newCategory
    ? `${formatUsd(a.current)} (no prior history — first occurrence)`
    : `${formatUsd(a.baseline)} → ${formatUsd(a.current)} (${dir}${a.changePct.toFixed(0)}%)`;
  return `<li style="margin-bottom: 8px;"><strong>${escapeHtmlForEmail(a.metric)}:</strong> ${detail}</li>`;
}

// Same escaping the shared layout helpers use internally — not exported
// from email-layout.ts, so a minimal local copy for this one call site.
function escapeHtmlForEmail(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface SendAnomalyAlertParams {
  to: { name: string; email: string };
  projectName: string;
  projectUrl: string;
  anomalies: Anomaly[];
  logoUrl?: string | null;
  brandColor?: string;
}

/**
 * Founder-only alert for critical treasury anomalies detected OUTSIDE the
 * monthly report cycle (see src/server/jobs/anomaly-alerts.ts). Never sent
 * to investors — this is an internal early-warning signal, not part of
 * the reviewed/approved investor narrative.
 */
export async function sendAnomalyAlertEmail(params: SendAnomalyAlertParams) {
  const { to, projectName, projectUrl, anomalies, logoUrl, brandColor } = params;
  const palette = paletteFor(brandColor ? { primaryColor: brandColor } : undefined);

  const body = `
    <p style="${paragraphStyle(palette)}">Hi ${to.name},</p>
    ${badgeHtml("Critical anomaly", "red")}
    <p style="${paragraphStyle(palette)} margin-top: 12px;">Vault Brief spotted a significant change in ${escapeHtmlForEmail(projectName)}'s treasury data — before the next monthly report:</p>
    <ul style="${paragraphStyle(palette)} padding-left: 20px;">
      ${anomalies.map((a) => anomalyRowHtml(a)).join("")}
    </ul>
    ${ctaButtonHtml(projectUrl, "View project →", palette)}
    <p style="font-size: 12px; color: ${palette.textMuted}; margin-top: 24px; line-height: 1.5;">
      This alert is for you only — nothing is sent to investors automatically.
    </p>
  `;

  const html = renderEmailLayout({
    title: projectName,
    subtitle: "Anomaly alert",
    logoUrl,
    palette,
    bodyHtml: body,
  });

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: `${to.name} <${to.email}>`,
    subject: `⚠ Anomaly detected in ${projectName}`,
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
