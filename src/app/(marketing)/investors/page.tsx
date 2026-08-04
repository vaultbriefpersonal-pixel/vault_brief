import type { Metadata } from "next";
import Link from "next/link";

const TITLE = "Investor Reporting — Vault Brief";
const DESC =
  "Turn monthly treasury activity and GitHub progress into a report your investors actually open — reviewed before it sends, exportable as PDF or a shareable link.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  openGraph: { title: TITLE, description: DESC, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

// Every claim on this page maps to a shipped mechanism, same standard as
// /grants: treasury sync, GitHub activity, AI narrative, PDF export, token
// metrics, review-before-send, per-recipient engagement tracking, custom
// branding, and the public /r/[reportId] view are all real and confirmed
// against the code before writing this copy. No invented chain count
// beyond the real 6, no invented price, no aspirational feature.

const AUTOMATED: { title: string; desc: string }[] = [
  {
    title: "Treasury overview and composition",
    desc: "Balances across every connected wallet, broken down by chain and by asset — native token, stablecoins, and everything else — so an investor sees composition, not just a single total.",
  },
  {
    title: "Burn, runway, and inflows/outflows",
    desc: "Burn rate uses a trailing average when one is available, labelled with how many periods it covers. Runway never leads with the total-treasury figure when the project holds its own token — a DAO can't sell its own token at size without moving the price against itself, so the liquid-reserves figure is the one reported as the conservative, actionable number.",
  },
  {
    title: "GitHub activity, folded into the narrative",
    desc: "Commits, merged PRs, contributors, and releases for the period, read alongside the treasury numbers rather than as a disconnected engineering appendix.",
  },
  {
    title: "Token metrics",
    desc: "Price, market cap, holder count, and supply-related figures, where a token exists — pulled from on-chain and market data providers rather than typed in by hand.",
  },
  {
    title: "An AI-written executive summary — reviewed, not auto-sent",
    desc: "The narrative is generated from your source data and validated against it, but every report starts as a draft. A founder reviews and can edit it before it's marked sent — nothing goes to an investor automatically.",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Do investors need an account?",
    a: "No. Export a PDF and send it directly, or share the public report link — investors don't need to sign up or log in to view it.",
  },
  {
    q: "Can we review before it sends?",
    a: "Yes, always. Every report is generated as a draft. A founder reviews the narrative and figures, edits if needed, and only then marks it sent or shares the link — there's no path that sends a report automatically.",
  },
  {
    q: "Can we brand it?",
    a: "Yes. Reports support a custom logo and accent color, applied to both the PDF export and the public report page, so it reads as your report rather than a generic template.",
  },
];

const sectionLabel =
  "text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--accent)] mb-3 font-[family-name:var(--font-inter)]";
const h2Class =
  "font-[family-name:var(--font-space-grotesk)] text-[clamp(28px,3.6vw,40px)] font-bold text-[var(--vb-text)] tracking-[-0.03em] m-0";
const bodyClass =
  "font-[family-name:var(--font-inter)] text-[15px] leading-[1.7] text-[var(--vb-muted)]";
const cardClass =
  "bg-[var(--vb-card)] border border-[var(--vb-border)] rounded-[14px] p-7";

export default function InvestorsPage() {
  return (
    <div className="pt-[72px]">
      {/* Hero */}
      <section className="vb-pad-x" style={{ paddingTop: 100, paddingBottom: 72 }}>
        <div className="mx-auto max-w-[820px] text-center">
          <p className={`${sectionLabel} inline-block`}>Investor reporting</p>
          <h1 className="font-[family-name:var(--font-space-grotesk)] text-[clamp(36px,5vw,52px)] font-bold text-[var(--vb-text)] tracking-[-0.035em] m-0 mb-4">
            The update your investors{" "}
            <span className="gradient-text">actually open</span>
          </h1>
          <p className={`${bodyClass} mx-auto max-w-[620px] mb-9`}>
            Vault Brief turns your monthly treasury activity and GitHub
            progress into a report — built for teams answering to
            investors, not a grant program.{" "}
            <Link href="/grants" className="text-[var(--accent)] underline">
              Reporting on a grant instead?
            </Link>
          </p>
          <div className="flex flex-wrap justify-center gap-3.5">
            <Link href="/login" className="btn-primary">
              Get started free
            </Link>
            <Link href="/demo" className="btn-secondary">
              See a demo report
            </Link>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="vb-pad-x" style={{ paddingBottom: 72 }}>
        <div className={`${cardClass} mx-auto max-w-[820px]`}>
          <h2 className={`${h2Class} mb-4`} style={{ fontSize: "clamp(24px,3vw,30px)" }}>
            Investors want a consistent signal, not a scramble
          </h2>
          <p className={`${bodyClass} mb-3`}>
            Investors expect a steady monthly update, not a scramble to pull
            numbers together before a board meeting. Compiling explorer
            balances, GitHub stats, and a written narrative by hand every
            month works for one investor relationship — it doesn&apos;t scale
            past that.
          </p>
          <p className={bodyClass} style={{ margin: 0 }}>
            Vault Brief automates the compiling so the only thing left to do
            is review.
          </p>
        </div>
      </section>

      {/* What's automated */}
      <section className="vb-pad-x" style={{ paddingBottom: 72 }}>
        <div className="mx-auto max-w-[960px]">
          <div className="text-center mb-10">
            <p className={sectionLabel}>What&apos;s automated</p>
            <h2 className={h2Class}>Built from what investors actually check</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {AUTOMATED.map((item) => (
              <div key={item.title} className={cardClass}>
                <h3 className="font-[family-name:var(--font-space-grotesk)] text-[17px] font-semibold text-[var(--vb-text)] m-0 mb-2.5">
                  {item.title}
                </h3>
                <p className={bodyClass} style={{ margin: 0 }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Delivery */}
      <section className="vb-pad-x" style={{ paddingBottom: 72 }}>
        <div className="mx-auto max-w-[960px]">
          <div className="text-center mb-10">
            <p className={sectionLabel}>Delivery</p>
            <h2 className={h2Class}>However your investors want it</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className={cardClass}>
              <h3 className="font-[family-name:var(--font-space-grotesk)] text-[17px] font-semibold text-[var(--vb-text)] m-0 mb-2.5">
                PDF or a shareable link
              </h3>
              <p className={bodyClass} style={{ margin: 0 }}>
                Export a branded PDF, or share the public report link
                directly — no account or login required on the investor&apos;s
                side to view it.
              </p>
            </div>
            <div className={cardClass}>
              <h3 className="font-[family-name:var(--font-space-grotesk)] text-[17px] font-semibold text-[var(--vb-text)] m-0 mb-2.5">
                Per-recipient engagement tracking
              </h3>
              <p className={bodyClass} style={{ margin: 0 }}>
                See who opened the report and who clicked through, recipient
                by recipient — not just an aggregate count across everyone it
                was sent to.
              </p>
            </div>
            <div className={cardClass}>
              <h3 className="font-[family-name:var(--font-space-grotesk)] text-[17px] font-semibold text-[var(--vb-text)] m-0 mb-2.5">
                Custom branding
              </h3>
              <p className={bodyClass} style={{ margin: 0 }}>
                Add your logo and accent color once — both the PDF export and
                the public report page pick it up automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Honesty section */}
      <section className="vb-pad-x" style={{ paddingBottom: 72 }}>
        <div className="mx-auto max-w-[820px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className={cardClass}>
              <h3 className="font-[family-name:var(--font-space-grotesk)] text-[16px] font-semibold text-[var(--vb-text)] m-0 mb-2.5">
                Chain coverage today
              </h3>
              <p className={bodyClass} style={{ margin: 0 }}>
                Six chains, no more: Ethereum, Polygon, Arbitrum, Base,
                Optimism, and Solana. We&apos;d rather state the real number
                than round up.
              </p>
            </div>
            <div className={cardClass}>
              <h3 className="font-[family-name:var(--font-space-grotesk)] text-[16px] font-semibold text-[var(--vb-text)] m-0 mb-2.5">
                Pricing
              </h3>
              <p className={bodyClass} style={{ margin: 0 }}>
                No public price yet — we&apos;re working directly with early
                teams.{" "}
                <a
                  href="mailto:hello@vaultbrief.io?subject=Investor%20reporting"
                  className="text-[var(--accent)] underline"
                >
                  Contact us
                </a>{" "}
                and we&apos;ll talk through what you need.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="vb-pad-x" style={{ paddingBottom: 96 }}>
        <div className="mx-auto max-w-[720px]">
          <div className="text-center mb-10">
            <p className={sectionLabel}>FAQ</p>
            <h2 className={h2Class}>Common questions</h2>
          </div>
          <div className="flex flex-col gap-2">
            {FAQS.map((item) => (
              <details
                key={item.q}
                className="border-b border-[var(--vb-border)] py-4 group"
              >
                <summary className="cursor-pointer list-none font-[family-name:var(--font-inter)] text-[15.5px] font-medium text-[var(--vb-text)] marker:content-none">
                  {item.q}
                </summary>
                <p className={`${bodyClass} mt-3 pr-2`} style={{ margin: 0 }}>
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="vb-section-cta text-center"
        style={{ background: "var(--vb-alt)" }}
      >
        <h2 className={h2Class} style={{ marginBottom: 16 }}>
          Stop compiling investor updates by hand
        </h2>
        <p className={`${bodyClass} mx-auto max-w-[520px] mb-8`}>
          Connect your treasury wallets and GitHub org, and generate a report
          your investors will actually read.
        </p>
        <div className="flex flex-wrap justify-center gap-3.5">
          <Link href="/login" className="btn-primary">
            Get started free
          </Link>
          <Link href="/demo" className="btn-secondary">
            See a demo report
          </Link>
        </div>
      </section>
    </div>
  );
}
