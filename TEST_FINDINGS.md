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
Folded into Phase 1 (covered all 7 mock-shapes during walk-through).

## Phase 3 — UI scale (mock data)

| # | Surface | Finding | Severity | Status |
|---|---|---|---|---|
| 3.1 | /wallets at 15 rows | All render, no h-scroll, page=1340px scrolls inside main | — | ✅ |
| 3.2 | Dashboard 12-month chart | Recharts auto-thins x-axis labels (5 visible: Jun '25 → Apr '26), no overlap | — | ✅ |
| 3.3 | /investors at 31 rows | Renders, scrolls; **no search/sort/filter** controls | Polish | open (defer until 100+) |
| 3.4 | /projects at 7 cards desktop | 3-column grid, mixed-height cards (long-name is taller) — acceptable | — | ✅ |

## Phase 4 — Edge / error states

| # | Scenario | Finding | Severity | Status |
|---|---|---|---|---|
| 4.1 | Project with 0 snapshots | Treasury/Burn/Runway/Stables tiles were **hidden entirely** — empty dashboard looked broken | P2 | ✅ Fixed (placeholder "—" tiles) |
| 4.2 | /investors empty | "No investors added yet" — minimal but functional | — | ✅ |
| 4.3 | /wallets empty | Add-wallet form first, "No wallets added yet" — fine | — | ✅ |
| 4.4 | /reports empty | ReportsEmptyState handles 3 branches (no snapshot / snapshot has report / snapshot ready) | — | ✅ |

## Phase 5 — Mobile / a11y

| # | Viewport | Finding | Severity | Status |
|---|---|---|---|---|
| 5.1 | 375×812 — long-name dashboard | h2 wraps to 3 lines, tiles stack, no h-scroll | — | ✅ |
| 5.2 | 375×812 — Lido dashboard (charts) | 13 charts fit (278×200 each), no h-scroll | — | ✅ |
| 5.3 | 375×812 — billing (free user) | All 3 USDC buttons fit (262 wide in 375 viewport) | — | ✅ |
| 5.4 | 375×812 — pricing comparison table | Table internal-scrolls (600 in 334 container) — graceful | — | ✅ |
| 5.5 | a11y | Color contrast `var(--vb-dim)` on dark — not formally tested with Lighthouse, defer | Polish | open |

## Phase 6 — Security spot-checks

| # | Surface | Finding | Severity | Status |
|---|---|---|---|---|
| 6.1 | `/projects/[other-user-id]` page | 404 (server component checks `userId`) | — | ✅ |
| 6.2 | tRPC `projects.getById` cross-user | NOT_FOUND via `requireProject` guard | — | ✅ |
| 6.3 | tRPC `projects.update` cross-user | NOT_FOUND — guard fires before mutation | — | ✅ |
| 6.4 | tRPC `projects.delete` cross-user | NOT_FOUND — guard fires before mutation | — | ✅ |
| 6.5 | tRPC `wallets.list` cross-user | NOT_FOUND | — | ✅ |
| 6.6 | ATLOS webhook no signature | 500 "Webhook secret not configured" (fail-closed locally); HMAC `timingSafeEqual` in code path when secret present | — | ✅ |
| 6.7 | tRPC error stack leaks file paths in dev mode | Dev-only, prod hides — Next.js default behavior | Polish | open |

## Phase 7 — Perf / bundle

| Surface | Metric | Notes |
|---|---|---|
| Total `.next/static` | 1.8 MB | Reasonable for a SaaS w/ Recharts |
| Largest chunk | 416 KB | Likely Recharts; acceptable |
| Routes | 28 (mix `○`/`ƒ`) | All build clean |

## Phase 8 — Live LLM + email send (real APIs)

| # | Surface | Finding | Severity | Status |
|---|---|---|---|---|
| 8.1 | `reports.generate` against ENS mock | Real OpenRouter→Gemini 2.5 Flash response, 100% structured: ExecSummary / Treasury table / Financial Health / Token Metrics / Dev Activity / Highlights / Risks | — | ✅ Verified |
| 8.2 | LLM omits milestones | `buildReportPrompt` never received the project's milestones — produced "Not available" despite seed having 2 active milestones | P1 | ✅ Fixed (prompts.ts + report-generator.ts) |
| 8.3 | LLM emits `$0` rows for assets the project doesn't hold | Token / Other rows render as `$0 \| 0%` instead of being suppressed | P1 | ✅ Fixed (prompt builder filters $0 lines + system prompt rule). Verified Tiny ($487 stables only) renders one row. |
| 8.4 | `investors.sendReport` against ENS mock | 2 emails dispatched via Resend, status flips to `sent`, `sentToCount=2`, in-app notification created | — | ✅ Verified |
| 8.5 | `sendReport` marks status='sent' even if all sends fail | If Resend rejects every email (sent=0), report is still flipped to "sent". Founder thinks email went out. | P1 | ✅ Fixed. All-fail → 502 BAD_GATEWAY, status stays `review`. Partial → 200 with `failures[]`, UI shows "Partially sent (N of M)". |
| 8.6 | Dev "tRPC stale" 500 | After source edits, dev sometimes serves "Internal Server Error" until restart. Not a prod issue — Next.js dev quirk. | Polish | open |

## Phase 9 — A11y / DX hardening shipped this loop

| What | Why |
|---|---|
| `--vb-dim` `#555` → `#787878` | 2.8:1 → 4.6:1 contrast on `--vb-bg` (now passes WCAG AA) |
| Global `:focus-visible` outline (accent green, 2px) | Keyboard tab-nav was invisible on dark theme |
| `<ChainIcon>` component | Replaces text chain labels on /wallets with colored brand pill |
| Investors `<input type="search">` + sort/firm filter | Renders only when ≥5 investors; collapses noise on small lists |
| tRPC `errorFormatter` strips `stack` | Even in dev, JSON responses no longer leak file paths |

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
