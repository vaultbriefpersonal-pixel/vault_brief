import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { Check } from "lucide-react";

const PLANS = [
  {
    name: "Starter",
    price: "$149/mo",
    features: [
      "1 project",
      "Up to 5 wallets",
      "Monthly financial report",
      "PDF + email export",
      "1 chain",
    ],
    priceId: process.env.STRIPE_PRICE_STARTER,
  },
  {
    name: "Growth",
    price: "$349/mo",
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
    priceId: process.env.STRIPE_PRICE_GROWTH,
  },
  {
    name: "VC Suite",
    price: "$999/mo",
    features: [
      "Up to 30 portfolio companies",
      "Standardized reporting template",
      "Portfolio-level dashboard",
      "Aggregated performance view",
      "LP-ready quarterly summaries",
      "API access",
    ],
    priceId: process.env.STRIPE_PRICE_VC_SUITE,
  },
] as const;

export default async function BillingPage() {
  const session = await auth();
  const [user] = await db
    .select({ plan: users.plan, planExpiresAt: users.planExpiresAt })
    .from(users)
    .where(eq(users.id, session!.user!.id!));

  const currentPlan = user?.plan ?? "free";

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-white mb-2">Billing</h2>
      <p className="text-sm text-slate-400 mb-8">
        Current plan:{" "}
        <span className="text-white capitalize font-medium">{currentPlan}</span>
      </p>

      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className="rounded-xl border border-slate-800 bg-slate-900 p-6 flex flex-col"
          >
            <h3 className="text-lg font-semibold text-white mb-1">
              {plan.name}
            </h3>
            <p className="text-2xl font-bold text-indigo-400 mb-5">
              {plan.price}
            </p>
            <ul className="space-y-2 flex-1 mb-6">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <Check className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            <form action="/api/billing/checkout" method="POST">
              <input type="hidden" name="priceId" value={plan.priceId} />
              <button
                type="submit"
                className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors"
              >
                Upgrade to {plan.name}
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
