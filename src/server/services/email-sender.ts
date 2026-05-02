import { Resend } from "resend";
import type { Report } from "@/server/db/schema";
import { formatUsd, formatDate } from "@/lib/utils";

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

function buildEmailHtml(params: SendReportEmailParams): string {
  const { to, projectName, report, reportUrl } = params;
  const period = formatDate(report.periodEnd);
  const burnRate = report.contentMd?.match(/burn rate[:\s]+(\$[\d,.MK]+)/i)?.[1] ?? "See full report";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #374151; margin: 0; padding: 0; background: #f9fafb; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; }
    .header { background: #1B2A4A; padding: 24px 32px; }
    .header h1 { color: white; margin: 0; font-size: 20px; font-weight: 700; }
    .header p { color: #94a3b8; margin: 4px 0 0; font-size: 14px; }
    .body { padding: 32px; }
    .greeting { font-size: 15px; color: #374151; margin-bottom: 16px; }
    .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .summary-box h3 { margin: 0 0 12px; color: #1B2A4A; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; }
    .metric { display: flex; justify-content: space-between; margin: 8px 0; font-size: 14px; }
    .metric-label { color: #6b7280; }
    .metric-value { font-weight: 600; color: #111827; }
    .cta { display: block; background: #6366F1; color: white !important; text-decoration: none; text-align: center; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 24px 0; }
    .executive-summary { font-size: 14px; color: #374151; line-height: 1.6; margin: 16px 0; border-left: 3px solid #6366F1; padding-left: 16px; }
    .footer { text-align: center; font-size: 12px; color: #9ca3af; padding: 20px 32px; border-top: 1px solid #f3f4f6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${projectName}</h1>
      <p>Monthly Investor Update · ${period}</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${to.name},</p>
      <p>Please find below our monthly investor update for <strong>${period}</strong>.</p>

      ${report.executiveSummary ? `<div class="executive-summary">${report.executiveSummary}</div>` : ""}

      <a href="${reportUrl}" class="cta">View Full Report →</a>
    </div>
    <div class="footer">
      <p>Sent via <a href="https://vaultbrief.io" style="color: #6366F1;">VaultBrief</a> · Automated investor reporting for Web3</p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendReportEmail(params: SendReportEmailParams) {
  const { to, projectName, report } = params;
  const period = formatDate(report.periodEnd);

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: `${to.name} <${to.email}>`,
    subject: `${projectName} — Monthly Update (${period})`,
    html: buildEmailHtml(params),
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

function buildReadyForReviewHtml(params: SendReportReadyForReviewParams): string {
  const { to, projectName, report, reviewUrl } = params;
  const period = formatDate(report.periodEnd);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #374151; margin: 0; padding: 0; background: #f9fafb; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; }
    .header { background: #1B2A4A; padding: 24px 32px; }
    .header h1 { color: white; margin: 0; font-size: 20px; font-weight: 700; }
    .header p { color: #94a3b8; margin: 4px 0 0; font-size: 14px; }
    .body { padding: 32px; }
    .greeting { font-size: 15px; color: #374151; margin-bottom: 16px; }
    .draft-badge { display: inline-block; background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 10px; border-radius: 999px; margin-bottom: 12px; }
    .cta { display: block; background: #6366F1; color: white !important; text-decoration: none; text-align: center; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 24px 0; }
    .executive-summary { font-size: 14px; color: #374151; line-height: 1.6; margin: 16px 0; border-left: 3px solid #6366F1; padding-left: 16px; }
    .footer { text-align: center; font-size: 12px; color: #9ca3af; padding: 20px 32px; border-top: 1px solid #f3f4f6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${projectName}</h1>
      <p>Investor report draft · ${period}</p>
    </div>
    <div class="body">
      <p class="greeting">Hi ${to.name},</p>
      <span class="draft-badge">Draft</span>
      <p>VaultBrief auto-generated this month's investor report from your latest treasury snapshot. Review the numbers, edit the narrative, then send it to your investors when you're happy with it.</p>

      ${report.executiveSummary ? `<div class="executive-summary">${report.executiveSummary}</div>` : ""}

      <a href="${reviewUrl}" class="cta">Review and edit →</a>

      <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">
        Nothing has been sent to investors yet. The draft will sit in your dashboard until you approve it.
      </p>
    </div>
    <div class="footer">
      <p>Sent via <a href="https://vaultbrief.io" style="color: #6366F1;">VaultBrief</a> · Automated investor reporting for Web3</p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendReportReadyForReviewEmail(
  params: SendReportReadyForReviewParams
) {
  const { to, projectName, report } = params;
  const period = formatDate(report.periodEnd);

  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: `${to.name} <${to.email}>`,
    subject: `Your ${projectName} report is ready for review (${period})`,
    html: buildReadyForReviewHtml(params),
  });

  if (error) throw new Error(`Email send failed: ${error.message}`);
  return data;
}

export async function sendMagicLinkEmail(to: string, url: string) {
  const { error } = await getResend().emails.send({
    from: FROM,
    to,
    subject: "Sign in to VaultBrief",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 40px auto;">
        <h2 style="color: #1B2A4A;">Sign in to VaultBrief</h2>
        <p>Click the button below to sign in. This link expires in 24 hours.</p>
        <a href="${url}" style="display: inline-block; background: #6366F1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Sign in →
        </a>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
  if (error) throw new Error(`Magic link email failed: ${error.message}`);
}
