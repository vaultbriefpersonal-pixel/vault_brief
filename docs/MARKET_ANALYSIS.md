# Market analysis — pain points & UX recommendations

_Author date: 2026-07-01. Grounded in the current codebase (report
sections, schema, anomaly detection, notifications) — not speculation.
This doc is the reasoning behind the "Market-fit & UX recommendations"
section in `ROADMAP.md` and TODO-024 through TODO-030._

## The niche

VaultBrief sits between consumer wallet trackers (DeBank, Zapper — not
investor-report-shaped) and enterprise treasury-ops platforms (Utopia
Labs, Parcel — built for DAOs with dedicated ops headcount). The
underserved middle: **Web3 teams of 1–5 people** who need investor-grade
reporting without the operational overhead to sustain it manually.

## Pain points already solved (verified against shipped code)

| Pain | How it's addressed |
|---|---|
| Treasury spread across 5 chains, manual reconciliation via block explorers | Automated sync (ETH/Arbitrum/Polygon/Base/Solana) + expense classification |
| Post-FTX investor distrust of crypto treasuries | Read-only wallet access (no signing capability, ever), monthly cadence, anomaly detection surfaced in the narrative |
| "Do my investors even read my updates?" | Per-recipient engagement tracking (open/click, with timestamps) — most traditional investor-update tools (Visible.vc, Chronograph) don't offer this at this granularity |
| "Is the team actually shipping?" — a Web3-specific diligence signal | GitHub activity (commits/PRs/contributors) pulled directly into the report |
| DAO governance legitimacy | Snapshot proposal integration (`governance_updates` section) |
| Token-specific metrics (price/market cap/holders) — absent from traditional cap-table tools | `token_metrics` section |
| Time cost of writing a coherent monthly narrative | AI-drafted executive summary / wins / concerns / looking-ahead |

20 report section types exist (`src/server/services/report-sections.ts`)
— this is a mature product surface, not an MVP.

## Gaps identified

### 1. No multi-user access per project
Confirmed via `src/server/db/schema.ts`: no `team`/`organization`/
`member` concept anywhere. `projects.userId` is a single owner; the
`requireProject` guard checks exact ownership. Web3 founding teams of
2–4 co-founders currently have to share one login. → **TODO-026**.

### 2. Anomaly detection is monthly-only, not proactive
Confirmed via `src/server/services/report-generator.ts`: `detectAnomalies()`
is called only at report-generation time (two call sites, both feeding
the LLM prompt). There is no standalone alert path — a 60% burn-rate
spike is invisible to the founder until the next report cycle.
`src/server/services/notifications.ts`'s `NotificationType` union has no
`anomaly_detected` variant. → **TODO-024** (highest priority — reuses
existing infra, lowest risk of the batch).

### 3. Single delivery channel (email only)
Web3 teams live in Discord/Telegram more than email. No alternate
delivery path exists for "your report is ready" notifications.
→ **TODO-029**.

### 4. No historical trend visualization
Every report is a point-in-time snapshot. `treasury_snapshots` has the
data to chart burn/runway/total-balance over N months, but no aggregate
query or chart exists — trend usually matters more than a single data
point for diligence. → **TODO-027**.

### 5. Multisig configuration isn't surfaced as a trust signal
The security page states "read-only, no signing" in the abstract. LPs
commonly ask a more concrete question: how many signers, what threshold?
If a treasury wallet is a Gnosis Safe, showing "secured by a 3-of-5
multisig" directly in the investor report is a concrete, verifiable
trust signal rather than a marketing claim. → **TODO-025**.

### 6. Investor Portal (in progress, TODO-014) is scoped project-first
The current design (`docs/INVESTOR_PORTAL.md`) ties an investor's access
to one project. A VC with multiple portfolio companies on VaultBrief
gets a separate login per project. Scoping identity by email instead
(one login → every project where that email is a listed investor)
creates a real network effect: a VC who likes the portal on one
portfolio company has a direct incentive to ask their other portfolio
founders to adopt it too — an organic growth channel with no marketing
spend. This needs to be decided **before** TODO-014 implementation
starts, not retrofitted after. → **TODO-028**.

### 7. "Free / public goods" positioning has an unclaimed funding path
Post-pivot, VaultBrief has no revenue model. The "public good for Web3
transparency" framing is already implicit in the codebase and copy —
it should be made explicit and pointed at non-dilutive funding sources:
Optimism RPGF, Arbitrum Foundation grants, Ethereum Foundation grants.
This converts an existing narrative into an actual funding path instead
of leaving it as just a tagline. → **TODO-030** (a draftable one-pager;
the actual grant relationship/submission is on the founder).

## Prioritization (if done one at a time)

1. **TODO-024** — anomaly alerts outside the report cycle (reuses existing infra, lowest risk)
2. **TODO-025** — multisig transparency in the report (small footprint, strong trust signal)
3. **TODO-026** — multi-user project access (schema change, real retention value)
4. **TODO-027** — historical trend chart (frontend + one aggregate query, data already exists)
5. **TODO-028** — Investor Portal identity-level design update (must land before TODO-014 starts)
6. **TODO-029** — Discord/Telegram delivery channel
7. **TODO-030** — public-goods grant one-pager draft
