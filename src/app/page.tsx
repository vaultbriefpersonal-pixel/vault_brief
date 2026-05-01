import Link from "next/link";
import type { Metadata } from "next";
import { Check, ArrowRight, Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "VaultBrief — Automated Investor Reporting for Web3",
  description:
    "Turn your on-chain treasury into investor-ready reports. Automatically. Connect wallets, generate AI reports, send to investors — every month, zero manual work.",
  openGraph: {
    title: "VaultBrief — Automated Investor Reporting for Web3",
    description:
      "Turn your on-chain treasury into investor-ready reports. Automatically.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VaultBrief — Automated Investor Reporting for Web3",
    description:
      "Turn your on-chain treasury into investor-ready reports. Automatically.",
  },
};

const STEPS = [
  {
    icon: "🔗",
    title: "Connect wallets",
    desc: "Add your Gnosis Safe, EOA wallets, or exchange accounts. Multi-chain support.",
  },
  {
    icon: "🤖",
    title: "AI generates report",
    desc: "Claude reads your on-chain data and writes a professional investor update — every month.",
  },
  {
    icon: "📨",
    title: "Send to investors",
    desc: "Review in 10 minutes, then send directly to your investor list. PDF attached.",
  },
];

const MANUAL_STEPS = [
  "Manually check Gnosis Safe, MetaMask, exchange accounts",
  "Copy numbers into a Google Sheet",
  "Calculate burn rate by comparing to last month",
  "Try to remember what milestones were hit",
  "Write a vague Notion doc or email",
  "Send it 2 weeks late — or not at all",
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <nav className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-bold text-lg">VaultBrief</span>
          <div className="flex items-center gap-4">
            <Link
              href="/pricing"
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-indigo-950 border border-indigo-800 px-4 py-1.5 text-sm text-indigo-300 mb-6">
          <Zap className="h-3.5 w-3.5" />
          Powered by Claude AI + on-chain data
        </div>
        <h1 className="text-5xl font-bold leading-tight mb-6 max-w-3xl mx-auto">
          Your investors deserve better than{" "}
          <span className="text-indigo-400">spreadsheets</span>
        </h1>
        <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
          VaultBrief connects to your on-chain wallets and generates professional
          investor reports — automatically, every month.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-6 py-3 font-semibold transition-colors"
          >
            Start your first report free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/pricing"
            className="text-slate-400 hover:text-white transition-colors text-sm"
          >
            See pricing →
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold mb-4 text-center">
          The typical investor update process
        </h2>
        <p className="text-slate-400 text-center mb-10">
          This is not an exaggeration. Most Web3 teams still do this every
          month.
        </p>
        <div className="max-w-lg mx-auto space-y-3">
          {MANUAL_STEPS.map((step, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg bg-red-950/20 border border-red-900/30 px-4 py-3"
            >
              <span className="text-red-500 font-mono text-sm mt-0.5">
                {i + 1}.
              </span>
              <span className="text-sm text-slate-300">{step}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Solution */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold mb-4 text-center">
          One click. Every month.
        </h2>
        <p className="text-slate-400 text-center mb-12">
          VaultBrief replaces that entire process with three simple steps.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-800 bg-slate-900 p-6"
            >
              <div className="text-3xl mb-4">{step.icon}</div>
              <h3 className="font-semibold text-white mb-2">{step.title}</h3>
              <p className="text-sm text-slate-400">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="max-w-5xl mx-auto px-6 py-16 text-center">
        <h2 className="text-3xl font-bold mb-3">Simple pricing</h2>
        <p className="text-slate-400 mb-8">
          Starting at $149/month. No per-report fees, no seat limits.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-8 text-sm text-slate-300">
          {[
            "Wallet balance sync",
            "AI-generated reports",
            "PDF export",
            "Investor email delivery",
            "GitHub integration",
          ].map((f) => (
            <span key={f} className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-indigo-400 shrink-0" />
              {f}
            </span>
          ))}
        </div>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 hover:border-slate-600 px-6 py-3 text-sm font-medium transition-colors"
        >
          View all plans
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      {/* Final CTA */}
      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <h2 className="text-4xl font-bold mb-4">
          Start your first report free
        </h2>
        <p className="text-slate-400 mb-8">
          Connect your first wallet and see your investor report in minutes.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-8 py-4 font-semibold text-lg transition-colors"
        >
          Get started free
          <ArrowRight className="h-5 w-5" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-sm text-slate-500">
          <span>© 2026 VaultBrief</span>
          <div className="flex gap-6">
            <Link
              href="/pricing"
              className="hover:text-slate-300 transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/login"
              className="hover:text-slate-300 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
