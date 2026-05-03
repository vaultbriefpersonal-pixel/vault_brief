/**
 * End-to-end smoke test: runs each external integration against a real
 * publicly-known wallet and prints the response so we can eyeball that:
 *   - Dune Sim returns balances with the new chain_ids API (#8)
 *   - fetchTokenMetrics talks to the right endpoint (#9)
 *   - Helius returns Solana balances + parsed transfers (#10)
 *   - Alchemy returns asset transfers
 *   - CoinGecko historical prices resolve via price-resolver
 *   - OpenRouter classifies a transaction
 *
 * Run with: `npx tsx scripts/smoke-test.ts`
 *
 * Requires .env.local with all production keys.
 */

import { readFileSync } from "node:fs";

// --- Manual .env.local loader (avoids adding dotenv as a dep) ----------------
try {
  const text = readFileSync(".env.local", "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
  console.log("[env] loaded .env.local");
} catch {
  console.log("[env] .env.local not found, relying on process env");
}

// --- Imports (after env load) ------------------------------------------------
import {
  fetchWalletBalance,
  fetchTokenMetrics,
  fetchAllBalances,
} from "../src/server/services/wallet-sync";
import {
  fetchSolanaBalance,
  fetchSolanaTransfers,
} from "../src/server/services/solana-sync";
import { getHistoricalPrice } from "../src/server/services/price-resolver";
import { classifyTransactions } from "../src/server/services/expense-classifier";
import { fetchAndClassify } from "../src/server/services/transaction-sync";
import { STABLECOIN_SYMBOLS } from "../src/lib/chains";

// --- Test fixtures -----------------------------------------------------------
// Public DAO/whale wallets — read-only smoke test, no funds at risk.
const TEST_WALLETS = [
  {
    label: "Vitalik (Ethereum)",
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    chain: "ethereum",
  },
  {
    label: "Vitalik (Polygon)",
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    chain: "polygon",
  },
] as const;

const TEST_SOLANA = {
  label: "Marinade Foundation Treasury (Solana)",
  address: "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC",
};

const UNI_CONTRACT = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";

// --- Helpers -----------------------------------------------------------------
const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${n.toFixed(2)}`;

function header(s: string) {
  console.log("\n" + "═".repeat(60));
  console.log(" " + s);
  console.log("═".repeat(60));
}

function ok(s: string) {
  console.log(`  ✓ ${s}`);
}
function fail(s: string, err?: unknown) {
  console.log(`  ✗ ${s}`);
  if (err) console.log(`     ${err instanceof Error ? err.message : err}`);
}

// --- Tests -------------------------------------------------------------------

async function testEvmBalance() {
  header("#8 — Dune Sim balances (chain_ids)");
  for (const w of TEST_WALLETS) {
    try {
      const summary = await fetchWalletBalance({
        address: w.address,
        chain: w.chain,
      } as never);
      ok(
        `${w.label}: total=${usd(summary.totalUsd)} stables=${usd(summary.stablecoinsUsd)} eth=${usd(summary.ethUsd)} other=${usd(summary.otherAssetsUsd)} (${summary.tokens.length} tokens)`
      );
      if (summary.tokens.length > 0) {
        const top = summary.tokens
          .filter((t) => t.valueUsd > 0)
          .sort((a, b) => b.valueUsd - a.valueUsd)
          .slice(0, 3);
        for (const t of top) {
          console.log(`     • ${t.symbol}: ${t.amount.toFixed(2)} = ${usd(t.valueUsd)}`);
        }
      }
    } catch (err) {
      fail(`${w.label} failed`, err);
    }
  }
}

async function testTokenMetrics() {
  header("#9 — Dune Sim token-info (UNI on Ethereum)");
  try {
    const m = await fetchTokenMetrics(UNI_CONTRACT, "ethereum");
    console.log("    raw:", JSON.stringify(m, null, 2).split("\n").join("\n    "));
    if (m.tokenPriceUsd && m.tokenPriceUsd > 0) ok(`UNI price: $${m.tokenPriceUsd.toFixed(4)}`);
    else fail("UNI price unavailable");
    if (m.tokenMarketCapUsd) ok(`UNI FDV: ${usd(m.tokenMarketCapUsd)}`);
    if (m.tokenCirculatingSupply) ok(`UNI total supply: ${m.tokenCirculatingSupply.toExponential(2)}`);
  } catch (err) {
    fail("fetchTokenMetrics threw", err);
  }
}

async function testSolanaBalance() {
  header("#10a — Helius Solana balance");
  try {
    const summary = await fetchSolanaBalance(TEST_SOLANA.address);
    ok(
      `${TEST_SOLANA.label}: total=${usd(summary.totalUsd)} native=${usd(summary.nativeTokenUsd)} stables=${usd(summary.stablecoinsUsd)} (${summary.tokens.length} tokens)`
    );
    const top = summary.tokens.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 3);
    for (const t of top) {
      console.log(`     • ${t.symbol}: ${t.amount.toFixed(2)} = ${usd(t.valueUsd)}`);
    }
  } catch (err) {
    fail("fetchSolanaBalance threw", err);
  }
}

async function testSolanaTransfers() {
  header("#10b — Helius Solana transfers (last 7 days)");
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const transfers = await fetchSolanaTransfers(TEST_SOLANA.address, { start, end });
    ok(`Found ${transfers.length} transfers`);
    for (const t of transfers.slice(0, 3)) {
      console.log(
        `     • ${t.direction} ${t.token} valueUsd=${usd(t.valueUsd)} hash=${t.hash.slice(0, 12)}…`
      );
    }
  } catch (err) {
    fail("fetchSolanaTransfers threw", err);
  }
}

async function testPriceResolver() {
  header("price-resolver — historical prices");
  const cases: Array<[string, Date]> = [
    ["ETH", new Date()],
    ["SOL", new Date()],
    ["USDC", new Date()],
    ["UNI", new Date(Date.now() - 30 * 86400_000)], // 30 days ago
  ];
  for (const [symbol, date] of cases) {
    try {
      const p = await getHistoricalPrice(symbol, date);
      if (p === null) fail(`${symbol} @ ${date.toISOString().slice(0, 10)}: null`);
      else ok(`${symbol} @ ${date.toISOString().slice(0, 10)}: $${p.toFixed(4)}`);
    } catch (err) {
      fail(`${symbol} threw`, err);
    }
  }
}

async function testClassifier() {
  header("expense-classifier — sample transactions");
  const samples = [
    {
      hash: "0xaaa",
      from: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      to: "0x5754284f345afc66a98fbb0a0afe71e0f007b949", // Tornado Cash, will go through AI
      value: "1000000000000000000",
      token: "ETH",
      valueUsd: 3500,
      timestamp: Date.now(),
      direction: "out" as const,
    },
    {
      hash: "0xbbb",
      from: "0x28c6c06298d514db089934071355e5743bf21d60", // Binance hot wallet
      to: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      value: "1000000000",
      token: "USDC",
      valueUsd: 1000,
      timestamp: Date.now(),
      direction: "in" as const,
    },
  ];
  try {
    const classified = await classifyTransactions(samples);
    for (const c of classified) {
      ok(
        `${c.direction} ${c.token} $${c.valueUsd} → ${c.category} (conf ${c.confidence})`
      );
    }
  } catch (err) {
    fail("classifier threw", err);
  }
}

async function testFullPipeline() {
  header("Full pipeline — fetchAllBalances + fetchAndClassify (small period)");
  try {
    const wallets = [
      {
        id: "test-1",
        projectId: "test-proj",
        address: TEST_WALLETS[0].address,
        chain: TEST_WALLETS[0].chain,
        createdAt: new Date(),
      } as never,
    ];
    const balances = await fetchAllBalances(wallets, "UNI");
    ok(`balances total: ${usd(balances.totalBalanceUsd)}`);

    const end = new Date();
    const start = new Date(end.getTime() - 3 * 86400_000); // last 3 days for speed
    const result = await fetchAndClassify(
      wallets,
      { start, end },
      balances.totalBalanceUsd
    );
    ok(`tx count: ${result.transactions.length}`);
    ok(`inflows=${usd(result.totalInflowsUsd)} outflows=${usd(result.totalOutflowsUsd)}`);
    ok(`burn=${usd(result.burnRateUsd)} runway=${result.runwayMonths?.toFixed(1) ?? "n/a"}mo`);
    console.log("    expenses:", result.expensesByCategory);
    console.log("    income:", result.incomeByCategory);
  } catch (err) {
    fail("full pipeline threw", err);
  }
}

function testStablecoinSet() {
  header("STABLECOIN_SYMBOLS — set sanity & coverage");
  // Every entry MUST be uppercase (callers do toUpperCase before lookup, so
  // a lowercase entry would silently never match).
  let lowercaseCount = 0;
  for (const s of STABLECOIN_SYMBOLS) {
    if (s !== s.toUpperCase()) {
      fail(`entry "${s}" is not uppercase — will never match callers`);
      lowercaseCount++;
    }
  }
  if (lowercaseCount === 0) ok(`all ${STABLECOIN_SYMBOLS.size} entries uppercase`);

  // Every common stable that hits real treasuries today must classify.
  const MUST_HAVE = ["USDC", "USDT", "DAI", "USDS", "PYUSD", "USDE", "GHO", "CRVUSD", "FRAX", "SUSD"];
  for (const s of MUST_HAVE) {
    if (STABLECOIN_SYMBOLS.has(s)) ok(`${s} → classified as stable`);
    else fail(`${s} missing from STABLECOIN_SYMBOLS`);
  }
}

// --- Main --------------------------------------------------------------------

async function main() {
  console.log("VaultBrief smoke test — running all integrations\n");
  testStablecoinSet();
  await testPriceResolver();
  await testEvmBalance();
  await testTokenMetrics();
  await testSolanaBalance();
  await testSolanaTransfers();
  await testClassifier();
  await testFullPipeline();
  console.log("\n" + "═".repeat(60));
  console.log(" Done. Check the output above for any ✗ marks.");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
