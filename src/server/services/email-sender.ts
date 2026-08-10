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
import { brandingFor } from "@/lib/report-branding";

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
  // One reader for branding, hex-validated and with a single default. The raw
  // cast this replaces had neither, and carried its own idea of the default.
  const branding = brandingFor(project);
  const palette = paletteFor({ primaryColor: branding.primaryColor });
  const logoUrl = branding.logoUrl;

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

interface SendSyncIssueParams {
  to: { name: string; email: string };
  projectName: string;
  walletsUrl: string;
  /** One `describeSyncIssue` sentence per distinct issue, worst first. */
  issues: string[];
  /** The underlying provider errors, shown verbatim under the summary. */
  details: string[];
  logoUrl?: string | null;
  brandColor?: string;
}

/**
 * Founder-only alert that a sync finished but did NOT read everything.
 *
 * The gap this closes: a sync that cannot reach a chain still writes a
 * snapshot, still reports success, and records the problem only in
 * `sync_warnings` — which, until this, nothing pushed anywhere. Base Mainnet
 * was disabled on the Alchemy app for nine days and every Base figure was
 * silently missing the whole time.
 *
 * Default footer, no `REPORT_DISCLAIMER`: this is an operational nudge to the
 * founder, not a financial statement to an investor — the same call
 * `sendGrantReportDueEmail` makes.
 */
export async function sendSyncIssueEmail(params: SendSyncIssueParams) {
  const { to, projectName, walletsUrl, issues, details, logoUrl, brandColor } =
    params;
  const palette = paletteFor(brandColor ? { primaryColor: brandColor } : undefined);

  const body = `
    <p style="${paragraphStyle(palette)}">Hi ${to.name},</p>
    ${badgeHtml("Incomplete sync", "amber")}
    <p style="${paragraphStyle(palette)} margin-top: 12px;">${escapeHtmlForEmail(projectName)} synced, but some data could not be read. The figures below are affected until it is fixed — a report generated now would understate them without saying so loudly enough.</p>
    <ul style="${paragraphStyle(palette)} padding-left: 20px;">
      ${issues.map((i) => `<li style="margin-bottom: 6px;">${escapeHtmlForEmail(i)}</li>`).join("")}
    </ul>
    ${
      details.length > 0
        ? `<p style="font-size: 12px; color: ${palette.textMuted}; margin-top: 16px; line-height: 1.5;">Reported by the data provider:<br>${details
            .map((d) => `<code>${escapeHtmlForEmail(d)}</code>`)
            .join("<br>")}</p>`
        : ""
    }
    ${ctaButtonHtml(walletsUrl, "Check wallets →", palette)}
    <p style="font-size: 12px; color: ${palette.textMuted}; margin-top: 24px; line-height: 1.5;">
      This alert is for you only — nothing is sent to investors automatically.
      You will hear about this issue once a month while it persists, not on
      every sync.
    </p>
  `;

  const html = renderEmailLayout({
    title: projectName,
    subtitle: "Incomplete sync",
    logoUrl,
    palette,
    bodyHtml: body,
  });

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: `${to.name} <${to.email}>`,
    subject: `⚠ ${projectName}: some treasury data could not be read`,
    html,
  });

  if (error) throw new Error(`Email send failed: ${error.message}`);
  return data;
}

interface SendGrantReportDueParams {
  to: { name: string; email: string };
  projectName: string;
  projectUrl: string;
  grantorName: string;
  program?: string | null;
  dueDate: string;
}

/**
 * Founder-only nudge that a grant report is coming due (see
 * src/server/jobs/grant-report-reminders.ts). Never sent to investors or the
 * grantor — this is an internal reminder, not part of the reviewed/approved
 * narrative that ships to a funder.
 *
 * Uses the DEFAULT footer, no `REPORT_DISCLAIMER` override — same reasoning
 * as `sendAnomalyAlertEmail` and `sendReportReadyForReviewEmail` above:
 * `renderEmailLayout`'s default footer is shared with magic-link,
 * review-ready and anomaly-alert emails, none of which carry a financial
 * disclaimer, and a due-date reminder with no numbers in it is in that same
 * family, not a financial statement.
 */
export async function sendGrantReportDueEmail(params: SendGrantReportDueParams) {
  const { to, projectName, projectUrl, grantorName, program, dueDate } = params;
  const palette = paletteFor();
  const formattedDue = formatDate(dueDate);
  const grantLabel = program
    ? `${escapeHtmlForEmail(grantorName)} — ${escapeHtmlForEmail(program)}`
    : escapeHtmlForEmail(grantorName);

  const body = `
    <p style="${paragraphStyle(palette)}">Hi ${to.name},</p>
    ${badgeHtml("Report due soon", "amber")}
    <p style="${paragraphStyle(palette)} margin-top: 12px;">A grant report for <strong>${escapeHtmlForEmail(projectName)}</strong> is coming due:</p>
    <ul style="${paragraphStyle(palette)} padding-left: 20px;">
      <li style="margin-bottom: 8px;"><strong>Grant:</strong> ${grantLabel}</li>
      <li style="margin-bottom: 8px;"><strong>Due:</strong> ${formattedDue}</li>
    </ul>
    ${ctaButtonHtml(projectUrl, "View reports →", palette)}
    <p style="font-size: 12px; color: ${palette.textMuted}; margin-top: 24px; line-height: 1.5;">
      This reminder is for you only — nothing has been sent to ${escapeHtmlForEmail(grantorName)} automatically.
    </p>
  `;

  const html = renderEmailLayout({
    title: projectName,
    subtitle: "Grant report due",
    palette,
    bodyHtml: body,
  });

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: `${to.name} <${to.email}>`,
    subject: `Grant report due for ${projectName} — ${formattedDue}`,
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
