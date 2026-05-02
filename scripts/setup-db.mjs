import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Export it or load .env.local before running this script."
  );
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function run() {
  console.log("Dropping old tables...");
  await sql`DROP TABLE IF EXISTS milestones, investors, reports, treasury_snapshots, wallets, projects, users CASCADE`;

  console.log("Creating user table...");
  await sql`CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    "emailVerified" TIMESTAMP,
    image TEXT,
    avatar_url TEXT,
    stripe_customer_id TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  console.log("Creating account table...");
  await sql`CREATE TABLE account (
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT,
    PRIMARY KEY (provider, "providerAccountId")
  )`;

  console.log("Creating session table...");
  await sql`CREATE TABLE session (
    "sessionToken" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    expires TIMESTAMP NOT NULL
  )`;

  console.log("Creating verificationToken table...");
  await sql`CREATE TABLE "verificationToken" (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL,
    expires TIMESTAMP NOT NULL,
    PRIMARY KEY (identifier, token)
  )`;

  console.log("Creating projects table...");
  await sql`CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    logo_url TEXT,
    website TEXT,
    description TEXT,
    team_size INTEGER,
    founded_date DATE,
    last_funding_round TEXT,
    last_funding_amount NUMERIC,
    token_symbol TEXT,
    token_contract TEXT,
    token_chain TEXT,
    github_org TEXT,
    github_token_encrypted TEXT,
    report_frequency TEXT DEFAULT 'monthly',
    report_day INTEGER DEFAULT 1,
    report_timezone TEXT DEFAULT 'UTC',
    custom_branding JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  console.log("Creating wallets table...");
  await sql`CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    chain TEXT NOT NULL,
    label TEXT,
    wallet_type TEXT DEFAULT 'eoa',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT idx_wallets_address_chain UNIQUE (project_id, address, chain)
  )`;

  console.log("Creating treasury_snapshots table...");
  await sql`CREATE TABLE treasury_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    total_balance_usd NUMERIC(20,2),
    stablecoins_usd NUMERIC(20,2),
    eth_usd NUMERIC(20,2),
    native_token_usd NUMERIC(20,2),
    other_assets_usd NUMERIC(20,2),
    balances_detail JSONB,
    total_inflows_usd NUMERIC(20,2),
    total_outflows_usd NUMERIC(20,2),
    net_flow_usd NUMERIC(20,2),
    expenses_by_category JSONB,
    burn_rate_usd NUMERIC(20,2),
    runway_months NUMERIC(5,1),
    token_holders_count INTEGER,
    token_price_usd NUMERIC(20,8),
    token_market_cap_usd NUMERIC(20,2),
    token_circulating_supply NUMERIC(30,2),
    github_commits_count INTEGER,
    github_prs_merged INTEGER,
    github_contributors_active INTEGER,
    transactions_raw JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT idx_snapshot_project_date UNIQUE (project_id, snapshot_date)
  )`;

  console.log("Creating reports table...");
  await sql`CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    snapshot_id UUID REFERENCES treasury_snapshots(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    content_md TEXT,
    executive_summary TEXT,
    highlights JSONB,
    founder_notes TEXT,
    pdf_url TEXT,
    sent_at TIMESTAMPTZ,
    sent_to_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  console.log("Creating investors table...");
  await sql`CREATE TABLE investors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    firm TEXT,
    role TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  console.log("Creating milestones table...");
  await sql`CREATE TABLE milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    target_date DATE,
    completed_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  console.log("✓ All tables created successfully");
}

run().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
