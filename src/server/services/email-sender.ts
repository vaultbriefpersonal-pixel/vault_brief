import { Resend } from "resend";
import type { Report } from "@/server/db/schema";
import { db } from "@/server/db";
import { projects, treasurySnapshots } from "@/server/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";
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
import {
  compositionPieSvg,
  chainSplitSvg,
  trendBarsSvg,
  rasterizeAndUpload,
} from "./chart-png";

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

  // Render chart PNGs and upload to Vercel Blob. All three calls are
  // concurrent and fail-open: if Blob isn't configured (local dev, missing
  // BLOB_READ_WRITE_TOKEN) they each return null and the email goes out
  // without charts. KPI grid still carries the numbers either way.
  const chartUrls: { composition?: string; chain?: string; trend?: string } = {};
  if (snapshot) {
    const composition = compositionPieSvg(
      [
        { label: "Stables", value: Number(snapshot.stablecoinsUsd ?? 0) },
        { label: "ETH/WETH", value: Number(snapshot.ethUsd ?? 0) },
        { label: "Native token", value: Number(snapshot.nativeTokenUsd ?? 0) },
        { label: "Other", value: Number(snapshot.otherAssetsUsd ?? 0) },
      ],
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
      rasterizeAndUpload(composition, report.id, "composition"),
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
