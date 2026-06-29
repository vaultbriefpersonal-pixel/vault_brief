"use client";

import { trpc } from "@/lib/api";

/**
 * Per-investor engagement panel for the founder's report editor.
 *
 * Consumes `reports.getEngagements`, which rolls the Resend webhook
 * event log (report_engagements) up into one row per recipient. The
 * reports LIST page already shows aggregate "9 opened · 3 clicked";
 * this is the drill-in: WHICH investor opened, how many times, and
 * when they last engaged.
 *
 * Self-hides when there's nothing to show (report never sent, or no
 * events logged yet) so draft / pending-review reports don't render an
 * empty table — same null-safe philosophy as ReportWidgets.
 */

interface ReportEngagementsProps {
  reportId: string;
}

// Short timestamp ("Jun 3, 2026"). Lives here rather than lib/utils
// because utils.formatDate is intentionally month+year only (used for
// report periods); engagement events need day-level resolution.
function formatEventDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ReportEngagements({ reportId }: ReportEngagementsProps) {
  const { data } = trpc.reports.getEngagements.useQuery({ reportId });

  // Nothing to show until the report has actually been sent and at
  // least one event has landed. Keeps the panel out of the way on
  // draft / pending-review reports.
  if (!data || (data.totals.sent === 0 && data.recipients.length === 0)) {
    return null;
  }

  const { totals, recipients } = data;

  const cellBase: React.CSSProperties = {
    fontFamily: "var(--font-inter), Inter, sans-serif",
    fontSize: 13,
    color: "var(--vb-text)",
    padding: "10px 12px",
    textAlign: "left",
  };

  const headBase: React.CSSProperties = {
    ...cellBase,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--vb-dim)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };

  return (
    <section
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "24px 20px 0",
      }}
    >
      <div
        style={{
          background: "var(--vb-card)",
          border: "1px solid var(--vb-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {/* Header + report-wide totals */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "16px 16px 12px",
            borderBottom: "1px solid var(--vb-border)",
          }}
        >
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 15,
              fontWeight: 600,
              color: "var(--vb-text)",
              margin: 0,
            }}
          >
            Investor engagement
          </h2>
          <span
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--vb-muted)",
            }}
          >
            {totals.sent} sent · {totals.opened} opened · {totals.clicked}{" "}
            clicked
            {totals.bounced > 0 ? ` · ${totals.bounced} bounced` : ""}
          </span>
        </div>

        {recipients.length === 0 ? (
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "var(--vb-dim)",
              margin: 0,
              padding: "16px",
            }}
          >
            Delivered, but no opens recorded yet. Open and click events
            arrive as investors interact with the email.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 520,
              }}
            >
              <thead>
                <tr>
                  <th style={headBase}>Investor</th>
                  <th style={{ ...headBase, textAlign: "right" }}>Opens</th>
                  <th style={{ ...headBase, textAlign: "right" }}>Clicks</th>
                  <th style={{ ...headBase, textAlign: "right" }}>
                    Last opened
                  </th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r, i) => (
                  <tr
                    key={r.email}
                    style={{
                      borderTop:
                        i === 0 ? "none" : "1px solid var(--vb-border)",
                    }}
                  >
                    <td style={cellBase}>{r.email}</td>
                    <td
                      style={{
                        ...cellBase,
                        textAlign: "right",
                        color:
                          r.opened > 0 ? "var(--accent)" : "var(--vb-dim)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {r.opened}
                    </td>
                    <td
                      style={{
                        ...cellBase,
                        textAlign: "right",
                        color:
                          r.clicked > 0 ? "var(--accent)" : "var(--vb-dim)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {r.clicked}
                    </td>
                    <td
                      style={{
                        ...cellBase,
                        textAlign: "right",
                        color: "var(--vb-muted)",
                      }}
                    >
                      {formatEventDate(r.lastOpenedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
