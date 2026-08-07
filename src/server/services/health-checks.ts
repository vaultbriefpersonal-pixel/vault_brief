import { sql } from "drizzle-orm";
import { db } from "@/server/db";

export type ServiceStatus = "operational" | "degraded" | "outage";

export interface ServiceCheck {
  name: string;
  status: ServiceStatus;
  latencyMs: number | null;
  detail?: string;
}

const TIMEOUT_MS = 2500;
const DEGRADED_MS = 1500;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout >${ms}ms`)), ms)
    ),
  ]);
}

function classify(latencyMs: number, ok: boolean): ServiceStatus {
  if (!ok) return "outage";
  return latencyMs > DEGRADED_MS ? "degraded" : "operational";
}

async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  validate: (result: T) => boolean = () => true
): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const res = await withTimeout(fn(), TIMEOUT_MS);
    const latencyMs = Date.now() - start;
    const ok = validate(res);
    return {
      name,
      status: classify(latencyMs, ok),
      latencyMs,
      detail: ok ? undefined : "unexpected response",
    };
  } catch (err) {
    return {
      name,
      status: "outage",
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : "unknown error",
    };
  }
}

async function pingFetch(url: string, init?: RequestInit): Promise<boolean> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  return res.ok;
}

async function checkDatabase(): Promise<ServiceCheck> {
  return timed("Database", async () => {
    await db.execute(sql`select 1`);
    return true;
  });
}

async function checkResend(): Promise<ServiceCheck> {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.includes("placeholder")) {
    return { name: "Email Delivery", status: "operational", latencyMs: null, detail: "not configured" };
  }
  return timed("Email Delivery", () =>
    pingFetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
    })
  );
}

// Public-goods pivot: VaultBrief is free — no billing health check is
// surfaced on /status or /api/health. (Stripe/Atlos integration code
// remains in the repo but dormant.)

async function checkOpenRouter(): Promise<ServiceCheck> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.includes("placeholder")) {
    return { name: "Report Generation", status: "operational", latencyMs: null, detail: "not configured" };
  }
  return timed("Report Generation", () =>
    pingFetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    })
  );
}

/**
 * The BALANCE provider — distinct from "EVM RPC" below, which only proves the
 * node is reachable.
 *
 * This check used to ping Dune Sim. When that API was sunset on 2026-08-01 it
 * began returning HTTP 410 to every balance request, and every EVM treasury
 * silently synced as $0.00 for five days. The check itself did fire — but it
 * was pointed at the provider, not at the product's actual dependency, and
 * nothing downstream treated its failure as urgent. It now exercises the exact
 * endpoint `fetchAlchemyBalances` uses, so "On-chain Data (EVM) is green"
 * means balances can genuinely be read.
 */
async function checkBalanceProvider(): Promise<ServiceCheck> {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key || key.includes("placeholder")) {
    return { name: "On-chain Data (EVM)", status: "operational", latencyMs: null, detail: "not configured" };
  }
  return timed("On-chain Data (EVM)", () =>
    // Vitalik's address — guaranteed to exist, returns a small first page.
    pingFetch(
      `https://api.g.alchemy.com/data/v1/${key}/assets/tokens/by-address`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresses: [
            {
              address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
              networks: ["eth-mainnet"],
            },
          ],
          withPrices: false,
        }),
      }
    )
  );
}

async function checkAlchemy(): Promise<ServiceCheck> {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key || key.includes("placeholder")) {
    const debug = !key
      ? "missing"
      : `len=${key.length} hasPlaceholder=${key.includes("placeholder")} preview=${key.slice(0, 4)}...${key.slice(-4)}`;
    return { name: "EVM RPC", status: "operational", latencyMs: null, detail: `not configured (${debug})` };
  }
  return timed("EVM RPC", async () => {
    // Use the current Alchemy host. The legacy `eth-mainnet.alchemyapi.io`
    // domain is deprecated and returns `fetch failed` against the live
    // runtime path which uses `eth-mainnet.g.alchemy.com`. Aligning them
    // makes /api/health reflect reality.
    const res = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { result?: string };
    return typeof data.result === "string" && data.result.startsWith("0x");
  });
}

export interface SystemHealth {
  checks: ServiceCheck[];
  overall: ServiceStatus;
  checkedAt: string;
}

export async function runHealthChecks(): Promise<SystemHealth> {
  const checks = await Promise.all([
    checkDatabase(),
    checkResend(),
    checkOpenRouter(),
    checkBalanceProvider(),
    checkAlchemy(),
  ]);

  const overall: ServiceStatus = checks.some((c) => c.status === "outage")
    ? "outage"
    : checks.some((c) => c.status === "degraded")
      ? "degraded"
      : "operational";

  return { checks, overall, checkedAt: new Date().toISOString() };
}
