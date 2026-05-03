import type { NextRequest } from "next/server";
import Stripe from "stripe";
import { db } from "@/server/db";
import { users, stripeProcessedEvents } from "@/server/db/schema";
import { eq } from "drizzle-orm";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

const PLAN_BY_PRICE: Record<string, string> = {
  [process.env.STRIPE_PRICE_STARTER ?? ""]: "starter",
  [process.env.STRIPE_PRICE_GROWTH ?? ""]: "growth",
  [process.env.STRIPE_PRICE_VC_SUITE ?? ""]: "vc_suite",
};

function getPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const periodEnd = subscription.items.data[0]?.current_period_end;
  return periodEnd ? new Date(periodEnd * 1000) : null;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return new Response("Webhook signature verification failed", {
      status: 400,
    });
  }

  // Idempotency guard: Stripe re-delivers events on cold-start timeouts and
  // dashboard "Resend" clicks. The PK on event_id makes the insert atomic;
  // if returning() yields no row the event was already processed and we
  // short-circuit before any side-effect.
  const inserted = await db
    .insert(stripeProcessedEvents)
    .values({ eventId: event.id, eventType: event.type })
    .onConflictDoNothing()
    .returning({ eventId: stripeProcessedEvents.eventId });
  if (inserted.length === 0) {
    return new Response("Event already processed", { status: 200 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;

      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string
      );
      const priceId = subscription.items.data[0]?.price.id;
      const plan = PLAN_BY_PRICE[priceId ?? ""] ?? "starter";
      const userId = session.metadata?.userId;

      if (userId) {
        await db
          .update(users)
          .set({
            plan,
            planExpiresAt: getPeriodEnd(subscription),
            stripeCustomerId: session.customer as string,
          })
          .where(eq(users.id, userId));
      }
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string };
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(
          invoice.subscription
        );
        const customer = await stripe.customers.retrieve(
          subscription.customer as string
        );
        if (customer.deleted) break;
        const userId = (customer as Stripe.Customer).metadata?.userId;
        if (userId) {
          await db
            .update(users)
            .set({ planExpiresAt: getPeriodEnd(subscription) })
            .where(eq(users.id, userId));
        }
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customer = await stripe.customers.retrieve(
        subscription.customer as string
      );
      if (customer.deleted) break;
      const userId = (customer as Stripe.Customer).metadata?.userId;
      if (userId) {
        await db
          .update(users)
          .set({ plan: "free", planExpiresAt: null })
          .where(eq(users.id, userId));
      }
      break;
    }

    case "invoice.payment_failed": {
      console.error("Payment failed:", (event.data.object as Stripe.Invoice).id);
      break;
    }
  }

  return new Response("OK", { status: 200 });
}
