// Mock seed for local UI testing.
//
// Creates a synthetic test user + 7 projects that cover the realistic
// shapes a paying customer's data can take: bare onboarding, multi-chain,
// whale, tiny, failed sync, multi-month timeline, edge UI strings.
//
// Run:    node scripts/seed-mock.mjs
// Reset:  node scripts/seed-mock.mjs --clean
//
// IDEMPOTENT: re-running deletes prior mock rows (slug prefix "mock-")
// before re-seeding. Real production data is untouched.
//
// Login:  the test user has email mock-test@vaultbrief.local — to view
// the seeded UI, sign in via magic link with that email locally (or insert
// a session row directly; see logSessionHint at end of run).

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set; load .env.local first.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const MOCK_USER_EMAIL = "mock-test@vaultbrief.local";
const MOCK_SLUG_PREFIX = "mock-";

const args = new Set(process.argv.slice(2));
const isClean = args.has("--clean");

// ─── helpers ────────────────────────────────────────────────────────────────

const randId = () => crypto.randomUUID();
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
const r = (min, max) => Math.round(min + Math.random() * (max - min));

// ─── cleanup ────────────────────────────────────────────────────────────────

async function cleanup() {
  // CASCADE on projects.user_id → wipes wallets, snapshots, reports etc.
  // We delete by slug prefix to avoid touching real projects that happen
  // to belong to the same test user during dev.
  const dropped = await sql`DELETE FROM projects WHERE slug LIKE ${MOCK_SLUG_PREFIX + "%"} RETURNING name`;
  console.log(`✓ cleaned ${dropped.length} mock project(s)`);
}

// ─── user ───────────────────────────────────────────────────────────────────

async function ensureUser() {
  const existing = await sql`SELECT id FROM "user" WHERE email = ${MOCK_USER_EMAIL}`;
  if (existing[0]) return existing[0].id;
  const id = randId();
  await sql`
    INSERT INTO "user" (id, email, name, plan, "emailVerified")
    VALUES (${id}, ${MOCK_USER_EMAIL}, ${"Mock Test"}, ${"vc_suite"}, ${new Date()})
  `;
  return id;
}

// ─── snapshot generator ────────────────────────────────────────────────────

function makeSnapshot(opts) {
  const {
    projectId,
    monthOffset,        // 0 = current month, 1 = last month, etc.
    treasury,
    burnRate = 0,
    runwayMonths = null,
    stables = null,
    eth = null,
    expenses = null,
    income = null,
    githubCommits = 0,
    githubPRs = 0,
    githubContribs = 0,
    syncWarnings = null,
    tokenPrice = null,
    tokenMarketCap = null,
    tokenHolders = null,
    balancesDetail = null,
  } = opts;
  return {
    id: randId(),
    project_id: projectId,
    snapshot_date: monthsAgo(monthOffset),
    total_balance_usd: String(treasury),
    stablecoins_usd: stables !== null ? String(stables) : null,
    eth_usd: eth !== null ? String(eth) : null,
    native_token_usd: null,
    other_assets_usd: null,
    balances_detail: balancesDetail,
    total_inflows_usd: income
      ? String(Object.values(income).reduce((a, b) => a + b, 0))
      : null,
    total_outflows_usd: expenses
      ? String(Object.values(expenses).reduce((a, b) => a + b, 0))
      : null,
    net_flow_usd: null,
    expenses_by_category: expenses,
    income_by_category: income,
    burn_rate_usd: String(burnRate),
    runway_months: runwayMonths !== null ? String(runwayMonths) : null,
    token_holders_count: tokenHolders,
    token_price_usd: tokenPrice !== null ? String(tokenPrice) : null,
    token_market_cap_usd: tokenMarketCap !== null ? String(tokenMarketCap) : null,
    token_circulating_supply: null,
    github_commits_count: githubCommits,
    github_prs_merged: githubPRs,
    github_contributors_active: githubContribs,
    transactions_raw: null,
    sync_warnings: syncWarnings,
  };
}

// Neon's tagged-template binder doesn't auto-serialize JS objects to JSON
// for jsonb columns — it falls through to the toString of the object,
// which is `[object Object]` (or a template-stringified literal). Cast to
// string here and let Postgres parse it.
const j = (obj) => (obj == null ? null : JSON.stringify(obj));

async function insertSnapshots(rows) {
  for (const row of rows) {
    await sql`
      INSERT INTO treasury_snapshots (
        id, project_id, snapshot_date, total_balance_usd, stablecoins_usd,
        eth_usd, balances_detail, total_inflows_usd, total_outflows_usd,
        expenses_by_category, income_by_category, burn_rate_usd, runway_months,
        token_holders_count, token_price_usd, token_market_cap_usd,
        github_commits_count, github_prs_merged, github_contributors_active,
        sync_warnings
      ) VALUES (
        ${row.id}, ${row.project_id}, ${row.snapshot_date}, ${row.total_balance_usd},
        ${row.stablecoins_usd}, ${row.eth_usd}, ${j(row.balances_detail)},
        ${row.total_inflows_usd}, ${row.total_outflows_usd},
        ${j(row.expenses_by_category)}, ${j(row.income_by_category)},
        ${row.burn_rate_usd}, ${row.runway_months}, ${row.token_holders_count},
        ${row.token_price_usd}, ${row.token_market_cap_usd},
        ${row.github_commits_count}, ${row.github_prs_merged},
        ${row.github_contributors_active}, ${j(row.sync_warnings)}
      )
    `;
  }
}

// ─── projects ──────────────────────────────────────────────────────────────

async function createProject(userId, def) {
  const id = randId();
  const slug = MOCK_SLUG_PREFIX + def.slug;
  await sql`
    INSERT INTO projects (
      id, user_id, name, slug, website, description, team_size, founded_date,
      last_funding_round, last_funding_amount, token_symbol, token_contract,
      token_chain, github_org
    ) VALUES (
      ${id}, ${userId}, ${def.name}, ${slug}, ${def.website ?? null},
      ${def.description ?? null}, ${def.teamSize ?? null},
      ${def.foundedDate ?? null}, ${def.lastFundingRound ?? null},
      ${def.lastFundingAmount ?? null}, ${def.tokenSymbol ?? null},
      ${def.tokenContract ?? null}, ${def.tokenChain ?? null},
      ${def.githubOrg ?? null}
    )
  `;
  if (def.wallets) {
    for (const w of def.wallets) {
      await sql`
        INSERT INTO wallets (project_id, address, chain, label, wallet_type)
        VALUES (${id}, ${w.address}, ${w.chain}, ${w.label ?? null}, ${w.walletType ?? "eoa"})
      `;
    }
  }
  return id;
}

async function createReport(snapshotId, projectId, monthOffset, content, status = "draft") {
  const id = randId();
  const periodEnd = monthsAgo(monthOffset);
  const periodStartDate = new Date(periodEnd);
  periodStartDate.setDate(1);
  const periodStart = periodStartDate.toISOString().slice(0, 10);
  await sql`
    INSERT INTO reports (
      id, project_id, snapshot_id, period_start, period_end, status,
      content_md, executive_summary, sent_to_count, opened_count, sent_at
    ) VALUES (
      ${id}, ${projectId}, ${snapshotId}, ${periodStart}, ${periodEnd},
      ${status}, ${content.md}, ${content.summary},
      ${content.sentToCount ?? 0}, ${content.openedCount ?? 0},
      ${status === "sent" ? new Date() : null}
    )
  `;
  return id;
}

async function createInvestor(projectId, def) {
  await sql`
    INSERT INTO investors (project_id, name, email, firm, role)
    VALUES (${projectId}, ${def.name}, ${def.email}, ${def.firm ?? null}, ${def.role ?? null})
  `;
}

async function createMilestone(projectId, def) {
  await sql`
    INSERT INTO milestones (project_id, title, description, status, target_date, completed_date)
    VALUES (
      ${projectId}, ${def.title}, ${def.description ?? null}, ${def.status},
      ${def.targetDate ?? null}, ${def.completedDate ?? null}
    )
  `;
}

// ─── seed scenarios ────────────────────────────────────────────────────────

async function seed() {
  const userId = await ensureUser();
  console.log(`✓ user ready: ${MOCK_USER_EMAIL} (id=${userId})`);

  // ─── 1. Bare project — minimal context, fresh, no reports ────────────────
  const bareId = await createProject(userId, {
    name: "Bare Project",
    slug: "bare-project",
    description: "Just a name and a wallet — nothing else filled in.",
    wallets: [
      { address: "0x" + "a".repeat(40), chain: "ethereum", label: "Treasury" },
    ],
  });
  await insertSnapshots([
    makeSnapshot({
      projectId: bareId,
      monthOffset: 1,
      treasury: 12500,
      stables: 12000,
      eth: 500,
    }),
  ]);

  // ─── 2. ENS-shaped (rich context, 1 wallet, 3 months) ────────────────────
  const ensId = await createProject(userId, {
    name: "ENS DAO (mock)",
    slug: "ens-dao",
    website: "https://ens.domains",
    description: "Decentralized naming for Ethereum. Mock copy of public DAO data for UI testing.",
    teamSize: 25,
    foundedDate: "2017-05-04",
    lastFundingRound: "Token launch",
    lastFundingAmount: "0",
    tokenSymbol: "ENS",
    tokenContract: "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72",
    tokenChain: "ethereum",
    githubOrg: "ensdomains",
    wallets: [
      { address: "0xFe89cc7aBB2C4183683ab71653C4cdc9B02D44b7", chain: "ethereum", label: "DAO Treasury", walletType: "gnosis_safe" },
    ],
  });
  const ensSnaps = [];
  for (let i = 3; i >= 1; i--) {
    const treasury = 73_600_000 + r(-2_000_000, 2_000_000);
    ensSnaps.push(makeSnapshot({
      projectId: ensId,
      monthOffset: i,
      treasury,
      stables: 2_800_000 + r(-100_000, 100_000),
      eth: treasury - 2_800_000,
      burnRate: 180_000 + r(-30_000, 30_000),
      runwayMonths: 408,
      githubCommits: 240 + r(-30, 30),
      githubPRs: 65 + r(-10, 10),
      githubContribs: 18 + r(-3, 3),
      tokenPrice: 23.40 + r(-200, 200) / 100,
      tokenMarketCap: 700_000_000,
      tokenHolders: 84_000,
      expenses: { payroll: 120_000, infrastructure: 25_000, audit: 35_000 },
      income: { revenue: 95_000, staking_reward: 8_500 },
      balancesDetail: {
        eth: { amount: 25_000, usd: 70_000_000 },
        usdc: { amount: 2_800_000, usd: 2_800_000 },
      },
    }));
  }
  await insertSnapshots(ensSnaps);
  await createReport(
    ensSnaps[ensSnaps.length - 1].id,
    ensId,
    1,
    {
      md: `## ENS DAO Monthly Investor Report — ${monthsAgo(1)}

### Executive Summary

Treasury closed the month at $73.6M, broadly flat versus prior. Operating burn of ~$180k/mo continues to be dominated by payroll. Runway remains effectively perpetual.

### Treasury Composition

- ETH: 25,000 ETH (~$70.0M)
- USDC: $2.8M
- Other: minimal

### Development Activity

240 commits across 18 active contributors, 65 PRs merged.

### Looking Ahead

Continued protocol development; no major capital actions planned.`,
      summary: "Treasury at $73.6M, burn $180k/mo, 240 commits.",
      sentToCount: 12,
      openedCount: 9,
    },
    "sent"
  );
  await createInvestor(ensId, { name: "a16z Crypto", email: "reports@a16z.com", firm: "Andreessen Horowitz" });
  await createInvestor(ensId, { name: "Paradigm", email: "ir@paradigm.xyz", firm: "Paradigm" });
  await createMilestone(ensId, { title: "L2 deployment", description: "Deploy registrar to Base + Optimism", status: "in_progress", targetDate: monthsAgo(-2) });
  await createMilestone(ensId, { title: "Wildcard resolver", status: "completed", completedDate: monthsAgo(2) });

  // ─── 3. Multi-chain (Lido-shaped) — 4 wallets, 6 months ─────────────────
  const lidoId = await createProject(userId, {
    name: "Lido (mock)",
    slug: "lido",
    website: "https://lido.fi",
    description: "Mock multi-chain treasury — Ethereum + Optimism + Arbitrum + Base.",
    teamSize: 100,
    foundedDate: "2020-12-19",
    tokenSymbol: "LDO",
    githubOrg: "lidofinance",
    wallets: [
      { address: "0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c", chain: "ethereum", label: "Aragon DAO", walletType: "gnosis_safe" },
      { address: "0x" + "b".repeat(40), chain: "optimism", label: "Optimism Ops", walletType: "gnosis_safe" },
      { address: "0x" + "c".repeat(40), chain: "arbitrum", label: "Arbitrum Ops" },
      { address: "0x" + "d".repeat(40), chain: "base", label: "Base Ops" },
    ],
  });
  const lidoSnaps = [];
  for (let i = 6; i >= 1; i--) {
    const base = 350_000_000;
    const wave = Math.sin((6 - i) / 2) * 30_000_000;
    const treasury = base + wave + r(-5_000_000, 5_000_000);
    lidoSnaps.push(makeSnapshot({
      projectId: lidoId,
      monthOffset: i,
      treasury,
      stables: 80_000_000,
      eth: treasury - 80_000_000,
      burnRate: 1_400_000 + r(-100_000, 100_000),
      runwayMonths: Math.round(treasury / 1_400_000),
      githubCommits: 1_200 + r(-100, 100),
      githubPRs: 320 + r(-20, 20),
      githubContribs: 75 + r(-5, 5),
      tokenPrice: 1.85 + r(-30, 30) / 100,
      tokenMarketCap: 1_660_000_000,
      tokenHolders: 32_000,
      expenses: { payroll: 1_100_000, infrastructure: 220_000, marketing: 80_000 },
      income: { revenue: 2_400_000 + r(-200_000, 200_000), staking_reward: 50_000 },
    }));
  }
  await insertSnapshots(lidoSnaps);
  await createReport(lidoSnaps[lidoSnaps.length - 1].id, lidoId, 1, {
    md: "## Lido Monthly Report\n\nLengthy detailed report content...\n\n" + "Lorem ipsum ".repeat(200),
    summary: "Lido treasury $350M, $1.4M/mo burn, multi-chain ops nominal.",
    sentToCount: 23,
    openedCount: 19,
  }, "sent");
  await createInvestor(lidoId, { name: "Three Arrows", email: "x@3ac.dead", firm: "3AC" });

  // ─── 4. Whale ($1B+) ─────────────────────────────────────────────────────
  const whaleId = await createProject(userId, {
    name: "Whale Treasury",
    slug: "whale-treasury",
    description: "Stress test — billions in treasury, big flows.",
    tokenSymbol: "WHALE",
    wallets: [{ address: "0x" + "e".repeat(40), chain: "ethereum", label: "Mega Vault" }],
  });
  await insertSnapshots([
    makeSnapshot({
      projectId: whaleId,
      monthOffset: 1,
      treasury: 2_400_000_000,
      stables: 800_000_000,
      eth: 1_600_000_000,
      burnRate: 12_000_000,
      runwayMonths: 200,
      tokenPrice: 154.27,
      tokenMarketCap: 18_500_000_000,
      tokenHolders: 540_000,
      expenses: { payroll: 8_000_000, grants: 3_000_000, infrastructure: 1_000_000 },
      income: { revenue: 18_000_000 },
    }),
  ]);

  // ─── 5. Tiny ($500) ──────────────────────────────────────────────────────
  const tinyId = await createProject(userId, {
    name: "Tiny Solo Project",
    slug: "tiny-solo",
    description: "Pre-launch indie. Tests that small numbers don't render as $0 or NaN.",
    teamSize: 1,
    wallets: [{ address: "0x" + "f".repeat(40), chain: "ethereum", label: "My wallet" }],
  });
  await insertSnapshots([
    makeSnapshot({ projectId: tinyId, monthOffset: 1, treasury: 487.32, stables: 487.32, eth: 0, burnRate: 50 }),
  ]);

  // ─── 6. Failed sync — sync_warnings populated ────────────────────────────
  const brokenId = await createProject(userId, {
    name: "Broken Sync Project",
    slug: "broken-sync",
    description: "One wallet RPC timed out; tests partial-data UI.",
    wallets: [
      { address: "0x" + "1".repeat(40), chain: "ethereum", label: "OK wallet" },
      { address: "0x" + "2".repeat(40), chain: "polygon", label: "Timing out" },
    ],
  });
  await insertSnapshots([
    makeSnapshot({
      projectId: brokenId,
      monthOffset: 1,
      treasury: 50_000,
      stables: 50_000,
      eth: 0,
      syncWarnings: [
        { wallet: "0x" + "2".repeat(40), chain: "polygon", error: "RPC timeout >2500ms" },
      ],
    }),
  ]);

  // ─── 7. Long names (UI overflow) ────────────────────────────────────────
  const longId = await createProject(userId, {
    name: "The Foundation for the Decentralized Web — Operations & Treasury Sub-DAO Working Group",
    slug: "long-name",
    description: "Very long project name to test sidebar / list / breadcrumb truncation behavior across the dashboard layout.",
    tokenSymbol: "VERYLONGSYMBOL",
    wallets: [
      { address: "0x" + "3".repeat(40), chain: "ethereum", label: "An exceptionally verbose wallet label that should test layout limits gracefully" },
    ],
  });
  await insertSnapshots([
    makeSnapshot({ projectId: longId, monthOffset: 1, treasury: 5_000_000, stables: 1_000_000, eth: 4_000_000 }),
  ]);

  console.log(`✓ seeded 7 projects under user ${MOCK_USER_EMAIL}`);
  console.log("\nTo view: sign in via magic link with that email,");
  console.log("or insert a session row manually for direct access.");
}

// ─── main ──────────────────────────────────────────────────────────────────

(async () => {
  await cleanup();
  if (isClean) {
    console.log("✓ clean only — exiting");
    return;
  }
  await seed();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
