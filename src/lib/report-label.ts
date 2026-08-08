// What a report is called, in words.
//
// The public page hardcoded "Monthly Investor Update · {formatDate(periodEnd)}"
// on every report, which was wrong three ways at once:
//
//   - on a grant report, which is not an investor update
//   - on a quarterly project (`projects.report_frequency` has allowed
//     'quarterly' since it was added)
//   - on ANY report whose period is not a calendar month, which the product
//     has been able to generate since arbitrary reporting periods shipped —
//     a 90-day or since-grant-award report was labelled "Monthly" and dated
//     by its end month alone
//
// Pure and separate from the page so it can be tested without a database, and
// so the PDF masthead and (eventually) the email subject can agree with the
// page instead of each inventing their own phrasing.

import { periodFromRange } from "@/server/services/report-period";
import { formatDate } from "./utils";

export interface ReportLabelInput {
  /** `reports.report_type`. Anything other than "grant" reads as investor. */
  reportType?: string | null;
  /** `reports.period_start`. Nullable on rows written before the column. */
  periodStart?: string | Date | null;
  /** `reports.period_end`. Always present. */
  periodEnd: string | Date;
}

export interface ReportLabel {
  /** "Investor Update" | "Grant Report" — the masthead kicker. */
  kind: string;
  /** "April 2026" | "14 Feb – 31 Jul 2026" — the period, honestly described. */
  period: string;
}

export function describeReport(report: ReportLabelInput): ReportLabel {
  const kind = report.reportType === "grant" ? "Grant Report" : "Investor Update";

  // No start bound recorded: fall back to the end month rather than inventing
  // a range. Understating what we know beats asserting a period we don't.
  if (!report.periodStart) {
    return { kind, period: formatDate(report.periodEnd) };
  }

  try {
    return {
      kind,
      period: periodFromRange(report.periodStart, report.periodEnd).label,
    };
  } catch {
    // periodFromRange throws on an unparseable bound. A cosmetic label is not
    // worth a 500 on an investor-facing page.
    return { kind, period: formatDate(report.periodEnd) };
  }
}
