# Investor-report sections — research

Reference document compiled from 5 real public reports during Phase 1 of
the report-template constructor work (`plans/1-typed-lightning.md`).
Used to ground the section library in `report-sections.ts`.

## Sources surveyed

| # | Source | Format | Cadence |
|---|---|---|---|
| 1 | Lido — Monthly Report (September 2023) | Long-form blog | Monthly |
| 2 | Lido — Tokenholder Update (February 2026) | Quarterly recap | Quarterly |
| 3 | Aave — Q1 2023 Financial Report | Forum post | Quarterly |
| 4 | Uniswap Foundation — FY 2025 Financials | Forum post | Quarterly + annual |
| 5 | Optimism — Governance Report (November 2024) | Forum post | Monthly |
| 6 | Gitcoin — GG24 Round Progress Report (Dec 2025) | Forum post | Per-round |

Six sources read; five used for cross-source pattern matching (Gitcoin's
post-mortem-style report is structurally distinct and informs only the
"What worked / what didn't" pattern).

## Patterns by frequency

### Universal — appears in 5/5 sources

- **TL;DR / Key Takeaways / Executive Summary** at the top of every
  report. Lido calls it "Key Takeaways", Aave folds it into "Key
  Ecosystem Developments", Optimism uses "Key Insights", Uniswap uses
  "Introduction." Same job: 3-5 bullet/sentence overview of what changed
  this period. Investors who only read the first 30 seconds need to
  walk away knowing the headline.

- **Forward-looking block.** Lido September 2023 has "Looking Ahead –
  October 2023"; February 2026 has "Q2 2026 Focus"; Gitcoin has "Next
  Steps." Every report ends pointing at the next period.

### Common — appears in 3+ sources

- **Treasury composition / assets on hand.** Lido "Treasury Composition";
  Uniswap "Assets on Hand and Projected Funds Usage"; Aave's revenue +
  treasury holdings narrative. Where the money is, in what form.

- **Operating expenses / financial breakdown.** Uniswap explicitly
  charts "Ops expenses by category (payroll, contracts, office, events,
  advertising, insurance)"; Aave reports quarterly revenue + cash flow
  positioning; Lido reports DAO expense changes. **The category list
  varies wildly across sources** — payroll is universal but the rest
  reflects org structure (grants for foundations, contracts for ops
  teams).

- **Grants committed / disbursed.** Uniswap leads here (Q4 Commitments
  + Q4 Disbursements as separate sections); Optimism reports Grants
  Council activity + RetroPGF totals. Specific to foundations + grant-
  giving DAOs. Not relevant for non-grant-issuing protocols.

- **Governance updates.** Lido lists Snapshot + Aragon proposals with
  voting outcomes; Optimism reports proposal counts, delegate votes,
  voting power distribution. Specific to projects with active on-chain
  governance.

- **Community / engagement metrics.** Lido "Community" section;
  Optimism "Community Overview" with social follower counts; Gitcoin
  details participants per round. Soft metrics — useful for
  early-stage projects, less so for mature treasuries.

### Specific to format / shape

| Pattern | Where seen | When applicable |
|---|---|---|
| **Q&A Highlights** | Lido tokenholder-update format | When the report came out of a live AMA / call. Optional add-on. |
| **What worked / What hasn't** | Gitcoin post-mortem style | After-action review for one-off initiatives (rounds, programs, hackathons). |
| **Token / buyback actions** | Lido, Aave | When the project has token-treasury actions (buybacks, programmatic sales) that period. |
| **Partners / collaborations** | Lido, Gitcoin | When new integrations / partnerships shipped. |
| **Token metrics (price, mcap, holders)** | None of the foundation reports — covered by Messari etc. | We include this because retail investors expect it; foundations don't because they don't analyze their own token in their own report. |
| **Anomaly callout** | Optimism's "Special Voting Cycle" | When something unusual happened that needs explicit framing. |

### Notable absences from the foundation-style reports

- **Asks / what we need from investors** — surprisingly absent from all
  five foundation/DAO reports. This is a SaaS-investor-letter convention
  more than a DAO one. Founders running smaller protocols (where
  investors are still retail) would benefit from it; established
  foundations don't ask.
- **Per-chain breakdown** — implicit ("Aave V3 launches across chains"
  bullets) but never a dedicated chart. Our `treasury_by_chain` is a
  product opinion, not a copy of an existing pattern.
- **Burn rate / runway** — Uniswap mentions runway ("supports activities
  through January 2027") but as a single sentence, not a section. Aave
  references "cash flow positive" but no explicit burn / runway block.
  We're more aggressive than the public examples.

## Section inventory for the library

Final pre-codification list, in suggested default order. Each entry:
`id` | `title` | when on by default | dependency.

| Order | id | Title | Default | Requires |
|---|---|---|---|---|
| 1 | `executive_summary` | Executive Summary | always | always |
| 2 | `wins` | Wins this month | always | LLM extracts from snapshot |
| 3 | `lows_concerns` | Lows / Concerns | always | LLM extracts |
| 4 | `treasury_overview` | Treasury Overview | always | `totalBalanceUsd > 0` |
| 5 | `treasury_by_chain` | Treasury by Chain | yes | `balancesByChain` ≥ 2 chains |
| 6 | `previous_month_comparison` | Month-over-Month | yes | `prevSnapshot` exists |
| 7 | `financial_health` | Financial Health (burn, runway) | yes | `burnRateUsd > 0` |
| 8 | `expense_breakdown` | Operating Expenses | yes | `expensesByCategory` non-empty |
| 9 | `treasury_operations` | Treasury Operations | yes | `token_sale` outflows present |
| 10 | `grants_distributed` | Grants Distributed | OFF | Off-by-default; foundations enable |
| 11 | `token_metrics` | Token Metrics | yes | `project.tokenSymbol` set |
| 12 | `governance_updates` | Governance Updates | OFF | DAO-specific; user opts in |
| 13 | `development_progress` | Development Progress | yes | GitHub data > 0 |
| 14 | `milestones_completed` | Milestones Completed | yes | milestones with `status='completed'` this period |
| 15 | `partners_integrations` | Partners & Integrations | OFF | User opts in |
| 16 | `anomalies` | Anomalies | yes | anomalies detector returns hits |
| 17 | `looking_ahead` | Looking Ahead | yes | active milestones OR funding round |
| 18 | `asks` | Asks | OFF | User opts in |
| 19 | `qa_highlights` | Q&A Highlights | OFF | Manual entry; user opts in |

19 sections — slightly more than the 12-15 estimated in the plan. Three
factors expanded the count:

1. **Splitting today's "Key Highlights"** (mixed positives + concerns)
   into separate `wins` and `lows_concerns` sections — clearer for
   investors and matches what real reports do.
2. **Foundation-specific sections** (`grants_distributed`,
   `governance_updates`, `partners_integrations`) added off-by-default
   for projects that aren't foundations.
3. **`qa_highlights`** added off-by-default for projects whose report
   ships as a quarterly tokenholder call recap.

## Default templates by project shape

The constructor UI will offer 3 starting templates. The user can
toggle/reorder from any starting point.

### "Protocol" (default — what new projects get)

`executive_summary` → `wins` → `lows_concerns` → `treasury_overview` →
`treasury_by_chain` (auto-skip if 1 chain) → `previous_month_comparison`
→ `financial_health` → `expense_breakdown` → `treasury_operations` →
`token_metrics` → `development_progress` → `milestones_completed` →
`anomalies` → `looking_ahead`

### "Foundation / Grant program"

Same as Protocol, plus `grants_distributed` after `expense_breakdown`,
plus `governance_updates` before `development_progress`. Drop
`token_metrics` if no own token.

### "Solo project / pre-token"

`executive_summary` → `wins` → `lows_concerns` → `treasury_overview` →
`previous_month_comparison` → `financial_health` →
`development_progress` → `milestones_completed` → `looking_ahead` →
`asks`. Skip everything token-related.

## Cross-pattern observations

- **Charts and visualizations are universal** in formal foundation
  reports (Uniswap, Optimism), absent from informal blogs (Lido
  September 2023). Our PDF chart pipeline (Phase B) lines up with the
  formal end of the spectrum, which is correct for a paid product.
- **Length varies wildly:** Aave Q1 2023 is short, Uniswap FY 2025 is
  comprehensive. Founders' actual investors will calibrate to one or
  the other. The constructor lets them pick.
- **No two reports have identical section orders.** That's the strongest
  argument for the constructor — one-size-fits-all is wrong by
  construction.
- **The system-prompt's "silence beats placeholders" rule (commit
  `2be523d`) maps directly onto how real reports handle empty
  sections: they just drop them.** Aave doesn't have a "Grants" section
  because Aave doesn't run a grants program. Real reports omit; ours
  must too.

## Sources

- [Lido Monthly Report: September 2023](https://blog.lido.fi/lido-monthly-report-september-2023/)
- [Recap: Lido Tokenholder Update: February 2026](https://blog.lido.fi/recap-lido-tokenholder-update-february-2026/)
- [Aave Q1 2023 Financial Report](https://governance.aave.com/t/q1-2023-financial-report/12838)
- [Uniswap Foundation: Summary FY'2025 Financials](https://gov.uniswap.org/t/uniswap-foundation-summary-fy-2025-financials/26068)
- [Optimism Governance Report: November 2024 Update](https://gov.optimism.io/t/governance-report-november-2024-update/9360)
- [Gitcoin GG24 Public Goods Tooling Round — December 2025 Progress Report](https://gov.gitcoin.co/t/gg24-public-goods-tooling-development-round-december-2025-progress-report/24912)
