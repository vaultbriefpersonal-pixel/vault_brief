import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing — VaultBrief",
  description: "Simple, transparent pricing for automated Web3 investor reporting.",
};

const PLANS = [
  {
    name: "Starter",
    price: "$149",
    period: "/month",
    description: "For projects getting started with investor reporting.",
    features: [
      "1 project",
      "Up to 5 wallets",
      "Monthly financial report",
      "PDF + email export",
      "1 chain supported",
    ],
    cta: "Get started",
    highlighted: false,
  },
  {
    name: "Growth",
    price: "$349",
    period: "/month",
    description: "Full-stack reporting for active projects.",
    features: [
      "1 project",
      "Up to 20 wallets",
      "Full reports (financial + dev + community)",
      "PDF + Notion + email",
      "Multi-chain (up to 5)",
      "Custom branding",
      "GitHub integration",
      "Investor email distribution",
    ],
    cta: "Start growing",
    highlighted: true,
  },
  {
    name: "VC Suite",
    price: "$999",
    period: "/month",
    description: "For VCs who want standardized reporting across their portfolio.",
    features: [
      "Up to 30 portfolio companies",
      "Standardized reporting template",
      "Portfolio-level dashboard",
      "Aggregated performance view",
      "LP-ready quarterly summaries",
      "API access",
    ],
    cta: "Contact us",
    highlighted: false,
  },
] as const;

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <nav className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-bold text-lg">
            VaultBrief
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium transition-colors"
          >
            Get started
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold mb-4">Simple, transparent pricing</h1>
          <p className="text-slate-400 text-lg">
            Start free. Upgrade when you need more.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-8 flex flex-col ${
                plan.highlighted
                  ? "border-indigo-500 bg-indigo-950/20"
                  : "border-slate-800 bg-slate-900"
              }`}
            >
              {plan.highlighted && (
                <div className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">
                  Most popular
                </div>
              )}
              <h2 className="text-xl font-bold text-white mb-1">{plan.name}</h2>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-4xl font-bold text-white">
                  {plan.price}
                </span>
                <span className="text-slate-400">{plan.period}</span>
              </div>
              <p className="text-sm text-slate-400 mb-6">{plan.description}</p>
              <ul className="space-y-2.5 flex-1 mb-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className={`w-full rounded-lg px-4 py-3 text-sm font-semibold text-center transition-colors ${
                  plan.highlighted
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                    : "border border-slate-700 hover:border-slate-600 text-white"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-16 text-center text-slate-400 text-sm">
          <p>
            All plans include a 14-day free trial. No credit card required to
            start.
          </p>
          <p className="mt-2">
            Questions? Email us at{" "}
            <a
              href="mailto:hello@vaultbrief.com"
              className="text-indigo-400 hover:underline"
            >
              hello@vaultbrief.com
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
