import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Documentation — Vault Brief",
  description:
    "How Vault Brief works. Connecting wallets, generating monthly reports, sharing with investors, and what data sources power each section.",
};

// /docs used to be a dedicated API waitlist page. The API itself is on
// the roadmap (see /changelog "What's next"), but funnel-wise users
// arriving here from the footer want product documentation, not an
// email-capture form. This page is the founder-facing how-it-works
// reference. Sections are scannable and short on purpose.

interface Section {
  id: string;
  title: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "what",
    title: "What Vault Brief does",
    body: (
      <>
        <p>
          Vault Brief generates monthly investor reports for Web3 teams from
          on-chain data and GitHub activity. You connect treasury wallets,
          a GitHub org, and your project context once. Every month the
          system pulls a snapshot, drafts a narrative, and lets you review
          and send a polished PDF to investors.
        </p>
        <p>
          The product is <strong>read-only</strong>. It never asks for
          private keys, seed phrases, or signing permissions. Wallets are
          identified by public addresses; balances and transactions come
          from RPC providers (Alchemy, Dune Sim, Helius).
        </p>
      </>
    ),
  },
  {
    id: "data-sources",
    title: "Data sources",
    body: (
      <ul>
        <li>
          <strong>Treasury balances and flows</strong> — Alchemy, Dune Sim,
          and Helius for Solana. Latest balance per token, inflows and
          outflows during the report period, classified into expense
          categories (payroll, infra, marketing, grants, legal, token
          sale).
        </li>
        <li>
          <strong>Token metrics</strong> — CoinGecko (price, market cap,
          holders) with CoinMarketCap as a fallback if your token is not
          listed on CG.
        </li>
        <li>
          <strong>GitHub activity</strong> — GitHub REST API. Commits,
          merged PRs, active contributors, releases. Repos are capped at
          the top 25 by recent push activity to keep within rate limits.
        </li>
        <li>
          <strong>Governance proposals</strong> — Snapshot.org for projects
          that operate a DAO space.
        </li>
        <li>
          <strong>Project context</strong> — founder-entered milestones,
          asks, partner intros, last funding round. These power the
          executive summary and &ldquo;Looking ahead&rdquo; sections.
        </li>
      </ul>
    ),
  },
  {
    id: "connecting-wallets",
    title: "Connecting wallets",
    body: (
      <>
        <p>
          From <Link href="/projects/new">/projects/new</Link>, paste a
          treasury wallet address (EVM or Solana) and pick the chain.
          That&apos;s it — no signature prompt, no extension hookup. You
          can add more wallets later under{" "}
          <code>/projects/[id]/wallets</code>.
        </p>
        <p>
          Supported chains: Ethereum, Polygon, Arbitrum, Base, Optimism, and
          Solana.
        </p>
        <p>
          <strong>Multisigs</strong> (Safe, Squads) work the same way —
          treat the multisig contract address as a treasury wallet.
        </p>
      </>
    ),
  },
  {
    id: "first-report",
    title: "Generating your first report",
    body: (
      <ol>
        <li>
          Create a project and add at least one wallet. If you have a
          token contract, fill it in — we&apos;ll prefill description,
          website, GitHub, and token symbol from CoinGecko.
        </li>
        <li>
          From the project dashboard, click{" "}
          <strong>Sync data</strong>. The system pulls a fresh snapshot
          and auto-generates a draft report based on it. This takes
          5&ndash;30 seconds depending on the wallet count.
        </li>
        <li>
          Review the report on{" "}
          <code>/projects/[id]/reports/[reportId]</code>. Every number is
          validated against the source snapshot at generation time — no
          fabricated figures — but you can still edit the markdown
          narrative inline.
        </li>
        <li>
          When the report reads correctly, click <strong>Send</strong>.
          The investor distribution drawer lets you pick recipients,
          attach a PDF, and ship it via Resend. Open and click events
          flow back into the dashboard.
        </li>
      </ol>
    ),
  },
  {
    id: "monthly-cadence",
    title: "Monthly auto-sync and report",
    body: (
      <>
        <p>
          Two scheduled jobs run on Trigger.dev once your project is
          active:
        </p>
        <ul>
          <li>
            <strong>1st of every month, 06:00 UTC</strong> — snapshot all
            active projects (balances, flows, GitHub, token metrics).
          </li>
          <li>
            <strong>3rd of every month, 08:00 UTC</strong> — draft a
            report for each project that has a fresh snapshot and no
            report for the current period. You get an email
            (&ldquo;Report ready for review&rdquo;) with a one-click link
            to the draft. Nothing is sent to investors automatically.
          </li>
        </ul>
        <p>
          You can also click <strong>Sync data</strong> any time from the
          dashboard — useful for ad-hoc investor updates or testing.
          On-demand syncs are rate-limited per project.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Sharing reports with investors",
    body: (
      <>
        <p>
          When you send a report, each investor gets a personalized email
          with a link to the public view at{" "}
          <code>/r/[reportId]</code>. The link works without an account —
          investors don&apos;t sign up for anything.
        </p>
        <p>
          Status of the report is gated on the public route. A report has
          to be flipped to <code>sent</code> before <code>/r/[id]</code>{" "}
          renders it. Drafts stay private inside your account.
        </p>
        <p>
          Open and click events are tracked back to the report row in
          your dashboard, so you can see who looked at the latest update.
        </p>
      </>
    ),
  },
  {
    id: "plan-limits",
    title: "Pricing",
    body: (
      <>
        <p>
          Vault Brief is <strong>free</strong> — a public good for the
          ecosystem. There are no paid plans, no trial window, and no
          per-account limits on projects, wallets, GitHub repos, or reports.
        </p>
        <p>
          Sign in with your email, connect your treasury and GitHub, and
          generate as many investor reports as you need. Every feature is
          available to every account.
        </p>
      </>
    ),
  },
  {
    id: "help",
    title: "Need help or want a feature?",
    body: (
      <p>
        Email{" "}
        <a href="mailto:hello@vaultbrief.io">hello@vaultbrief.io</a>{" "}
        — typical response within one business day. For security
        reports, use the same address with subject &ldquo;Security
        report&rdquo;:{" "}
        <a href="mailto:hello@vaultbrief.io?subject=Security%20report">
          hello@vaultbrief.io
        </a>
        . For API access (read-only endpoints for projects, snapshots,
        reports), it&apos;s on our{" "}
        <a href="/roadmap">roadmap</a> —{" "}
        <a href="mailto:hello@vaultbrief.io?subject=API%20access%20interest">
          drop us a line
        </a>{" "}
        to be on the early-access list.
      </p>
    ),
  },
];

export default function DocsPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      {/* Hero */}
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 100,
          paddingBottom: 60,
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.04) 0%, transparent 100%)",
        }}
      >
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
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
            Documentation
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
              lineHeight: 1.1,
            }}
          >
            How Vault Brief works
          </h1>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 17,
              color: "var(--vb-muted)",
              lineHeight: 1.65,
              margin: 0,
              maxWidth: 640,
            }}
          >
            Short, scannable reference for founders. Wallet sync, monthly
            cadence, investor distribution, plan limits — everything you
            need to know before you ship your first report.
          </p>
        </div>
      </section>

      {/* TOC + sections */}
      <section className="vb-pad-x" style={{ paddingTop: 60, paddingBottom: 100 }}>
        <div
          style={{
            maxWidth: 1000,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 48,
          }}
        >
          {/* Sticky TOC on wide viewports. Plain anchor scroll — no JS. */}
          <nav
            aria-label="Documentation sections"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              padding: "16px 20px",
              background: "var(--vb-card)",
              border: "1px solid var(--vb-border)",
              borderRadius: 12,
            }}
          >
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  color: "var(--vb-muted)",
                  textDecoration: "none",
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                {s.title}
              </a>
            ))}
          </nav>

          <div style={{ display: "flex", flexDirection: "column", gap: 56 }}>
            {SECTIONS.map((s) => (
              <article
                key={s.id}
                id={s.id}
                style={{ scrollMarginTop: 100 }}
              >
                <h2
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 24,
                    fontWeight: 700,
                    color: "var(--vb-text)",
                    letterSpacing: "-0.025em",
                    margin: "0 0 16px",
                  }}
                >
                  {s.title}
                </h2>
                <div className="vb-docs-prose">{s.body}</div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
