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
  // 14-day trial window. Set on first successful sign-in (NextAuth
  // events.createUser fires once, on the row insert that happens on the
  // very first login — magic-link click or Google OAuth callback).
  // After this date, the free plan flips to read-only: existing data
  // remains visible, but writes (sync, generate, send) require an
  // upgrade. Paid plans (starter / growth / vc_suite) bypass the gate
  // entirely. Null on legacy rows; backfilled to created_at + 14d during
  // migration so existing accounts keep a sensible expiry.
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
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
  // Per-project report-template config: ordered array of
  // { id: string, enabled: boolean }. Null means "use product defaults"
  // (every section with defaultEnabled=true in report-sections.ts).
  reportSections: jsonb("report_sections"),
  // Snapshot.org governance space (e.g. "ens.eth", "uniswap"). When set,
  // the governance section can auto-import proposals via the Snapshot
  // public GraphQL API instead of forcing manual entry.
  snapshotSpace: text("snapshot_space"),

  // Optional chat-channel delivery for "new report available" pings,
  // additive alongside investor email (never a replacement). Null on
  // either pair means that channel is unconfigured — no-op.
  discordWebhookUrl: text("discord_webhook_url"),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),

  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// PROJECT MEMBERS (TODO-026, phase 1)
// Purely additive — `projects.userId` (the original owner) is untouched
// and keeps working exactly as before for existing solo-owner projects.
// This table only adds INVITED collaborators on top. `role` is admin |
// editor | viewer, but phase 1 treats every member as editor-equivalent
// (see requireProject/requireProjectAdmin in trpc/guards.ts) — viewer
// read-only enforcement is a deliberately separate follow-up task.
// =============================================
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("editor"), // admin | editor | viewer
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_project_members_project_user").on(
      table.projectId,
      table.userId
    ),
  ]
);

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
    // The next four are a WRITE-ONLY CACHE. Read `balances_detail` through
    // `composeTreasury` (treasury-composition.ts) instead — every
    // report-facing surface does, which is what lets a plain regenerate repair
    // a snapshot whose columns were computed before the project had entered its
    // token symbol. Frozen at sync time, they cannot be repaired at all.
    // Still written, and still read by the project dashboard tiles,
    // anomalies.ts and the historical treasury charts. Do not add a new reader.
    stablecoinsUsd: numeric("stablecoins_usd", { precision: 20, scale: 2 }),
    ethUsd: numeric("eth_usd", { precision: 20, scale: 2 }),
    /** wallet-sync writes the PROJECT's own token here; solana-sync writes the
     * CHAIN's gas asset. Two meanings, one column — see solana-sync.ts:103. */
    nativeTokenUsd: numeric("native_token_usd", { precision: 20, scale: 2 }),
    otherAssetsUsd: numeric("other_assets_usd", { precision: 20, scale: 2 }),
    balancesDetail: jsonb("balances_detail"),
    // { ethereum: 65000000, optimism: 5000000, base: 3200000 }. Aggregated
    // from balancesDetail at sync time so the dashboard + report don't have
    // to re-walk per-wallet data on every render. Null when no balances.
    balancesByChain: jsonb("balances_by_chain"),

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
  // Aggregate "clicked the View Full Report CTA" count. Per-recipient detail
  // lives in `report_engagements`; this is the dashboard-list summary so we
  // can show "Sent to 12 · 9 opened · 3 clicked" without joining.
  clickedCount: integer("clicked_count").default(0),

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
// MANUAL-ENTRY REPORT-SECTION DATA
// Five tables back the report sections that require founder-provided
// content (no automated source). All share a per-project shape; four
// of them scope rows to a report period via a 'YYYY-MM' text column,
// asks scope by status instead so an open ask flows into every report
// until resolved.
// =============================================
export const grants = pgTable("grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  recipient: text("recipient").notNull(),
  amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
  status: text("status").notNull().default("committed"), // committed | disbursed
  category: text("category"), // optional program/theme bucket
  period: text("period").notNull(), // 'YYYY-MM'
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const governanceProposals = pgTable("governance_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("submitted"), // submitted | passed | rejected | active
  url: text("url"), // Snapshot/Tally link
  voteResult: text("vote_result"), // free-text "78% / 22% with 14M ENS"
  period: text("period").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const partners = pgTable("partners", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type"), // partnership | integration | listing | bridge | other
  url: text("url"),
  period: text("period").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const asks = pgTable("asks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  request: text("request").notNull(),
  category: text("category"), // intros | governance | hiring | other
  status: text("status").notNull().default("open"), // open | resolved
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const qaHighlights = pgTable("qa_highlights", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  askedBy: text("asked_by"),
  period: text("period").notNull(),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// =============================================
// PROJECT BUDGETS
// The planned side of the ledger: what a founder said they intended to
// spend (or take in) for a period, so a report can put plan next to
// actual instead of only reporting actual.
//
// Per-project, per-period, manually entered — the same shape as the five
// tables above, and `period` is deliberately the identical 'YYYY-MM'
// text column as grants/partners/qaHighlights rather than a date or a
// range. Matching a budget row to a report is set membership against the
// months the reporting period touches (`matchesPeriod` in
// report-period.ts, reading `ReportSectionContext.period`): for a
// calendar month that is exactly the string equality this originally
// described, with no date arithmetic and no timezone class of bug, and
// the period-string validation the other manual sections use is reusable
// unchanged.
//
// "A quarterly budget is simply three rows" was the design intent here
// and is still ASPIRATIONAL, not implemented: `buildSide` in
// report-derived.ts builds `new Map(itemised.map(...))`, so three rows
// for the same category collapse to the last one. Plan vs Actual
// therefore gates itself to `period.kind === "month"` rather than
// reporting one month's plan against a quarter's actuals. See the
// deferred backlog for what finishing it requires.
//
// Deliberately NO foreign key to treasury_snapshots: a budget is entered
// *before* the period it describes has been synced, so the snapshot row
// it will eventually be compared against does not exist yet. The join is
// (project_id, period), resolved at read time.
// =============================================
export const projectBudgets = pgTable(
  "project_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // 'YYYY-MM'
    // Separates the expense and income namespaces, which is not cosmetic:
    // "grants" is a legitimate ExpenseCategory while income carries its
    // own disjoint set (revenue, funding_round, ...). Without `kind` a
    // category string would be ambiguous about which side it belongs to.
    kind: text("kind").notNull().default("expense"), // expense | income
    // Free text on purpose, with a '__total__' sentinel. A founder who
    // plans a single number ("we expect to spend $180K/month") writes one
    // row; a founder with a real per-category plan writes one row per
    // category. The section adapts to whichever it finds. The constraint
    // to a real ExpenseCategory/IncomeCategory member lives in the
    // SERVER's Zod input schema, not in the database — keeping it out of
    // the DB means adding a category later is a code change, not a
    // migration.
    category: text("category").notNull(), // a real category, or '__total__'
    plannedUsd: numeric("planned_usd", { precision: 18, scale: 2 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    // Unlike the five manual-section tables, budgets carry updatedAt:
    // a plan gets revised mid-period, and a report should be able to say
    // when the plan it is measuring against last changed.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // The unique key is what makes the write path an idempotent upsert
    // (`onConflictDoUpdate`): re-submitting a budget for a period edits
    // the existing row instead of silently accumulating duplicates that
    // would double-count in any plan-vs-actual sum.
    uniqueIndex("idx_project_budgets_project_period_kind_category").on(
      table.projectId,
      table.period,
      table.kind,
      table.category
    ),
  ]
);

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
export type Grant = typeof grants.$inferSelect;
export type NewGrant = typeof grants.$inferInsert;
export type GovernanceProposal = typeof governanceProposals.$inferSelect;
export type NewGovernanceProposal = typeof governanceProposals.$inferInsert;
export type Partner = typeof partners.$inferSelect;
export type NewPartner = typeof partners.$inferInsert;
export type Ask = typeof asks.$inferSelect;
export type NewAsk = typeof asks.$inferInsert;
export type QaHighlight = typeof qaHighlights.$inferSelect;
export type NewQaHighlight = typeof qaHighlights.$inferInsert;
export type ProjectBudget = typeof projectBudgets.$inferSelect;
export type NewProjectBudget = typeof projectBudgets.$inferInsert;
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
