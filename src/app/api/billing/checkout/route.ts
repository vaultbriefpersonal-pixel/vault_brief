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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const formData = await req.formData();
  const priceId = formData.get("priceId") as string;

  if (!priceId) return new Response("Missing priceId", { status: 400 });

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
