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
  primaryKey,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// =============================================
// USERS (also serves as NextAuth "user" table)
// =============================================
export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").unique().notNull(),
  name: text("name"),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  avatarUrl: text("avatar_url"),
  stripeCustomerId: text("stripe_customer_id"),
  // Crypto subscription identifier returned by ATLOS in the postback. Lets us
  // map renewals → user without an extra "customer" table. Null until first
  // successful crypto payment.
  atlosSubscriptionId: text("atlos_subscription_id"),
  // Which provider activated the current plan: "stripe" | "atlos" | null.
  // Read on the /billing page to render the right "Manage" affordance, and
  // by the cancel-flow to know which API to call.
  paymentProvider: text("payment_provider"),
  plan: text("plan").notNull().default("free"),
  planExpiresAt: timestamp("plan_expires_at", { withTimezone: true }),
  emailNotifications: boolean("email_notifications").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// NEXTAUTH TABLES
// =============================================
export const accounts = pgTable(
  "account",
  {
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// =============================================
// PROJECTS
// =============================================
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
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
    // Income categories (revenue, funding_round, token_sale_inflow, staking_reward, airdrop, other_income)
    incomeByCategory: jsonb("income_by_category"),

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

    // Per-wallet sync failures (RPC timeout, bogus address, etc). Empty array
    // when all wallets succeeded. UI shows a badge if non-empty so founders
    // know the snapshot is partial.
    syncWarnings: jsonb("sync_warnings"),

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
// =============================================
// IN-APP NOTIFICATIONS
// Lightweight inbox: a row per event. Polled by the sidebar badge for the
// unread count and listed on /notifications.
// =============================================
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // snapshot_ready | report_generated | report_sent | sync_failed
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"), // optional deep-link, e.g. /projects/:id/reports/:reportId
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

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

// =============================================
// TOKEN PRICE CACHE
// Historical USD prices per (symbol, date). Historic prices never change,
// so rows live forever and any future sync hits the cache instead of an API.
// =============================================
export const tokenPrices = pgTable(
  "token_prices",
  {
    symbol: text("symbol").notNull(), // uppercase, e.g. "ETH", "USDC"
    priceDate: date("price_date").notNull(), // YYYY-MM-DD UTC
    usdPrice: numeric("usd_price", { precision: 24, scale: 8 }).notNull(),
    source: text("source").notNull(), // "coingecko" | "dune" | "stable"
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.symbol, t.priceDate] }),
  })
);

// =============================================
// REPORT ENGAGEMENTS
// Per-recipient email events from Resend webhooks (sent / opened / clicked /
// bounced). Enables "Investor X opened twice, never clicked" UI on report
// page — far more useful than the aggregate openedCount on reports.
// =============================================
export const reportEngagements = pgTable("report_engagements", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  eventType: text("event_type").notNull(), // sent | opened | clicked | bounced | complained
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// LLM RESPONSE CACHE
// Keyed by sha256(systemPrompt + userPrompt + model). A Regenerate against
// the same snapshot with unchanged prompts hits cache for free — no $$
// burned on idempotent calls. Old entries linger as audit/replay trail.
// =============================================
export const llmCache = pgTable("llm_cache", {
  cacheKey: text("cache_key").primaryKey(),
  snapshotId: uuid("snapshot_id"),
  model: text("model").notNull(),
  output: text("output").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// STRIPE PROCESSED EVENTS
// Idempotency log for the Stripe webhook handler. Stripe re-delivers events
// on cold-start timeouts, retries 3xx, and after dashboard "Resend" clicks;
// without this guard `customer.subscription.deleted` retried after a manual
// reactivation could downgrade a paying user back to "free".
// =============================================
export const stripeProcessedEvents = pgTable("stripe_processed_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// ATLOS PROCESSED EVENTS
// Idempotency log for the ATLOS webhook. ATLOS retries postbacks on non-2xx
// and will replay completed transactions if you click "Resend" in their
// merchant panel — same hazard as Stripe. PK on TransactionId because that's
// the unique on-chain settlement ID, monotonic per payment. We also pin the
// orderId / blockchain / asset for forensics: a single subscription can be
// renewed across multiple chains over its lifetime.
// =============================================
export const atlosProcessedEvents = pgTable("atlos_processed_events", {
  transactionId: text("transaction_id").primaryKey(),
  subscriptionId: text("subscription_id"),
  orderId: text("order_id").notNull(),
  amount: numeric("amount").notNull(),
  asset: text("asset").notNull(),
  blockchain: text("blockchain").notNull(),
  blockchainHash: text("blockchain_hash").notNull(),
  status: integer("status").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow(),
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
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type TokenPrice = typeof tokenPrices.$inferSelect;
export type NewTokenPrice = typeof tokenPrices.$inferInsert;
export type StripeProcessedEvent = typeof stripeProcessedEvents.$inferSelect;
export type NewStripeProcessedEvent = typeof stripeProcessedEvents.$inferInsert;
export type AtlosProcessedEvent = typeof atlosProcessedEvents.$inferSelect;
export type NewAtlosProcessedEvent = typeof atlosProcessedEvents.$inferInsert;
export type LlmCacheRow = typeof llmCache.$inferSelect;
export type NewLlmCacheRow = typeof llmCache.$inferInsert;
export type ReportEngagement = typeof reportEngagements.$inferSelect;
export type NewReportEngagement = typeof reportEngagements.$inferInsert;
