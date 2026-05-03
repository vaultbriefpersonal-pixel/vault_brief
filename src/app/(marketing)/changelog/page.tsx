import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changelog — VaultBrief",
  description: "A log of every improvement, fix, and new feature shipped to VaultBrief.",
};

type TagType = "new" | "improvement" | "fix";

const ENTRIES: {
  date: string;
  version: string;
  items: { tag: TagType; title: string; desc: string }[];
}[] = [
  {
    date: "May 1, 2026",
    version: "v0.9.1",
    items: [
      {
        tag: "new",
        title: "Trigger.dev background jobs",
        desc: "Monthly sync jobs now run entirely in the cloud via Trigger.dev. No server required on your end.",
      },
      {
        tag: "improvement",
        title: "Lazy database initialization",
        desc: "Database connections are now initialized on first use, reducing cold-start time for background workers.",
      },
    ],
  },
  {
    date: "April 15, 2026",
    version: "v0.9.0",
    items: [
      {
        tag: "new",
        title: "GitHub integration",
        desc: "Connect your GitHub org and get commits, PRs merged, and active contributors pulled into every monthly report automatically.",
      },
      {
        tag: "new",
        title: "Custom report branding",
        desc: "Growth and VC Suite plans can now set a custom logo, color palette, and header for all generated PDFs.",
      },
      {
        tag: "improvement",
        title: "AI narrative quality",
        desc: "Switched to Gemini 2.5 Flash via OpenRouter. Reports are now faster to generate and more accurate in financial summaries.",
      },
    ],
  },
  {
    date: "March 22, 2026",
    version: "v0.8.2",
    items: [
      {
        tag: "new",
        title: "Investor portal",
        desc: "Investors now have a read-only portal accessible via a secure link. No account required on their end.",
      },
      {
        tag: "fix",
        title: "Multi-chain balance aggregation",
        desc: "Fixed an issue where Arbitrum token balances were double-counted when the same token existed on Ethereum mainnet.",
      },
    ],
  },
  {
    date: "March 1, 2026",
    version: "v0.8.0",
    items: [
      {
        tag: "new",
        title: "Base chain support",
        desc: "Added support for Base. Wallet addresses on Base now sync automatically alongside Ethereum, Arbitrum, Polygon, and Solana.",
      },
      {
        tag: "new",
        title: "Expense classification",
        desc: "Outgoing transactions are now automatically categorized into payroll, infrastructure, marketing, grants, legal, and other.",
      },
      {
        tag: "improvement",
        title: "PDF rendering speed",
        desc: "Report PDFs now generate in under 3 seconds, down from 12-15 seconds in the previous version.",
      },
    ],
  },
  {
    date: "February 10, 2026",
    version: "v0.7.0",
    items: [
      {
        tag: "new",
        title: "Stripe billing",
        desc: "Paid plans are now live. Seed $99/mo, Growth $299/mo, VC Suite $799/mo. Annual billing available at 20% discount.",
      },
      {
        tag: "new",
        title: "Token metrics tracking",
        desc: "Native token price, market cap, holder count, and circulating supply are now fetched and included in reports.",
      },
    ],
  },
];

const TAG_STYLES: Record<TagType, { bg: string; color: string; label: string }> = {
  new: { bg: "rgba(0,232,123,0.12)", color: "var(--accent)", label: "New" },
  improvement: { bg: "rgba(99,102,241,0.15)", color: "#818cf8", label: "Improvement" },
  fix: { bg: "rgba(251,146,60,0.12)", color: "#fb923c", label: "Fix" },
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
            Changelog
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
            What's new
          </h1>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 16,
              color: "var(--vb-muted)",
              margin: 0,
            }}
          >
            Every improvement, fix, and new feature — in reverse chronological order.
          </p>
        </div>
      </section>

      <section className="vb-pad-x" style={{ paddingTop: 60, paddingBottom: 120 }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {ENTRIES.map((entry, i) => (
            <div
              key={entry.version}
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
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 12,
                    color: "var(--vb-dim)",
                  }}
                >
                  {entry.version}
                </span>
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
    </div>
  );
}
