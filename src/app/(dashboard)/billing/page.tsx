import { BillingPanel } from "@/components/billing/BillingPanel";

// Restored billing UI, dashboard-only (no public /pricing page). Pricing
// itself hasn't been decided yet — STRIPE_PRICE_* env vars are still
// placeholders in production, so each tier's checkout is disabled until a
// real Stripe price ID replaces the placeholder. Nothing else changes at
// that point: the checkout wiring below is already live.
function isRealPrice(value: string | undefined): boolean {
  return !!value && !value.includes("placeholder");
}

export default function BillingPage() {
  const plansAvailable = {
    starter: isRealPrice(process.env.STRIPE_PRICE_STARTER),
    growth: isRealPrice(process.env.STRIPE_PRICE_GROWTH),
    vc_suite: isRealPrice(process.env.STRIPE_PRICE_VC_SUITE),
  };

  return <BillingPanel plansAvailable={plansAvailable} />;
}
