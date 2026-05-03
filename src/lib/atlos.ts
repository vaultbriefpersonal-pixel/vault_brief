import crypto from "node:crypto";

/**
 * ATLOS payment helpers.
 *
 * Docs: https://atlos.io/docs/
 * Webhook signature: https://atlos.io/docs/postback/signature
 *
 * Plan resolution: we encode `userId:plan:nonce` into orderId because ATLOS's
 * postback returns the orderId verbatim. Parsing it server-side avoids needing
 * a separate "pending order" table for crypto.
 */

export type AtlosPlan = "starter" | "growth" | "vc_suite";

// Status codes from ATLOS postback. 100 = paid (success). Other codes are
// pending / partial / overpaid / underpaid — we ignore them for activation
// (only Status 100 grants access). See docs/postback/fields.
export const ATLOS_STATUS_PAID = 100;

// Map canonical plan key → display amount in USD. Must match Stripe-side
// pricing on /pricing card. If you change a price, change it both places.
export const ATLOS_PLAN_AMOUNTS: Record<AtlosPlan, number> = {
  starter: 99,
  growth: 299,
  vc_suite: 799,
};

const PLAN_KEYS = new Set<AtlosPlan>(["starter", "growth", "vc_suite"]);

export interface AtlosOrderRef {
  userId: string;
  plan: AtlosPlan;
  nonce: string;
}

/**
 * Build the orderId we send to atlos.Pay(). ATLOS echoes it back in the
 * postback so we use it as the source of truth for who pays for what. The
 * nonce prevents collisions when a user re-opens the widget without paying.
 */
export function buildOrderId({ userId, plan, nonce }: AtlosOrderRef): string {
  // Drop colons defensively in case someone sneaks one into a userId/plan.
  const safe = (s: string) => s.replace(/:/g, "_");
  return `${safe(userId)}:${safe(plan)}:${safe(nonce)}`;
}

/**
 * Inverse of buildOrderId. Returns null on any malformed input — webhook then
 * 200s but skips the side-effect (we don't want to retry-loop bad orderIds).
 */
export function parseOrderId(orderId: string): AtlosOrderRef | null {
  const parts = orderId.split(":");
  if (parts.length !== 3) return null;
  const [userId, plan, nonce] = parts;
  if (!userId || !plan || !nonce) return null;
  if (!PLAN_KEYS.has(plan as AtlosPlan)) return null;
  return { userId, plan: plan as AtlosPlan, nonce };
}

/**
 * Verify the HMAC-SHA256 signature ATLOS attaches to every postback. The
 * signature is computed over the raw POST body (NOT the parsed JSON) and
 * arrives base64-encoded in the `Signature` header.
 *
 * From docs/postback/signature:
 *   var hmac = crypto.createHmac('sha256', api_secret);
 *   hmac.write(message_data); hmac.end();
 *   var message_signature = hmac.read().toString('base64');
 *
 * We use timingSafeEqual to avoid leaking signature bytes via response time.
 */
export function verifyAtlosSignature(
  apiSecret: string,
  signatureHeader: string | null,
  rawBody: string
): boolean {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", apiSecret)
    .update(rawBody)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signatureHeader);
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

/** Shape of the postback body. Casing matches ATLOS docs (PascalCase). */
export interface AtlosPostback {
  TransactionId: string;
  SubscriptionId?: string | null;
  MerchantId: string;
  OrderId: string;
  Amount: number;
  Fee?: number;
  Blockchain: string;
  Asset: string;
  BlockchainHash: string;
  UserWallet?: string;
  UserName?: string;
  UserEmail?: string;
  OrderAmount: number;
  OrderCurrency: string;
  PaidAmount: number;
  TimeSent: string;
  Status: number;
}
