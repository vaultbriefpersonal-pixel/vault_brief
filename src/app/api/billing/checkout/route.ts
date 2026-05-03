import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import Stripe from "stripe";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

type Plan = "starter" | "growth" | "vc_suite";
type Interval = "monthly" | "annual";

// Resolve plan + interval → Stripe price ID. Annual variants are optional;
// when STRIPE_PRICE_*_ANNUAL is unset the route falls back to monthly so the
// /pricing toggle can ship before annual prices exist in Stripe Dashboard.
const PRICE_BY_PLAN_INTERVAL: Record<Plan, Record<Interval, string | undefined>> = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER,
    annual: process.env.STRIPE_PRICE_STARTER_ANNUAL,
  },
  growth: {
    monthly: process.env.STRIPE_PRICE_GROWTH,
    annual: process.env.STRIPE_PRICE_GROWTH_ANNUAL,
  },
  vc_suite: {
    monthly: process.env.STRIPE_PRICE_VC_SUITE,
    annual: process.env.STRIPE_PRICE_VC_SUITE_ANNUAL,
  },
};

function resolvePriceId(plan: string, interval: string): string | null {
  if (!(plan in PRICE_BY_PLAN_INTERVAL)) return null;
  const map = PRICE_BY_PLAN_INTERVAL[plan as Plan];
  const requestedInterval = interval === "annual" ? "annual" : "monthly";
  return map[requestedInterval] ?? map.monthly ?? null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const formData = await req.formData();

  // Two ways to pick a price:
  //   1) plan + interval → resolved via env (the new path, supports annual)
  //   2) raw priceId (legacy / direct, e.g. promo prices not in the matrix)
  let priceId = formData.get("priceId") as string | null;
  if (!priceId) {
    const plan = (formData.get("plan") as string | null) ?? "";
    const interval = (formData.get("interval") as string | null) ?? "monthly";
    priceId = resolvePriceId(plan, interval);
  }

  if (!priceId) {
    return new Response(
      "Missing priceId or unknown plan/interval. Configure STRIPE_PRICE_* env vars.",
      { status: 400 }
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id!));
  if (!user) return new Response("User not found", { status: 404 });

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await db
      .update(users)
      .set({ stripeCustomerId: customerId })
      .where(eq(users.id, user.id));
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/billing?success=true`,
    cancel_url: `${appUrl}/billing`,
    metadata: { userId: user.id },
  });

  if (checkoutSession.url) {
    redirect(checkoutSession.url);
  }
  return new Response("Failed to create checkout session", { status: 500 });
}
