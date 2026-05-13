import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product updates — Vault Brief",
  description:
    "A transparent log of what has shipped, what improved, and what is coming next.",
};

// Three-label model per the v2 brief. Only mark Planned for items that
// are not live. Email distribution / Stripe / USDC / report automation
// are running in production and are tagged Shipped accordingly.
//
// Planned items used to live inline inside the monthly entries. That
// blurred the line between "we did this" and "we will". They now live
// in WHATS_NEXT below, rendered as a separate section after the
// monthly log — same data, clearer message.
type TagType = "shipped" | "improved" | "planned";

const ENTRIES: {
  date: string;
  version?: string;
  items: { tag: TagType; title: string; desc: string }[];
}[] = [
  {
    date: "May 2026",
    items: [
      {
        tag: "shipped",
        title: "Demo report preview",
        desc: "Added a public demo report page so users can understand the report format before creating an account.",
      },
      {
        tag: "improved",
        title: "Project onboarding",
        desc: "Improved the project creation flow so treasury wallets are treated as the primary input for report generation.",
      },
      {
        tag: "shipped",
        title: "Public investor report view",
        desc: "Investor email links now open a read-only report page at /r/<id> so recipients can read the full report without an account.",
      },
      {
        tag: "shipped",
        title: "CoinGecko / CoinMarketCap autofill",
        desc: "New project flow can prefill description, website, GitHub org, and token symbol from a token contract lookup.",
      },
      {
        tag: "shipped",
        title: "Milestones manual entry",
        desc: "Founders can now add and edit milestones from the report template editor, powering the Looking Ahead and Milestones Completed sections.",
      },
    ],
  },
  {
    date: "April 2026",
    version: "v0.9.0",
    items: [
      {
        tag: "shipped",
        title: "GitHub integration",
        desc: "Connect a GitHub org and pull commits, merged PRs, and active contributors into every monthly report.",
      },
      {
        tag: "shipped",
        title: "Custom report branding",
        desc: "Set a custom logo and accent color for all generated PDFs.",
      },
      {
        tag: "improved",
        title: "AI narrative quality",
        desc: "Switched to Gemini 2.5 Flash via OpenRouter. Reports are now faster to generate and more accurate in financial summaries.",
      },
    ],
  },
  {
    date: "March 2026",
    version: "v0.8.0",
    items: [
      {
        tag: "shipped",
        title: "Base chain support",
        desc: "Added support for Base. Wallet addresses on Base now sync automatically alongside Ethereum, Arbitrum, Polygon, and Solana.",
      },
      {
        tag: "shipped",
        title: "Expense classification",
        desc: "Outgoing transactions are now automatically categorized into payroll, infrastructure, marketing, grants, legal, and other.",
      },
      {
        tag: "improved",
        title: "PDF rendering speed",
        desc: "Report PDFs now generate in under 3 seconds, down from 12-15 seconds in the previous version.",
      },
    ],
  },
  {
    date: "February 2026",
    version: "v0.7.0",
    items: [
      {
        tag: "shipped",
        title: "Stripe billing",
        desc: "Paid plans are live. Annual billing is available at a 20% discount.",
      },
      {
        tag: "shipped",
        title: "USDC payments",
        desc: "Pay-with-USDC is live for projects that prefer crypto-native billing alongside card payments.",
      },
      {
        tag: "shipped",
        title: "Token metrics tracking",
        desc: "Native token price, market cap, holder count, and circulating supply are fetched and included in reports.",
      },
      {
        tag: "shipped",
        title: "Monthly automated sync",
        desc: "Scheduled monthly snapshot, expense classification, and report generation run end-to-end via Trigger.dev.",
      },
      {
        tag: "shipped",
        title: "Investor email distribution",
        desc: "Send reviewed reports to investors via Resend. Open and click events are tracked back into the report dashboard.",
      },
    ],
  },
];

// What's next — items that aren't shipped yet. Same shape as monthly
// items minus the date so they render under their own "What's next"
// header instead of bleeding into the historical log.
const WHATS_NEXT: { title: string; desc: string }[] = [
  {
    title: "Investor portal",
    desc: "Secure shared-link portal for investors so founders don't have to email PDFs manually. One link, gated by token, with read receipts.",
  },
  {
    title: "API access",
    desc: "Read-only API for funds and platforms that want to pull projects, snapshots, and reports into internal dashboards. Per-plan rate limits.",
  },
  {
    title: "White-label reports",
    desc: "Custom-branded PDFs without the Vault Brief footer for funds and reporting agencies that resell the output.",
  },
];

const TAG_STYLES: Record<TagType, { bg: string; color: string; label: string }> = {
  shipped: {
    bg: "rgba(0,232,123,0.12)",
    color: "var(--accent)",
    label: "Shipped",
  },
  improved: {
    bg: "rgba(99,102,241,0.15)",
    color: "#818cf8",
    label: "Improved",
  },
  planned: {
    bg: "rgba(251,146,60,0.12)",
    color: "#fb923c",
    label: "Planned",
  },
};

export default function ChangelogPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 80,
          paddingBottom: 60,
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.04) 0%, transparent 100%)",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "var(--accent)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            Product updates
          </p>
          <h1
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(36px, 5vw, 52px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.035em",
              margin: "0 0 16px",
            }}
          >
            Product updates
          </h1>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 16,
              color: "var(--vb-muted)",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            A transparent log of what has shipped, what improved, and what is
            coming next.
          </p>
        </div>
      </section>

      <section className="vb-pad-x" style={{ paddingTop: 60, paddingBottom: 120 }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {ENTRIES.map((entry, i) => (
            <div
              key={entry.date + (entry.version ?? "")}
              className="vb-stack-mobile"
              style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr",
                gap: 48,
                paddingBottom: 64,
                borderBottom:
                  i < ENTRIES.length - 1
                    ? "1px solid rgba(255,255,255,0.08)"
                    : "none",
                marginBottom: i < ENTRIES.length - 1 ? 64 : 0,
              }}
            >
              <div>
                <p
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    margin: "0 0 4px",
                  }}
                >
                  {entry.date}
                </p>
                {entry.version && (
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 12,
                      color: "var(--vb-dim)",
                    }}
                  >
                    {entry.version}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                {entry.items.map((item, j) => {
                  const style = TAG_STYLES[item.tag];
                  return (
                    <div key={j}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginBottom: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            padding: "3px 10px",
                            background: style.bg,
                            color: style.color,
                            borderRadius: 100,
                            fontFamily: "var(--font-inter), Inter, sans-serif",
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {style.label}
                        </span>
                        <h3
                          style={{
                            fontFamily:
                              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                            fontSize: 16,
                            fontWeight: 600,
                            color: "var(--vb-text)",
                            margin: 0,
                          }}
                        >
                          {item.title}
                        </h3>
                      </div>
                      <p
                        style={{
                          fontFamily: "var(--font-inter), Inter, sans-serif",
                          fontSize: 15,
                          color: "var(--vb-muted)",
                          lineHeight: 1.65,
                          margin: 0,
                        }}
                      >
                        {item.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* What's next — separated from the historical log so visitors can
          tell at a glance what's shipped vs. what's coming. */}
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 32,
          paddingBottom: 120,
          background: "var(--vb-alt)",
          borderTop: "1px solid var(--vb-border)",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto", paddingTop: 60 }}>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "var(--vb-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            What&apos;s next
          </p>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(24px, 3vw, 32px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.025em",
              margin: "0 0 8px",
            }}
          >
            On the roadmap
          </h2>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 15,
              color: "var(--vb-muted)",
              lineHeight: 1.65,
              margin: "0 0 40px",
            }}
          >
            Items below are planned but not shipped yet. Want one of these
            sooner? Email{" "}
            <a
              href="mailto:hello@vaultbrief.io"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              hello@vaultbrief.io
            </a>{" "}
            and we&apos;ll bump the priority.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {WHATS_NEXT.map((item) => (
              <div key={item.title}>
                <h3
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    margin: "0 0 6px",
                  }}
                >
                  {item.title}
                </h3>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 15,
                    color: "var(--vb-muted)",
                    lineHeight: 1.65,
                    margin: 0,
                  }}
                >
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
