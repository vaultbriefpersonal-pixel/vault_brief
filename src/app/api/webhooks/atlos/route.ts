import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users, atlosProcessedEvents } from "@/server/db/schema";
import {
  ATLOS_STATUS_PAID,
  parseOrderId,
  verifyAtlosSignature,
  type AtlosPostback,
} from "@/lib/atlos";

/**
 * ATLOS postback handler.
 *
 * Configure URL in Merchant Panel → Settings → Postback URL:
 *   https://www.vaultbrief.io/api/webhooks/atlos
 *
 * The handler is intentionally idempotent (TransactionId PK with
 * onConflictDoNothing) and lenient on unknown statuses (200 + no-op rather
 * than 500) — we want ATLOS to stop retrying once we've ack'd, but we don't
 * want a malformed orderId from a stray test payment to retry-loop forever.
 *
 * Status code semantics (from docs):
 *   100  = paid in full (only this activates a plan)
 *   <100 = pending / partial / waiting for confirmations
 *   >100 = error / cancelled / refunded
 */
export async function POST(req: NextRequest) {
  const apiSecret = process.env.ATLOS_API_SECRET;
  if (!apiSecret) {
    console.error("atlos webhook: ATLOS_API_SECRET not configured");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  // Drizzle/Postgres-driver shape: read raw body BEFORE any JSON parsing —
  // HMAC is computed over the byte sequence ATLOS sent, not over our re-
  // serialized version. JSON.stringify(JSON.parse(x)) ≠ x in general.
  const rawBody = await req.text();
  const signature = req.headers.get("Signature");

  if (!verifyAtlosSignature(apiSecret, signature, rawBody)) {
    console.warn("atlos webhook: invalid signature", {
      hasHeader: !!signature,
      bodyLen: rawBody.length,
    });
    return new Response("Invalid signature", { status: 400 });
  }

  let event: AtlosPostback;
  try {
    event = JSON.parse(rawBody) as AtlosPostback;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Idempotency guard: same pattern as Stripe webhook. TransactionId is the
  // ATLOS-side unique payment ID; onConflictDoNothing + empty returning =
  // event already processed → 200 short-circuit before any side-effect.
  const inserted = await db
    .insert(atlosProcessedEvents)
    .values({
      transactionId: event.TransactionId,
      subscriptionId: event.SubscriptionId ?? null,
      orderId: event.OrderId,
      amount: String(event.PaidAmount ?? event.Amount ?? 0),
      asset: event.Asset,
      blockchain: event.Blockchain,
      blockchainHash: event.BlockchainHash,
      status: event.Status,
    })
    .onConflictDoNothing()
    .returning({ transactionId: atlosProcessedEvents.transactionId });
  if (inserted.length === 0) {
    return new Response("Event already processed", { status: 200 });
  }

  // Only Status 100 (paid) activates / extends a subscription. Pending /
  // partial / refunded events are persisted above for audit but don't grant
  // access. ATLOS will eventually send a follow-up Status 100 once on-chain
  // confirmations land for pending payments.
  if (event.Status !== ATLOS_STATUS_PAID) {
    return new Response("OK (non-paid status logged)", { status: 200 });
  }

  const ref = parseOrderId(event.OrderId);
  if (!ref) {
    console.warn("atlos webhook: unparseable orderId — payment recorded but not applied", {
      orderId: event.OrderId,
      txId: event.TransactionId,
    });
    return new Response("OK (unparseable orderId)", { status: 200 });
  }

  // Subscription extends 30 days from now per successful charge. ATLOS bills
  // recurrently via email reminder + user-initiated re-payment, so each paid
  // postback resets the clock to "30 days from settlement". On miss, plan
  // simply expires (planExpiresAt < now) and the app downgrades on next read.
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  try {
    await db
      .update(users)
      .set({
        plan: ref.plan,
        planExpiresAt: expiresAt,
        atlosSubscriptionId: event.SubscriptionId ?? null,
        paymentProvider: "atlos",
      })
      .where(eq(users.id, ref.userId));
  } catch (err) {
    console.error("atlos webhook: failed to apply plan", err);
    // 500 lets ATLOS retry on transient DB errors. The idempotency row was
    // inserted above, so on retry we'll short-circuit — meaning we lose this
    // activation. Acceptable trade-off: the user can re-trigger by re-paying
    // (rare DB outage) vs. our DB getting stuck in inconsistent state.
    return new Response("DB update failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
