import type { Metadata } from "next";
import Link from "next/link";

const TITLE = "Grant Reporting — Vault Brief";
const DESC =
  "Turn treasury activity and GitHub progress into a grant report your funder actually reads — without compiling it by hand every period.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  openGraph: { title: TITLE, description: DESC, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

// Every claim on this page maps to a shipped mechanism (Stages 4-8 of the
// grant-reporting plan). Nothing here is aspirational — no chain count
// beyond the real 6, no invented price, no feature that isn't wired up.

const AUTOMATED: { title: string; desc: string }[] = [
  {
    title: "Fund usage — awarded, received, spent",
    desc: "Computed at the grant level from your tranches, not your treasury balance. We only ever show awarded vs. received (undisbursed) and received vs. spent — never a claim about what's left in the wallet, since a treasury is fungible and the opening balance isn't always known.",
  },
  {
    title: "Milestone progress with Source of Truth",
    desc: "Each milestone carries an evidence link — a transaction hash, GitHub link, dashboard URL, or address — so a funder can verify the claim themselves instead of taking the report's word for it.",
  },
  {
    title: "Leftover funds, and your plan for them",
    desc: "The leftover amount is calculated automatically from what's been received and spent. The plan for what happens to it is yours to state — that's the part a funder actually needs to hear.",
  },
  {
    title: "A standing deviation-from-plan statement",
    desc: "Every period ships an explicit statement about whether the plan changed. When nothing changed, the report says so — \"no changes to the original plan\" — rather than going quiet, which is easy to misread as something being hidden.",
  },
  {
    title: "A link back to the live dashboard",
    desc: "Every report links to the treasury dashboard it was generated from, so the document itself is never mistaken for the source of truth — the dashboard is.",
  },
];

const PRESETS: { name: string; tag: string; desc: string }[] = [
  {
    name: "Comprehensive",
    tag: "Arbitrum / STIP-shaped",
    desc: "Full financial disclosure — fund usage, milestone progress, leftover funds, deviation statement, and the dashboard link. For programs where hard numbers are the mandated spine of the report.",
  },
  {
    name: "Narrative",
    tag: "Optimism / RetroPGF-shaped",
    desc: "Milestone and deliverable tracking with the deviation statement, financial sections switched off. For programs that ask for prose over spreadsheets.",
  },
  {
    name: "Forum post",
    tag: "Shortest form",
    desc: "A further-reduced narrative report sized to paste directly into a governance forum thread — no internal commentary, no raw commit counts.",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "What if our numbers don't perfectly reconcile?",
    a: "The platform surfaces a warning rather than blocking the report. Real, accepted grant reports from real programs often don't reconcile either — a wrapped token gets disbursed instead of the one received, percentages round to more than 100%. A hard fail would reject legitimate reports, so we don't do that.",
  },
  {
    q: "Which chains do you support?",
    a: "Six: Ethereum, Polygon, Arbitrum, Base, Optimism, and Solana. That's the full list today — no \"+\" and nothing implied beyond it.",
  },
  {
    q: "Is there a public price?",
    a: "Not yet. We're working directly with early teams — contact us and we'll figure out what makes sense for your program.",
  },
  {
    q: "Do you support both financial and narrative-only report styles?",
    a: "Yes — that split is deliberate. Research into published Arbitrum, Optimism, and ENS grant reports found financial disclosure is program-dependent, not universal, so the built-in presets default financial sections on or off to match.",
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

export default function GrantsPage() {
  return (
    <div className="pt-[72px]">
      {/* Hero */}
      <section className="vb-pad-x" style={{ paddingTop: 100, paddingBottom: 72 }}>
        <div className="mx-auto max-w-[820px] text-center">
          <p className={`${sectionLabel} inline-block`}>Grant reporting</p>
          <h1 className="font-[family-name:var(--font-space-grotesk)] text-[clamp(36px,5vw,52px)] font-bold text-[var(--vb-text)] tracking-[-0.035em] m-0 mb-4">
            The report your funder{" "}
            <span className="gradient-text">actually reads</span>
          </h1>
          <p className={`${bodyClass} mx-auto max-w-[620px] mb-9`}>
            Vault Brief turns your treasury activity and GitHub progress into
            a grant report — built for teams that received a grant and have
            to account for it, not a general treasury pitch. No more
            compiling numbers by hand every reporting period.
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
            Every funder wants a different shape of report
          </h2>
          <p className={`${bodyClass} mb-3`}>
            Arbitrum-style programs treat hard financial numbers — amount
            awarded, received, spent — as the mandated spine of a report.
            Optimism-style programs want narrative and deliverable tracking,
            often with little to no financial disclosure at all.
          </p>
          <p className={bodyClass} style={{ margin: 0 }}>
            Compiling either one by hand, every reporting period, doesn&apos;t
            scale — especially once you&apos;re managing more than one grant
            at a time.
          </p>
        </div>
      </section>

      {/* What's automated */}
      <section className="vb-pad-x" style={{ paddingBottom: 72 }}>
        <div className="mx-auto max-w-[960px]">
          <div className="text-center mb-10">
            <p className={sectionLabel}>What&apos;s automated</p>
            <h2 className={h2Class}>Built from what funders actually check</h2>
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

      {/* Presets */}
      <section className="vb-pad-x" style={{ paddingBottom: 72 }}>
        <div className="mx-auto max-w-[960px]">
          <div className="text-center mb-10">
            <p className={sectionLabel}>Presets</p>
            <h2 className={h2Class}>Three built-in report styles</h2>
            <p className={`${bodyClass} mx-auto max-w-[620px] mt-3`}>
              Pick a preset when you generate a report, or start from one and
              adjust. Every report can be copied to clipboard or downloaded
              as a Markdown file, with the standard disclaimer appended
              automatically.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PRESETS.map((preset) => (
              <div key={preset.name} className={cardClass}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)] m-0 mb-2 font-[family-name:var(--font-inter)]">
                  {preset.tag}
                </p>
                <h3 className="font-[family-name:var(--font-space-grotesk)] text-[19px] font-semibold text-[var(--vb-text)] m-0 mb-2.5">
                  {preset.name}
                </h3>
                <p className={bodyClass} style={{ margin: 0 }}>
                  {preset.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reminders */}
      <section className="vb-pad-x" style={{ paddingBottom: 72 }}>
        <div className={`${cardClass} mx-auto max-w-[820px] flex items-start gap-5`}>
          <span className="text-[28px] leading-none" aria-hidden="true">
            ⏰
          </span>
          <div>
            <h2 className="font-[family-name:var(--font-space-grotesk)] text-[19px] font-semibold text-[var(--vb-text)] m-0 mb-2">
              Reminders before a report comes due
            </h2>
            <p className={bodyClass} style={{ margin: 0 }}>
              Set a next-report-due date on a grant and get an optional email
              nudge before it&apos;s owed — one less due date to track in a
              spreadsheet.
            </p>
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
                  href="mailto:hello@vaultbrief.io?subject=Grant%20reporting"
                  className="text-[var(--accent)] underline"
                >
                  Contact us
                </a>{" "}
                and we&apos;ll talk through your program.
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
          Stop compiling grant reports by hand
        </h2>
        <p className={`${bodyClass} mx-auto max-w-[520px] mb-8`}>
          Connect the treasury behind your grant and generate a report a
          funder can actually verify.
        </p>
        <div className="flex flex-wrap justify-center gap-3.5">
          <Link href="/login" className="btn-primary">
            Get started free
          </Link>
        </div>
      </section>
    </div>
  );
}
