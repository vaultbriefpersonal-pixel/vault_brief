import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, Cable, Sparkles, Send } from "lucide-react";
import { Nav } from "@/components/marketing/Nav";
import { Footer } from "@/components/marketing/Footer";
import { FAQ } from "@/components/marketing/FAQ";
import { ChatWidget } from "@/components/marketing/ChatWidget";
import { db } from "@/server/db";
import { treasurySnapshots } from "@/server/db/schema";
import { sql } from "drizzle-orm";
import { formatUsd } from "@/lib/utils";

// Icon-key → lucide component. Keeps the STEPS constant plain-data while
// the render block looks up the right glyph. New steps just add a key.
const STEP_ICONS = {
  connect: Wallet,
  sync: Cable,
  ai: Sparkles,
  send: Send,
} as const;

export const metadata: Metadata = {
  title: "Vault Brief — Automated Reports for Web3 Teams",
  description:
    "Generate monthly treasury reports from wallets, GitHub activity, and token metrics. Vault Brief turns raw on-chain data into reports you can review, export, and send — to investors or a grant funder.",
};

// Re-render the homepage at most every 5 minutes so the stat strip's
// counts grow without hammering the DB on every visit. Static otherwise.
export const revalidate = 300;

// Six feature cards: the production capabilities of the platform. Copy
// straight from the v2 copy pack — explicitly note the read-only-only
// posture on treasury tracking so visitors don't worry about wallet
// signing, and keep "review before send" prominent so the product
// reads as a real reporting tool, not a fire-and-forget automation.
const FEATURES_AVAILABLE = [
  {
    icon: "💼",
    title: "Treasury tracking",
    desc: "Track balances, inflows, outflows, and runway across project wallets. Use public wallet addresses only. No private keys. No signing access.",
  },
  {
    icon: "💻",
    title: "GitHub activity",
    desc: "Summarize commits, merged PRs, contributors, releases, and development progress for investor updates.",
  },
  {
    icon: "🤖",
    title: "AI generated report narrative",
    desc: "Turn treasury and development data into a clear investor report with executive summary, monthly changes, risks, and next steps.",
  },
  {
    icon: "📄",
    title: "PDF export",
    desc: "Export a polished report that can be shared with investors, internal stakeholders, DAO contributors, or fund partners.",
  },
  {
    icon: "📊",
    title: "Token metrics",
    desc: "Include token price, market cap, holder count, liquidity context, and supply-related metrics where available.",
  },
  {
    icon: "✅",
    title: "Review before send",
    desc: "You stay in control. Reports are reviewed before sending or exporting.",
  },
];

// Compact "Available now" list — same shipped capabilities as the cards
// above, condensed for the at-a-glance reference block. Demo report
// preview is included here because it's a customer-facing capability
// even though it's not a card-worthy feature.
const AVAILABLE_NOW = [
  "Treasury wallet tracking",
  "GitHub activity summaries",
  "AI generated report narrative",
  "PDF export",
  "Demo report preview",
  "Manual review before send",
  // Resend webhook (`email.opened`, `email.clicked`) increments
  // `reports.openedCount` and `reports.clickedCount`; the reports
  // list UI surfaces "Sent to X · Y opened · Z clicked". Per-recipient
  // breakdown is roadmap; aggregate engagement is shipped.
  "Open and click tracking",
];

const FEATURES_COMING = [
  { icon: "🌐", title: "Investor portal", desc: "Secure portal access for investors and stakeholders without sending PDFs manually." },
  { icon: "🔌", title: "API access", desc: "Read-only programmatic access to your reports for fund or platform integrations." },
  { icon: "🎨", title: "White label reports", desc: "Custom-branded PDFs without the Vault Brief footer for funds and agencies." },
  { icon: "⏰", title: "Advanced monthly automation", desc: "Schedules, multi-recipient routing, and conditional report sends." },
];

// "Four steps to a report" — copy aligned with the v2 brief. Stays
// product-focused (not engineering-stack-focused like the previous
// version) so the funnel reads as workflow rather than architecture.
const STEPS = [
  {
    num: "01",
    iconKey: "connect" as const,
    title: "Connect data sources",
    desc:
      "Add treasury wallets, a GitHub org, token contract details, and basic project context.",
  },
  {
    num: "02",
    iconKey: "sync" as const,
    title: "Vault Brief pulls the data",
    desc:
      "The system collects balances, inflows, outflows, token metrics, and development activity from your connected sources.",
  },
  {
    num: "03",
    iconKey: "ai" as const,
    title: "Generate the report",
    desc:
      "Vault Brief turns the data into a structured report with treasury overview, runway, GitHub progress, and executive summary.",
  },
  {
    num: "04",
    iconKey: "send" as const,
    title: "Review, export, send",
    desc:
      "Review the report, edit if needed, export PDF, and share it with investors, funders, or stakeholders.",
  },
];

const STATS_FALLBACK = { totalTrackedUsd: 0 };

// Cheap signal that the env is using the .env.example placeholder URL —
// CI / preview deploys often fall in this bucket. Skip the network round-
// trip rather than letting it fail and dump a stack into the logs.
function dbConfigured(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return Boolean(url) && !url.includes("placeholder");
}

let warnedFallback = false;

/**
 * Public production stats for the landing.
 *
 * Earlier version exposed raw counts (wallets / snapshots / reports). For a
 * young product those numbers are small and hurt conversion — visitors
 * read "4 reports generated" as "nobody uses this." Instead we surface a
 * single defensive metric — total USD currently under treasury watch
 * across all latest-per-project snapshots. That number is naturally large
 * (one DAO treasury alone is tens of millions) and answers the actual
 * question on a CFO's mind: "is this product trusted with real money?"
 *
 * The other landing tiles are descriptors (chains supported, daily
 * sync cadence, output format) so we never have to "show 4 reports."
 */
async function loadPublicStats() {
  if (!dbConfigured()) return STATS_FALLBACK;
  try {
    // Sum total_balance_usd from the latest snapshot per project. Using
    // DISTINCT ON keeps it a single query — DB-side aggregation, no
    // application-level loop over projects.
    //
    // db.execute() on the Neon HTTP adapter returns NeonHttpQueryResult,
    // not a plain array. Cast through `unknown` and read `.rows` to keep
    // the call site readable without fighting drizzle's generic.
    const result = (await db.execute(sql`
      SELECT COALESCE(SUM(total_balance_usd), 0)::numeric AS total
      FROM (
        SELECT DISTINCT ON (project_id) total_balance_usd
        FROM ${treasurySnapshots}
        ORDER BY project_id, snapshot_date DESC
      ) AS latest
    `)) as unknown as { rows: { total: string | number | null }[] };
    const total = Number(result.rows?.[0]?.total ?? 0);
    return { totalTrackedUsd: Number.isFinite(total) ? total : 0 };
  } catch (err) {
    if (!warnedFallback) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[landing] loadPublicStats fallback: ${msg.split("\n")[0]}`);
      warnedFallback = true;
    }
    return STATS_FALLBACK;
  }
}

// Compact USD formatter lives in src/lib/utils.ts as `formatUsd()` —
// same $K / $M / $B scale logic. Use that to avoid drift between the
// landing stats tile and the report widget tiles.

const TOOL_STACK: Array<{ name: string; color: string }> = [
  // Alchemy's brand colour is near-black (#0C0C0E) which disappears
  // against our dark background. Use their signature light-blue
  // accent instead so the chip is legible in the trust-bar row.
  { name: "Alchemy", color: "#85B5FF" },
  { name: "Dune", color: "#FE6F37" },
  { name: "Helius", color: "#B8FF36" },
  { name: "OpenRouter", color: "#10A37F" },
  { name: "Resend", color: "#FFFFFF" },
  { name: "Neon", color: "#00E599" },
  { name: "Vercel", color: "#FFFFFF" },
];

// "Input → report" pillar columns. Drives the new visual section that
// lets a visitor parse the product in 5 seconds without reading copy.
const INPUT_TO_REPORT = {
  inputs: [
    { label: "Wallets", note: "Treasury addresses across 6 chains" },
    { label: "GitHub org", note: "Commits, PRs, contributors, releases" },
    { label: "Token contract", note: "Price, market cap, holder count" },
    { label: "Project context", note: "Milestones, funding, asks, governance" },
  ],
  outputs: [
    { label: "Treasury overview", note: "Balances + month-over-month change" },
    { label: "Burn and runway", note: "Net outflow + months at current pace" },
    { label: "GitHub progress", note: "Active dev signal for the period" },
    { label: "Executive summary", note: "AI-written, validated against source data" },
    { label: "PDF export", note: "Branded, investor-ready, click to download" },
  ],
};

// Audience fork cards — the section that makes the nav's parallel
// "For Grants" / "For Investors" structure discoverable from the
// homepage itself.
const AUDIENCE_FORK: { title: string; desc: string; href: string }[] = [
  {
    title: "For investors",
    desc: "Turn treasury activity and GitHub progress into a monthly update investors actually open — reviewed before it sends, exportable as PDF or a shareable link.",
    href: "/investors",
  },
  {
    title: "For grant funders",
    desc: "Account for a grant you received — fund usage, milestone progress, and leftover funds, built for the report a funder checks against.",
    href: "/grants",
  },
];

export default async function LandingPage() {
  const stats = await loadPublicStats();
  return (
    <div style={{ background: "var(--vb-bg)", minHeight: "100dvh" }}>
      <Nav />

      {/* <main> wrapper — axe-core's `landmark-one-main` + `region`
          rules expect every page's primary content to live inside
          a single <main>. Without it the entire landing renders as
          orphan content. Wrapping all sections in <main> drops 33
          `region` violations and the `landmark-one-main` failure in
          one go. */}
      <main>
      {/* Hero */}
      <section
        className="vb-section-hero"
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          position: "relative",
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.06) 0%, transparent 60%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.03,
            backgroundImage:
              "linear-gradient(#888 1px, transparent 1px), linear-gradient(90deg, #888 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            pointerEvents: "none",
          }}
        />

        <div className="animate-fade-up" style={{ position: "relative", zIndex: 1 }}>
          {/* Beta badge: honest framing per the early-access strategy. */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(0,232,123,0.12)",
              border: "1px solid rgba(0,232,123,0.3)",
              borderRadius: 100,
              padding: "6px 16px",
              marginBottom: 32,
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--accent)",
              fontWeight: 500,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#00e87b",
              }}
            />
            Automated wallet and GitHub reporting for Web3 teams
          </div>

          <h1
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: "clamp(40px, 5.5vw, 76px)",
              lineHeight: 1.05,
              color: "var(--vb-text)",
              maxWidth: 800,
              margin: "0 auto 24px",
              letterSpacing: "-0.035em",
            }}
          >
            Reports that get read
            <br />
            <span className="gradient-text">for Web3 teams</span>
          </h1>

          <p
            className="vb-hero-copy"
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              lineHeight: 1.6,
              color: "var(--vb-muted)",
              maxWidth: 640,
              margin: "0 auto 36px",
            }}
          >
            Generate monthly treasury reports from wallets, GitHub activity,
            token metrics, and project context. Vault Brief turns raw Web3
            data into a report ready for an investor update or a grant
            funder&apos;s next check-in — reviewed, exported, and sent by you.
          </p>

          <div
            style={{
              display: "flex",
              gap: 14,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            {/* Demo first — visitors should see output before committing.
                Get-started is the secondary CTA. */}
            <Link href="/demo" className="btn-primary">
              Generate Demo Report
            </Link>
            <Link href="/login" className="btn-secondary">
              Get started free
            </Link>
          </div>

          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: "var(--vb-dim)",
              margin: "18px auto 0",
              maxWidth: 480,
              lineHeight: 1.5,
            }}
          >
            Free to use. Preview a demo report before connecting your own data.
          </p>
        </div>

        {/* Mock dashboard card */}
        <div
          className="animate-fade-up-delay"
          style={{
            marginTop: 72,
            width: "100%",
            maxWidth: 900,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              background: "var(--vb-card)",
              borderRadius: 16,
              border: "1px solid var(--vb-border)",
              padding: 32,
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 24,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--vb-dim)",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    marginBottom: 4,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {`Monthly Report — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    color: "var(--vb-text)",
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontWeight: 600,
                  }}
                >
                  Treasury Overview
                </div>
              </div>
              <span
                style={{
                  padding: "5px 12px",
                  background: "rgba(0,232,123,0.12)",
                  color: "var(--accent)",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                }}
              >
                Ready to Send
              </span>
            </div>

            <div className="vb-grid-4" style={{ gap: 16 }}>
              {[
                { label: "Total Balance", val: "$2.4M", change: "+3.2%" },
                { label: "Monthly Burn", val: "$185K", change: "-12%" },
                { label: "Runway", val: "13 months", change: "+2mo" },
                { label: "Token Price", val: "$0.84", change: "+18.5%" },
              ].map((d) => (
                <div
                  key={d.label}
                  style={{
                    background: "var(--vb-bg)",
                    borderRadius: 10,
                    padding: "18px 16px",
                    border: "1px solid var(--vb-border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--vb-dim)",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      marginBottom: 8,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {d.label}
                  </div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: "var(--vb-text)",
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    }}
                  >
                    {d.val}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: d.change.startsWith("+") ? "#00e87b" : "#f87171",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      marginTop: 4,
                      fontWeight: 500,
                    }}
                  >
                    {d.change} vs last month
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Input → report — the 5-second-comprehension section. Two columns
          read like a state diagram: stuff you connect on the left becomes
          the structured report on the right. */}
      <section className="vb-section" style={{ background: "var(--vb-alt)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--accent)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 600,
              }}
            >
              From inputs to reports
            </p>
            <h2
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: "clamp(28px, 3.6vw, 40px)",
                fontWeight: 700,
                color: "var(--vb-text)",
                letterSpacing: "-0.03em",
                margin: "0 0 14px",
              }}
            >
              From raw Web3 data to investor reports
            </h2>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 15,
                color: "var(--vb-muted)",
                lineHeight: 1.65,
                maxWidth: 720,
                margin: "0 auto",
              }}
            >
              Founders should not spend hours copying balances from explorers,
              GitHub stats from repos, and token data from dashboards. Vault
              Brief brings those inputs together and turns them into a
              structured monthly report.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              gap: 24,
              alignItems: "stretch",
            }}
          >
            <PillarColumn
              kind="input"
              title="You connect"
              items={INPUT_TO_REPORT.inputs}
            />

            <div
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                color: "var(--accent)",
                opacity: 0.6,
              }}
            >
              →
            </div>

            <PillarColumn
              kind="output"
              title="Your report"
              items={INPUT_TO_REPORT.outputs}
            />
          </div>
        </div>
      </section>

      {/* Audience fork — makes the two dedicated pages discoverable from
          the homepage itself, not just from the nav. Same card pattern
          as the feature cards one section up: typed constant array +
          small presentational component. */}
      <section className="vb-section">
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--accent)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 600,
              }}
            >
              Built for two audiences
            </p>
            <h2
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: "clamp(28px, 3.6vw, 40px)",
                fontWeight: 700,
                color: "var(--vb-text)",
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              Who are you reporting to?
            </h2>
          </div>

          <div className="vb-grid-2" style={{ gap: 20 }}>
            {AUDIENCE_FORK.map((a) => (
              <AudienceCard key={a.title} {...a} />
            ))}
          </div>
        </div>
      </section>

      {/* Logo bar */}
      <section
        className="vb-section-sm"
        style={{
          textAlign: "center",
          borderTop: "1px solid var(--vb-border)",
          borderBottom: "1px solid var(--vb-border)",
        }}
      >
        <p
          style={{
            fontSize: 12,
            color: "var(--vb-dim)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            marginBottom: 32,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 500,
          }}
        >
          Built on the stack you already trust
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 28,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {TOOL_STACK.map((t) => (
            <span
              key={t.name}
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: 14,
                fontWeight: 600,
                color: t.color,
                letterSpacing: "-0.01em",
                padding: "8px 16px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {t.name}
            </span>
          ))}
        </div>
      </section>

      {/* Features — six product capability cards. Coming-soon block lives
          underneath so visitors see the roadmap explicitly. */}
      <section
        id="features"
        className="vb-section"
        style={{ maxWidth: 1200, margin: "0 auto" }}
      >
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <p
            style={{
              fontSize: 13,
              color: "var(--accent)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 600,
            }}
          >
            Built for active Web3 teams
          </p>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(32px, 4vw, 44px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              margin: 0,
            }}
          >
            Production-ready reporting for investors and grant funders
          </h2>
        </div>

        <div className="vb-grid-3" style={{ gap: 16 }}>
          {FEATURES_AVAILABLE.map((f) => (
            <FeatureCard key={f.title} {...f} status="available" />
          ))}
        </div>

        {/* Compact two-column reference: Available now vs. On roadmap.
            Sits between the rich cards and the detailed roadmap so a
            visitor who skim-reads still gets the shipped/planned signal.
            "On roadmap" replaces the older "Coming soon" — same meaning,
            less salesy, doesn't compound with the badge-cards below. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            marginTop: 56,
          }}
        >
          <CapabilityList
            kind="available"
            title="Available now"
            items={AVAILABLE_NOW}
          />
          <CapabilityList
            kind="coming"
            title="On roadmap"
            items={FEATURES_COMING.map((f) => f.title)}
          />
        </div>

        {/* The detailed "On the roadmap" cards-grid lived here. Removed
            because the compact `CapabilityList kind="coming"` block right
            above already lists the same items, and stacking both made
            the page read as "look at all the things we haven't built."
            Full roadmap with descriptions lives on the dedicated
            /roadmap page for visitors who want detail. */}
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <Link
            href="/roadmap"
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            See the full roadmap →
          </Link>
        </div>
      </section>

      {/* How It Works */}
      <section className="vb-section" style={{ background: "var(--vb-alt)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 72 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--accent)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 600,
              }}
            >
              How it works
            </p>
            <h2
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: "clamp(32px, 4vw, 44px)",
                fontWeight: 700,
                color: "var(--vb-text)",
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              Four steps to a report
            </h2>
          </div>

          <div className="vb-grid-4" style={{ gap: 24 }}>
            {STEPS.map((s) => {
              const Icon = STEP_ICONS[s.iconKey];
              return (
                <div key={s.num}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: "rgba(0,232,123,0.08)",
                        border: "1px solid rgba(0,232,123,0.18)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon
                        size={18}
                        color="var(--accent)"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </div>
                    <span
                      // Step numbers 01-04. opacity:0.4 was muting
                      // the accent green to #0a673b ≈ 2.7:1 on
                      // var(--vb-alt) — axe-contrast fail. opacity:0.7
                      // is the lightest we can go and still clear the
                      // 4.5:1 threshold while keeping the "ghosted
                      // number" visual treatment.
                      style={{
                        fontFamily:
                          "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                        fontSize: 28,
                        fontWeight: 700,
                        color: "var(--accent)",
                        opacity: 0.7,
                        lineHeight: 1,
                      }}
                    >
                      {s.num}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                      fontSize: 20,
                      fontWeight: 600,
                      color: "var(--vb-text)",
                      margin: "0 0 10px",
                    }}
                  >
                    {s.title}
                  </h3>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 15,
                      color: "var(--vb-muted)",
                      lineHeight: 1.6,
                      margin: 0,
                    }}
                  >
                    {s.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Production metrics — live counts of work the platform is doing.
          Reframes the section away from "early-access numbers" toward a
          straightforward "here's the live system" production story. */}
      <section className="vb-section" style={{ background: "var(--vb-alt)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <p
              style={{
                fontSize: 13,
                color: "var(--accent)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontWeight: 600,
              }}
            >
              Production usage
            </p>
            <h2
              style={{
                fontFamily:
                  "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                fontSize: "clamp(32px, 4vw, 44px)",
                fontWeight: 700,
                color: "var(--vb-text)",
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              Real usage, updated from production
            </h2>
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 15,
                color: "var(--vb-muted)",
                marginTop: 16,
                maxWidth: 620,
                margin: "16px auto 0",
                lineHeight: 1.6,
              }}
            >
              Live treasury value under watch, refreshed from production. The
              dollar figure aggregates the latest snapshot of every connected
              project — it&apos;s what the system is actually tracking right
              now, not a marketing claim.
            </p>
          </div>

          {/* Defensive metrics — see loadPublicStats() doc-comment. We
              previously had a 4-up grid with raw counts (wallets / snapshots
              / reports). Those numbers are small for a new product and
              hurt conversion. Replaced with one anchor metric (USD tracked)
              plus three text descriptors. The grid now wraps to whatever
              fits — three rows on mobile, four-up on wide desktop. */}
          <div className="vb-grid-4" style={{ gap: 20 }}>
            {[
              {
                value: formatUsd(stats.totalTrackedUsd),
                label: "Treasury under watch",
                note: "sum of latest snapshots",
              },
              {
                value: "6",
                label: "Chains supported",
                note: "Ethereum, Polygon, Arbitrum, Base, Optimism, Solana",
              },
              {
                // Auto-sync cron runs monthly (1st @ 06:00 UTC); on-demand
                // sync is available any time from the dashboard.
                value: "Monthly",
                label: "Sync cadence",
                note: "auto + on-demand",
              },
              {
                value: "PDF",
                label: "Output format",
                note: "investor-ready, branded",
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: "var(--vb-card)",
                  borderRadius: 14,
                  border: "1px solid var(--vb-border)",
                  padding: "28px 24px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 36,
                    fontWeight: 700,
                    color: "var(--accent)",
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                  }}
                >
                  {s.value}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    marginTop: 10,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 12,
                    color: "var(--vb-dim)",
                    marginTop: 4,
                  }}
                >
                  {s.note}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <FAQ />

      {/* CTA Banner — final conversion. Demo-first to mirror the hero. */}
      <section
        className="vb-section-cta"
        style={{
          textAlign: "center",
          background: "var(--vb-alt)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,232,123,0.12) 0%, transparent 70%)",
            filter: "blur(60px)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(32px, 4vw, 44px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              margin: "0 0 16px",
            }}
          >
            Stop copy-pasting from Etherscan
          </h2>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 17,
              color: "var(--vb-muted)",
              maxWidth: 540,
              margin: "0 auto 36px",
              lineHeight: 1.6,
            }}
          >
            Connect a wallet and generate your first report in minutes — for
            investors or a grant funder. Schedule recurring monthly reports
            after review.
          </p>
          <Link
            href="/demo"
            className="btn-primary"
            style={{ padding: "16px 40px" }}
          >
            Generate Demo Report
          </Link>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 12,
              color: "var(--vb-dim)",
              marginTop: 18,
            }}
          >
            Free to use.
          </p>
        </div>
      </section>
      </main>

      <Footer />
      <ChatWidget />
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function AudienceCard({
  title,
  desc,
  href,
}: {
  title: string;
  desc: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="card-hover"
      style={{
        display: "block",
        background: "var(--vb-card)",
        borderRadius: 14,
        border: "1px solid var(--vb-border)",
        padding: 32,
        textDecoration: "none",
      }}
    >
      <h3
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 20,
          fontWeight: 600,
          color: "var(--vb-text)",
          margin: "0 0 10px",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 15,
          color: "var(--vb-muted)",
          lineHeight: 1.6,
          margin: "0 0 16px",
        }}
      >
        {desc}
      </p>
      <span
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--accent)",
        }}
      >
        Learn more →
      </span>
    </Link>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
  status,
}: {
  icon: string;
  title: string;
  desc: string;
  status: "available" | "coming";
}) {
  const isAvailable = status === "available";
  return (
    <div
      className="card-hover"
      style={{
        background: "var(--vb-card)",
        borderRadius: 14,
        border: `1px solid ${isAvailable ? "var(--vb-border)" : "rgba(255,255,255,0.06)"}`,
        padding: 32,
        opacity: isAvailable ? 1 : 0.85,
        position: "relative",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "3px 8px",
          borderRadius: 100,
          background: isAvailable
            ? "rgba(0,232,123,0.12)"
            : "rgba(255,255,255,0.05)",
          color: isAvailable ? "var(--accent)" : "var(--vb-dim)",
          border: `1px solid ${isAvailable ? "rgba(0,232,123,0.3)" : "rgba(255,255,255,0.08)"}`,
        }}
      >
        {isAvailable ? "Available" : "Roadmap"}
      </span>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: isAvailable
            ? "rgba(0,232,123,0.12)"
            : "rgba(255,255,255,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          marginBottom: 18,
        }}
      >
        {icon}
      </div>
      <h3
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 19,
          fontWeight: 600,
          color: "var(--vb-text)",
          margin: "0 0 8px",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 15,
          color: "var(--vb-muted)",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {desc}
      </p>
    </div>
  );
}

function CapabilityList({
  kind,
  title,
  items,
}: {
  kind: "available" | "coming";
  title: string;
  items: string[];
}) {
  const isAvail = kind === "available";
  return (
    <div
      style={{
        background: "var(--vb-card)",
        border: `1px solid ${isAvail ? "rgba(0,232,123,0.18)" : "var(--vb-border)"}`,
        borderRadius: 12,
        padding: 22,
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          color: isAvail ? "var(--accent)" : "var(--vb-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 600,
          margin: "0 0 14px",
        }}
      >
        {title}
      </p>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {items.map((it) => (
          <li
            key={it}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              color: isAvail ? "var(--vb-text)" : "var(--vb-muted)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background: isAvail
                  ? "rgba(0,232,123,0.18)"
                  : "rgba(255,255,255,0.05)",
                color: isAvail ? "var(--accent)" : "var(--vb-dim)",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {isAvail ? "✓" : "•"}
            </span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PillarColumn({
  kind,
  title,
  items,
}: {
  kind: "input" | "output";
  title: string;
  items: { label: string; note: string }[];
}) {
  return (
    <div
      style={{
        background: "var(--vb-card)",
        border: "1px solid var(--vb-border)",
        borderRadius: 14,
        padding: 24,
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          color: kind === "output" ? "var(--accent)" : "var(--vb-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 600,
          margin: "0 0 6px",
        }}
      >
        {kind === "output" ? "Output" : "Input"}
      </p>
      <h3
        style={{
          fontFamily:
            "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 22,
          fontWeight: 700,
          color: "var(--vb-text)",
          margin: "0 0 18px",
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {items.map((it) => (
          <li
            key={it.label}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "10px 12px",
              background:
                kind === "output"
                  ? "rgba(0,232,123,0.05)"
                  : "rgba(255,255,255,0.02)",
              border: `1px solid ${kind === "output" ? "rgba(0,232,123,0.18)" : "var(--vb-border)"}`,
              borderRadius: 8,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: kind === "output" ? "var(--accent)" : "var(--vb-muted)",
                marginTop: 1,
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 12,
                opacity: 0.8,
              }}
            >
              {kind === "output" ? "↳" : "•"}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily:
                    "var(--font-inter), Inter, sans-serif",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--vb-text)",
                }}
              >
                {it.label}
              </div>
              <div
                style={{
                  fontFamily:
                    "var(--font-inter), Inter, sans-serif",
                  fontSize: 12,
                  color: "var(--vb-dim)",
                  marginTop: 2,
                  lineHeight: 1.5,
                }}
              >
                {it.note}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
