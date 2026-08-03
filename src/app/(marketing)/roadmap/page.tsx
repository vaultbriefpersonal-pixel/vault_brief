import type { Metadata } from "next";
import Link from "next/link";

const TITLE = "Roadmap — Vault Brief";
const DESC =
  "What's shipped, what we're building now, and what's coming next. Updated as the product moves.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  // Page-specific OG/Twitter so sharing the roadmap link unfurls with
  // "Roadmap" rather than falling back to the root layout's generic
  // product title. metadataBase (set in the root layout) resolves the
  // relative image path against the apex host.
  openGraph: { title: TITLE, description: DESC, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

// Public-facing roadmap. Internal infra work (Sentry source maps, env
// hygiene, etc.) stays out — this is what a founder evaluating the
// product cares about, not what we're cleaning up backstage.
//
// Three buckets, in this exact order:
//  - Shipped  → recent user-visible wins. Headline only, link to
//               /changelog for the full historical log.
//  - Now      → actively being built. 2-4 items max, weeks horizon.
//  - Next     → committed but not started. Quarter+ horizon.
//
// "Later / exploring" intentionally absent — promising vague future
// work erodes trust. Put it in /changelog "What's next" if/when it
// firms up.

type Item = { title: string; desc: string };

const SHIPPED: Item[] = [
  {
    title: "Treasury sync across 6 chains",
    desc: "Ethereum, Polygon, Arbitrum, Base, Optimism, Solana. Wallet balances, inflows, outflows pulled on a monthly schedule.",
  },
  {
    title: "AI-written investor narrative",
    desc: "Monthly executive summary, wins, treasury operations, looking-ahead — drafted from on-chain data and your milestones.",
  },
  {
    title: "Public investor view",
    desc: "Investors open one link from email and read the full report — KPI tiles, treasury composition, expense breakdown — without an account.",
  },
  {
    title: "Custom report branding",
    desc: "Set your logo and accent color once; every PDF and investor-view page picks it up.",
  },
  {
    title: "Token contract autofill",
    desc: "Paste a contract address; we prefill description, website, GitHub org, and token symbol from CoinGecko.",
  },
  {
    title: "Per-investor engagement tracking",
    desc: "See which investor opened and clicked each report, how many times, and when — not just aggregate counts.",
  },
  {
    title: "Inline milestone editing",
    desc: "Edit Looking Ahead and Milestones Completed entries row-by-row — title, status, and dates — straight from the report template.",
  },
];

const NOW: Item[] = [
  {
    title: "Investor portal",
    desc: "A token-gated home for every report so founders stop emailing PDFs by hand — investors sign in once and see the full history, with engagement tracked per recipient.",
  },
];

const NEXT: Item[] = [
  {
    title: "Read-only public API",
    desc: "For funds and platforms that want to pull projects, snapshots, and reports into internal dashboards. Per-plan rate limits.",
  },
  {
    title: "White-label PDFs",
    desc: "Reports without the Vault Brief footer for funds and reporting agencies that resell the output to their LPs.",
  },
  {
    title: "Investor Q&A on the report",
    desc: "Threaded comments on a published report so investors don't ask the same five questions across five replies.",
  },
];

type Bucket = {
  key: "shipped" | "now" | "next";
  label: string;
  badge: { bg: string; color: string };
  blurb: string;
  items: Item[];
};

const BUCKETS: Bucket[] = [
  {
    key: "shipped",
    label: "Shipped",
    badge: { bg: "rgba(0,232,123,0.12)", color: "var(--accent)" },
    blurb: "Live in production. See the full log on /changelog.",
    items: SHIPPED,
  },
  {
    key: "now",
    label: "Now",
    badge: { bg: "rgba(99,102,241,0.15)", color: "#818cf8" },
    blurb: "Actively being built. Weeks horizon.",
    items: NOW,
  },
  {
    key: "next",
    label: "Next",
    badge: { bg: "rgba(251,146,60,0.12)", color: "#fb923c" },
    blurb: "Committed but not started. Quarter+ horizon.",
    items: NEXT,
  },
];

export default function RoadmapPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      {/* Header — matches /changelog visual hierarchy so the two
          pages feel like one document split in half. */}
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 80,
          paddingBottom: 60,
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.04) 0%, transparent 100%)",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
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
            Roadmap
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
            What&apos;s shipped, what&apos;s next
          </h1>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 16,
              color: "var(--vb-muted)",
              margin: 0,
              lineHeight: 1.6,
              maxWidth: 640,
            }}
          >
            We update this page whenever the product moves. Want one of the
            Next items sooner?{" "}
            <a
              href="mailto:hello@vaultbrief.io?subject=Roadmap%20priority"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              Email us
            </a>{" "}
            and we&apos;ll bump it.
          </p>
        </div>
      </section>

      {/* Three-column grid on desktop, stacked via vb-stack-mobile on
          narrow viewports (same utility /changelog uses). */}
      <section
        className="vb-pad-x"
        style={{ paddingTop: 40, paddingBottom: 120 }}
      >
        <div
          className="vb-stack-mobile"
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 32,
          }}
        >
          {BUCKETS.map((bucket) => (
            <div
              key={bucket.key}
              style={{
                background: "var(--vb-card)",
                border: "1px solid var(--vb-border)",
                borderRadius: 14,
                padding: 28,
                display: "flex",
                flexDirection: "column",
                gap: 24,
              }}
            >
              <div>
                {/* h2 — the page h1 was otherwise followed directly by
                    each item's h3 with no h2 in between (axe
                    heading-order, moderate). This badge is the natural
                    section heading for its bucket; visual style
                    unchanged, just a semantic tag swap. */}
                <h2
                  style={{
                    display: "inline-block",
                    padding: "4px 12px",
                    margin: 0,
                    background: bucket.badge.bg,
                    color: bucket.badge.color,
                    borderRadius: 100,
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 14,
                  }}
                >
                  {bucket.label}
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: "var(--vb-dim)",
                    margin: 0,
                    lineHeight: 1.55,
                  }}
                >
                  {bucket.blurb}
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 22,
                }}
              >
                {bucket.items.map((item) => (
                  <div key={item.title}>
                    <h3
                      style={{
                        fontFamily:
                          "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                        fontSize: 15,
                        fontWeight: 600,
                        color: "var(--vb-text)",
                        margin: "0 0 6px",
                        lineHeight: 1.35,
                      }}
                    >
                      {item.title}
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        fontSize: 13.5,
                        color: "var(--vb-muted)",
                        lineHeight: 1.6,
                        margin: 0,
                      }}
                    >
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>

              {bucket.key === "shipped" && (
                <Link
                  href="/changelog"
                  style={{
                    marginTop: "auto",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: "var(--accent)",
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  See full changelog →
                </Link>
              )}
            </div>
          ))}
        </div>

        {/* Disclaimer — same honesty principle as /changelog: dates
            are forecasts, not commitments. */}
        <p
          style={{
            maxWidth: 1100,
            margin: "48px auto 0",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "var(--vb-dim)",
            lineHeight: 1.6,
            textAlign: "center",
          }}
        >
          Items move from Next → Now → Shipped as we build. Order within a
          column reflects current priority, not strict sequence.
        </p>
      </section>
    </div>
  );
}
