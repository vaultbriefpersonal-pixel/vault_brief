# VaultBrief — Test Findings Log

Living document. Each finding gets a row. **Severity** drives commit batching:
P0 ships in the same hour. P2/Polish gets batched at end of phase.

| Severity | Means |
|---|---|
| **P0** | Blocks core flow / data loss / security / payment |
| **P1** | Visible bug, has workaround, hurts trust |
| **P2** | Cosmetic / annoying / non-default-path |
| **Polish** | Nice-to-have, won't block ship |

---

## Phase 0 — Setup (DONE)
- `scripts/seed-mock.mjs` — IDEMPOTENT seed, 7 project shapes under `mock-test@vaultbrief.local`
- Run: `node scripts/seed-mock.mjs`  ·  Reset only: `node scripts/seed-mock.mjs --clean`

## Phase 1 — Happy-path real cycle

| # | Step | Finding | Severity | Status |
|---|---|---|---|---|
| 1.1 | Whale dashboard ($2.4B treasury) | `formatUsd` capped at `M`, showed `$2400.0M` instead of `$2.4B` | P1 | ✅ Fixed (utils.ts) |
| 1.2 | Broken Sync project dashboard | `sync_warnings` JSONB populated but no UI affordance — founders see plausible numbers, send wrong report | P1 | ✅ Fixed (banner on project page) |
| 1.3 | Settings page on 1440×900 | "Delete project" button below the fold; user reported as missing twice | P1 | ✅ Fixed (anchor link from header) |
| 1.4 | Reports list page | Generate Report button correctly disables when latest snapshot has report — works | — | ✅ Verified |
| 1.5 | Report editor (status=review) | "Send to investors" button surfaces correctly; status flow draft → review → sent | — | ✅ Verified |
| 1.6 | Tiny Solo Project ($487.32) | Cents preserved, Runway "—" when null — acceptable | — | ✅ Verified |
| 1.7 | Lido multi-chain (4 wallets, 6 snaps) | Charts render across 6 months; tiles aggregate correctly | — | ✅ Verified |
| 1.8 | Wallets page (Lido) | Chains shown as text only — no icons. Polish-tier — adds at-a-glance recognition | Polish | open |
| 1.9 | Long-name project (86-char title) | Single-line on desktop ≥1180px main; needs mobile retest | — | check Phase 5 |

## Phase 2 — Variant cycles

| # | Scenario | Finding | Severity | Status |
|---|---|---|---|---|
| | _Empty_ | | | |

## Phase 3 — UI scale (mock data)

| # | Page | Finding | Severity | Status |
|---|---|---|---|---|
| | _Empty_ | | | |

## Phase 4 — Edge / error states

| # | Scenario | Finding | Severity | Status |
|---|---|---|---|---|
| | _Empty_ | | | |

## Phase 5 — Mobile / a11y

| # | Viewport | Finding | Severity | Status |
|---|---|---|---|---|
| | _Empty_ | | | |

## Phase 6 — Security spot-checks

| # | Surface | Finding | Severity | Status |
|---|---|---|---|---|
| | _Empty_ | | | |

## Phase 7 — Perf / bundle

| # | Page | Metric | Finding | Severity |
|---|---|---|---|---|
| | _Empty_ | | | |

---

## Pre-existing bugs already fixed in this session

| What | Severity | Fixed in |
|---|---|---|
| Apex AUTH_URL dropped sessions on www | P0 | Vercel env (manual) |
| Route conflict at "/" | P1 | `d0823e5` (then revert auto-redirect in `03fa878`) |
| Sidebar height didn't fill viewport | P2 | `b504e5c` |
| `github_org` allowed leading whitespace → silent 404 → 0 commits | P0 | DB trim + zod `.trim()` in `7af8b02` |
| Wallet duplicate-add showed raw drizzle "Failed query" | P1 | `9735eea` |
| Onboarding form had no wallet field | P1 | `a89347f` |
| Billing onboarding nudge ignored project count | P2 | `48b99f2` |
| Free-trial copy "1 wallet" misrepresented limit (actual 5) | P2 | `03fa878` |
| No "Generate report" button when reports list non-empty | P1 | `03fa878` |
| ATLOS env vars / signature verification | P0 | `ea80e45` |
