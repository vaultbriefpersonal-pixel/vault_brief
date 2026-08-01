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
  index,
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
    /**
     * Inclusive first day of the window every FLOW column on this row covers
     * (inflows, outflows, burn, the category breakdowns, the GitHub counters).
     * `snapshot_date` is the inclusive last day; balances are a point-in-time
     * read as of it and are not a flow.
     *
     * NULLABLE ON PURPOSE, and NULL is not "unknown": it reads as "the calendar
     * month ending on snapshot_date". Every write path that has ever existed
     * produced exactly a calendar month (`getLastMonthPeriod`, data-sync.ts,
     * and the backfill loop in trpc/routers/projects.ts), so the fallback in
     * `periodFromSnapshot` (report-period.ts) RECONSTRUCTS the true period of a
     * pre-migration row rather than inventing one — and computes the identical
     * value the migration's backfill writes. Read the period through that
     * helper, never off this column directly, so both cases stay equivalent.
     *
     * Mirrors `scripts/migrations/add-snapshot-period.mjs` exactly
     * (`ADD COLUMN IF NOT EXISTS period_start DATE`, no NOT NULL, no default):
     * a drift here is what makes a later `drizzle-kit push` propose a diff
     * instead of a no-op. See docs/MIGRATIONS.md.
     */
    periodStart: date("period_start"),

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
    // Income categories — `IncomeCategory` in expense-classifier.ts is the
    // source of truth (revenue, funding_round, token_sale_inflow,
    // staking_reward, airdrop, grant_received, other_income). Nothing asserts
    // this comment stays in step, unlike the two runtime mirrors it describes.
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

    /**
     * Where the BALANCE figures on this row came from: `'observed'` (read live
     * from chain at sync time) or `'reconstructed'` (walked back through
     * transfer history from a later observed reading). Only the balances —
     * every FLOW column on this row (inflows, outflows, burn, the category
     * breakdowns, the GitHub counters) is measured over the period either way,
     * because `fetchAndClassify` really does query that window.
     *
     * NULLABLE ON PURPOSE, and NULL is not "unknown": it reads as
     * `'observed'`. Every row written before this column existed came from
     * `fetchAllBalances`, which reads the wallets live and takes no period
     * argument — so every one of them genuinely was observed. Deliberately NOT
     * backfilled to the literal: the fallback has to handle NULL permanently
     * (the currently-deployed sync keeps writing NULL until the P3.1 code
     * ships), and a fully-populated column would hide a reader that tests
     * `=== 'observed'` positively and silently drops every legacy row. Read it
     * through `balanceBasisOf` (report-derived.ts), never off the column.
     *
     * When this is `'reconstructed'`, `token_price_usd`,
     * `token_market_cap_usd`, `token_circulating_supply` and
     * `token_holders_count` are written NULL: they come from
     * `fetchTokenMetrics`, which is current-value only and has no historical
     * mode, and a past snapshot carrying today's market cap is precisely the
     * lie this column exists to prevent.
     *
     * Mirrors `scripts/migrations/add-snapshot-balance-basis.mjs` exactly
     * (`ADD COLUMN IF NOT EXISTS balance_basis TEXT`, no NOT NULL, no default,
     * no CHECK) — a drift here is what makes a later `drizzle-kit push`
     * propose a diff instead of a no-op. See docs/MIGRATIONS.md.
     */
    balanceBasis: text("balance_basis"),
    /**
     * What the walk-back could and could not do, for a `'reconstructed'` row.
     * NULL on every observed row — there is nothing to disclose about a live
     * reading. Shape: `ReconstructionMeta` in
     * services/balance-reconstruction.ts, which owns the field docs.
     *
     * The load-bearing entries are the honest ones: how many token positions
     * went negative and had to be clamped to zero (each is an unobserved
     * credit — rebasing, staking accrual, a mint, a transfer type Alchemy does
     * not serve), and how much of the treasury could not be priced at the
     * period's own date. Both reach the reader; neither is a debug field.
     *
     * Mirrors the migration's `ADD COLUMN IF NOT EXISTS reconstruction_meta
     * JSONB`.
     */
    reconstructionMeta: jsonb("reconstruction_meta"),

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
  /**
   * Optional link to the grant award this milestone is a deliverable for.
   * Nullable, and null is the normal case: most milestones are ordinary
   * roadmap work with no funder attached. There is deliberately no
   * `is_grant_deliverable` boolean — the FK carries that fact and cannot
   * disagree with itself.
   *
   * ON DELETE SET NULL, NOT CASCADE, and the difference matters: a milestone
   * is the team's own record of shipped work and outlives whoever funded it.
   * CASCADE here would mean deleting one mistyped grant award silently
   * destroys hand-entered shipped history that `milestones_completed` and
   * `looking_ahead` report from. SET NULL degrades the row to "not attributed
   * to a grant", which is exactly what is true once the award record is gone.
   *
   * Intentionally NOT indexed — see the reasoning in
   * scripts/migrations/add-grant-awards.mjs.
   */
  grantAwardId: uuid("grant_award_id").references(() => grantAwards.id, {
    onDelete: "set null",
  }),
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
// ⚠️ MONEY THIS PROJECT GAVE OUT. Not the same thing as `grantAwards` below,
// which is money this project RECEIVED. The names differ by one word and the
// two must never be merged — see the header above `grantAwards`.
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
// ⚠️ AWARDS THIS PROJECT RECEIVED — the mirror of `grants` above, which is
// money this project GAVE OUT. Different direction, different reader.
// Do not merge them.
//
// `grants` answers an INVESTOR's question: how efficiently did you deploy
// capital outward (`recipient`, `status: committed|disbursed`, and "grants" is
// itself an ExpenseCategory in expense-classifier.ts, narrated by the
// `grants_distributed` section as deployment efficiency).
//
// `grantAwards` answers a GRANTOR's question: what did you do with the money
// we gave you (`grantor`, a disbursement schedule in `grantTranches`, and
// milestones attributed back to the award). Nothing about the two shapes is
// interchangeable — `recipient` and `grantor` are not the same field with a
// different name, they are opposite ends of the same transfer.
//
// The tempting shortcut is one table with a `direction` column. It was
// rejected: every existing consumer would then need a filter, and forgetting
// one reports an outbound disbursement to a funder as an inbound award — a
// wrong number in a document that decides whether the project gets paid.
// Two tables make that unrepresentable.
//
// Mirrors scripts/migrations/add-grant-awards.mjs exactly (column types,
// nullability, delete actions and all three indexes) — drift is what turns a
// later `drizzle-kit push` into a diff instead of a no-op. See docs/MIGRATIONS.md.
// =============================================
export const grantAwards = pgTable(
  "grant_awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    grantor: text("grantor").notNull(), // 'Optimism Foundation'
    program: text("program"), // 'RetroPGF Round 4'
    /**
     * NULLABLE ON PURPOSE, and the asymmetry with `grantTranches.amountUsd`
     * (NOT NULL) is the point. An award may be denominated only in tokens —
     * "30M OP" with no USD figure anywhere in the agreement — and writing a
     * converted number here would state a precision the grant never had, in a
     * field a report quotes back to the grantor as "Awarded". A tranche is a
     * disbursement line by contrast: a schedule entry carrying no amount is
     * not a fact about anything, so that column is NOT NULL.
     */
    awardAmountUsd: numeric("award_amount_usd", { precision: 18, scale: 2 }),
    // Token-denominated awards. Scale 8 matches the token-price cache, so a
    // whole-token award and a fractional one round the same way.
    awardAmountToken: numeric("award_amount_token", {
      precision: 30,
      scale: 8,
    }),
    awardTokenSymbol: text("award_token_symbol"),
    /**
     * NOT A DUPLICATE OF `awardAmountUsd`, and reading it as one is how a
     * report quotes a grantor a number their grant never contained.
     *
     * `awardAmountUsd` is the figure STATED IN THE AGREEMENT — nullable
     * precisely because a token-denominated award ("30M OP") states none.
     * This column is what those tokens were ACTUALLY WORTH WHEN THEY LANDED:
     * an observation about a disbursement, not a term of the agreement. For
     * that 30M OP the two differ by whatever the token did between signature
     * and receipt, and both are true at once — "awarded 30M OP" and "received
     * $48.2M of OP" are different sentences about different moments.
     *
     * So the two must never substitute for each other: printing this under
     * "Awarded" overstates or understates the award by the token's drift, and
     * printing `awardAmountUsd` under "Received" asserts a USD receipt that
     * never happened. NULL here means nobody recorded a receipt value — never
     * "same as awarded".
     */
    amountUsdAtReceipt: numeric("amount_usd_at_receipt", {
      precision: 18,
      scale: 2,
    }),
    // Anchors "since we received the grant" — the period preset a grant
    // report defaults to. NOT NULL because an award with no date cannot
    // anchor a reporting window, which is the table's whole purpose.
    awardDate: date("award_date").notNull(),
    // Optional override for when reporting obligations actually start;
    // defaults to awardDate when null. Some agreements are signed one month
    // and start their reporting clock the next.
    reportingStartDate: date("reporting_start_date"),
    // How often this grantor expects to hear from us: monthly | quarterly |
    // milestone_based | ad_hoc. Free text in the DATABASE on purpose — the
    // constraint to a real member of that set lives in the SERVER's Zod input
    // schema, exactly as projectBudgets.category does, so that adding a
    // cadence later is a code change rather than a migration. NULL means the
    // agreement did not state a cadence, which is common and not an error.
    reportingCadence: text("reporting_cadence"),
    // The next date a report is owed. Drives the Stage 8 reminders; nothing
    // reads it yet. NULL means "no date set", not "nothing due".
    nextReportDue: date("next_report_due"),
    status: text("status").notNull().default("active"), // active | completed | terminated
    agreementUrl: text("agreement_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    // Like projectBudgets and unlike the five manual-section tables: an award
    // record gets corrected (a tranche renegotiated, a status flipped to
    // completed) and a report should be able to say when it last changed.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // Postgres indexes primary keys and unique constraints automatically but
    // NOT plain foreign keys. Without this, "list this project's awards" — the
    // only read path — is a sequential scan, and deleting a project has to
    // seq-scan this table to apply the CASCADE.
    index("idx_grant_awards_project").on(table.projectId),
  ]
);

// A disbursement schedule line. Not every award pays out at once; a grantor
// typically releases against milestones, and "received to date" is the sum of
// the lines whose receivedDate is set — never a treasury balance, because
// money is fungible and a balance cannot say which dollars came from where.
export const grantTranches = pgTable(
  "grant_tranches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grantAwardId: uuid("grant_award_id")
      .notNull()
      // CASCADE is right here, unlike on milestones.grantAwardId: a tranche is
      // a line in THIS award's schedule and has no meaning without it. An
      // orphaned "$50,000, expected 2026-09-01" row would describe nothing.
      .references(() => grantAwards.id, { onDelete: "cascade" }),
    /**
     * Reachable via grantAwardId, so redundant as data — kept as an ownership
     * handle. Every guard in trpc/guards.ts has the same shape: resolve the
     * row, hand `row.projectId` to `requireProject`. This column is what lets
     * `requireGrantTranche` keep that shape instead of joining through
     * grantAwards first, and it is what the project-scoped list filters on.
     */
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(), // 'Tranche 1 — on signature'
    amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }).notNull(),
    expectedDate: date("expected_date"),
    receivedDate: date("received_date"), // NULL = not yet disbursed
    txHash: text("tx_hash"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_grant_tranches_award").on(table.grantAwardId),
    index("idx_grant_tranches_project").on(table.projectId),
  ]
);

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
// Awards RECEIVED — not `Grant`/`NewGrant` above, which is money given out.
export type GrantAward = typeof grantAwards.$inferSelect;
export type NewGrantAward = typeof grantAwards.$inferInsert;
export type GrantTranche = typeof grantTranches.$inferSelect;
export type NewGrantTranche = typeof grantTranches.$inferInsert;
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
