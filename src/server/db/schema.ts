import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// =============================================
// USERS
// =============================================
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  stripeCustomerId: text("stripe_customer_id"),
  plan: text("plan").notNull().default("free"), // free | starter | growth | vc_suite
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// PROJECTS
// =============================================
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  logoUrl: text("logo_url"),
  website: text("website"),
  description: text("description"),

  // Context for AI
  teamSize: integer("team_size"),
  foundedDate: date("founded_date"),
  lastFundingRound: text("last_funding_round"),
  lastFundingAmount: numeric("last_funding_amount"),
  tokenSymbol: text("token_symbol"),
  tokenContract: text("token_contract"),
  tokenChain: text("token_chain"),

  // GitHub
  githubOrg: text("github_org"),
  githubTokenEncrypted: text("github_token_encrypted"),

  // Report settings
  reportFrequency: text("report_frequency").default("monthly"),
  reportDay: integer("report_day").default(1),
  reportTimezone: text("report_timezone").default("UTC"),
  customBranding: jsonb("custom_branding"),

  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// WALLETS
// =============================================
export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chain: text("chain").notNull(), // ethereum | polygon | arbitrum | base | optimism | solana
    label: text("label"),
    walletType: text("wallet_type").default("eoa"), // eoa | gnosis_safe | exchange
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_wallets_address_chain").on(
      table.projectId,
      table.address,
      table.chain
    ),
  ]
);

// =============================================
// TREASURY SNAPSHOTS
// =============================================
export const treasurySnapshots = pgTable(
  "treasury_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),

    // Balances (USD at snapshot time)
    totalBalanceUsd: numeric("total_balance_usd", { precision: 20, scale: 2 }),
    stablecoinsUsd: numeric("stablecoins_usd", { precision: 20, scale: 2 }),
    ethUsd: numeric("eth_usd", { precision: 20, scale: 2 }),
    nativeTokenUsd: numeric("native_token_usd", { precision: 20, scale: 2 }),
    otherAssetsUsd: numeric("other_assets_usd", { precision: 20, scale: 2 }),
    balancesDetail: jsonb("balances_detail"),

    // Flows
    totalInflowsUsd: numeric("total_inflows_usd", { precision: 20, scale: 2 }),
    totalOutflowsUsd: numeric("total_outflows_usd", {
      precision: 20,
      scale: 2,
    }),
    netFlowUsd: numeric("net_flow_usd", { precision: 20, scale: 2 }),

    // Expense categories
    expensesByCategory: jsonb("expenses_by_category"),

    // Derived metrics
    burnRateUsd: numeric("burn_rate_usd", { precision: 20, scale: 2 }),
    runwayMonths: numeric("runway_months", { precision: 5, scale: 1 }),

    // Token metrics
    tokenHoldersCount: integer("token_holders_count"),
    tokenPriceUsd: numeric("token_price_usd", { precision: 20, scale: 8 }),
    tokenMarketCapUsd: numeric("token_market_cap_usd", {
      precision: 20,
      scale: 2,
    }),
    tokenCirculatingSupply: numeric("token_circulating_supply", {
      precision: 30,
      scale: 2,
    }),

    // GitHub metrics
    githubCommitsCount: integer("github_commits_count"),
    githubPrsMerged: integer("github_prs_merged"),
    githubContributorsActive: integer("github_contributors_active"),

    // Raw transaction data
    transactionsRaw: jsonb("transactions_raw"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_snapshot_project_date").on(
      table.projectId,
      table.snapshotDate
    ),
  ]
);

// =============================================
// REPORTS
// =============================================
export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  snapshotId: uuid("snapshot_id").references(() => treasurySnapshots.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: text("status").notNull().default("draft"), // draft | review | sent

  // Content
  contentMd: text("content_md"),
  executiveSummary: text("executive_summary"),
  highlights: jsonb("highlights"),
  founderNotes: text("founder_notes"),

  // PDF
  pdfUrl: text("pdf_url"),

  // Distribution tracking
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentToCount: integer("sent_to_count").default(0),
  openedCount: integer("opened_count").default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// INVESTORS
// =============================================
export const investors = pgTable("investors", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  firm: text("firm"),
  role: text("role"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// MILESTONES
// =============================================
export const milestones = pgTable("milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("planned"), // planned | in_progress | completed | delayed
  targetDate: date("target_date"),
  completedDate: date("completed_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
export type TreasurySnapshot = typeof treasurySnapshots.$inferSelect;
export type NewTreasurySnapshot = typeof treasurySnapshots.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type Investor = typeof investors.$inferSelect;
export type NewInvestor = typeof investors.$inferInsert;
export type Milestone = typeof milestones.$inferSelect;
export type NewMilestone = typeof milestones.$inferInsert;
