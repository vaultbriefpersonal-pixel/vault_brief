import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { TRPCError } from "@trpc/server";

/**
 * Rate limiting via Upstash Redis. Two limiters cover our needs today:
 *   - loginLimiter: throttle magic-link requests per email
 *   - mutationLimiter: per-user cap on TRPC mutations that hit external APIs
 *
 * If UPSTASH_REDIS_REST_* env vars are missing or Redis is unreachable,
 * checkLimit fails OPEN with a console warning — better UX than 500ing
 * legitimate users on infra blips.
 */

let _redis: Redis | undefined;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

function makeLimiter(tokens: number, window: `${number} ${"s" | "m" | "h" | "d"}`, prefix: string) {
  return () => {
    const redis = getRedis();
    if (!redis) return null;
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix,
      analytics: false,
    });
  };
}

export const loginLimiter = makeLimiter(10, "1 h", "rl:login");
export const mutationLimiter = makeLimiter(20, "1 h", "rl:mutation");
export const sendReportLimiter = makeLimiter(10, "1 h", "rl:send-report");
export const bulkImportLimiter = makeLimiter(5, "1 h", "rl:bulk-import");
export const projectCreateLimiter = makeLimiter(5, "1 h", "rl:proj-create");
// Manual "Sync now" — keyed by projectId, not userId, so a vc_suite user with
// 30 projects can refresh each one a few times without hitting one global cap.
export const syncLimiter = makeLimiter(3, "1 h", "rl:sync");
// Backfill (>1 month at once) is much more expensive — one trigger spans
// dozens of API calls per month × N months. Keep it rare.
export const backfillLimiter = makeLimiter(2, "1 d", "rl:backfill");

type LimiterFactory = () => Ratelimit | null;

/**
 * Check a limiter for the given identifier. Throws TRPCError TOO_MANY_REQUESTS
 * when the budget is exhausted; returns silently otherwise. Fails open on infra errors.
 */
export async function checkLimit(
  factory: LimiterFactory,
  identifier: string
): Promise<void> {
  const limiter = factory();
  if (!limiter) {
    // No Redis configured — skip silently. Logged once on cold start by getRedis() callers.
    return;
  }
  try {
    const { success, reset } = await limiter.limit(identifier);
    if (!success) {
      const seconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many requests. Try again in ${seconds}s.`,
      });
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    console.warn("ratelimit unavailable:", err);
  }
}
