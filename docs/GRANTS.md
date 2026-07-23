# VaultBrief — public-goods grant one-pager (draft)

_Status: starting draft only. TODO-030. Author date: 2026-07-01._

This is a **draftable starting point**, not submission-ready copy. Every
program (Optimism RPGF, Arbitrum Foundation grants, Ethereum Foundation
grants) has its own application format, round-specific criteria, and
review process that changes over time — read the current round's actual
requirements before adapting this. Anything marked `[FOUNDER: ...]`
needs real input only the founder has; do not submit with those still
in place.

## Before applying — read this first

**Open-source status is unresolved and likely blocks most of these
programs.** VaultBrief's repository has no `LICENSE` file today, and
this doc doesn't establish whether the GitHub repo is public. Public-
goods funding (especially Optimism RPGF and the Ethereum Foundation) is
generally aimed at non-excludable, publicly-inspectable software —
several rounds have required a public repo as a baseline eligibility
check, not just a nice-to-have. `[FOUNDER: confirm repo visibility, and
if applying, decide on a license — MIT is the ecosystem-standard choice
(e.g. SybilShield uses it) and matches what most reviewers expect to
see.]` Do this before spending time on a full application — it may be a
hard gate, not a detail to sort out later.

Other things to verify per program before submitting (requirements
shift between rounds, so treat this as a checklist to re-verify, not
settled fact):
- Whether the specific round funds SaaS-shaped tools at all, or only
  protocol/infra-layer public goods
- KYC/entity requirements for the applicant
- Whether a live product with real users is required, or pre-launch
  ideas are eligible too

## One-line description

VaultBrief turns an on-chain treasury into an automated, investor-ready
monthly report — free, for any Web3 team.

## The problem

Web3 teams with a multi-chain treasury (the norm, not the exception —
mainnet + L2s, sometimes Solana too) have no single tool built for
*reporting that treasury to investors*. Founders either build ad-hoc
spreadsheets pulling data from several block explorers by hand every
month, or skip regular reporting entirely. Post-2022, this is also a
trust problem: LPs and token holders want visible, recurring, structured
transparency from the teams they've funded, and small teams (1–5
people) have no realistic way to sustain that manually.

This sits in a real gap: consumer wallet trackers (DeBank, Zapper)
aren't investor-report-shaped; enterprise treasury-ops platforms
(Utopia Labs, Parcel) assume a team big enough to run them. Nothing
serves the small/mid Web3 team that just needs to keep investors
informed without hiring for it.

## Why this is a public good, not a commercial product

VaultBrief is **free** — no paid plans, no trial wall, no per-account
limits (a deliberate pivot away from an earlier subscription model).
Framed as ecosystem infrastructure rather than a company product:

- **Raises the transparency floor across Web3**, not just for paying
  customers. Every team that adopts it gives its investors and token
  holders a recurring, structured, harder-to-fake accounting of treasury
  health — a collective-action problem individual teams under-invest in
  even when they'd benefit from the norm existing.
- **Non-excludable by design.** Nothing is paywalled; the entire feature
  set (multi-chain sync, AI narrative, PDF/email delivery, engagement
  tracking, anomaly alerts, multisig transparency) is available to any
  team that signs up.
- **No extractive incentive.** Without paid tiers, there's no built-in
  pressure to withhold features from free users or degrade the product
  to upsell — the free-tier *is* the whole product.
- **Ecosystem-wide trust signal, not a single company's KPI.** More
  teams reporting transparently is a public good the same way more
  audited contracts or more open-source tooling is: everyone's due
  diligence gets a little easier, not just VaultBrief's own user base.

## What's actually shipped (not aspirational)

Grounded in the current codebase (see `ROADMAP.md`'s "Current
implemented features" for the full, continuously-updated list):

- **Multi-chain treasury sync** — Ethereum, Arbitrum, Polygon, Base,
  Solana. Automated balance/inflow/outflow tracking, expense
  classification, token price/market-cap/holder metrics, GitHub
  activity — all pulled into a monthly snapshot.
- **AI-drafted investor narrative** — executive summary, wins, concerns,
  looking-ahead, generated from the snapshot + founder-entered
  milestones, not a template with blanks filled in.
- **Public investor view** (`/r/<id>`) — investors read the full report
  (KPI tiles, treasury composition, expense breakdown, trend charts,
  token/GitHub metrics) without creating an account.
- **Per-recipient engagement tracking** — which investor opened/clicked
  each report, how many times, when — a level of transparency into
  "did anyone actually read this" that most investor-update tools don't
  offer even as a paid feature.
- **Proactive anomaly alerts** — a treasury-health check independent of
  the monthly report cycle; founders get warned about a burn-rate spike
  or unusual outflow the same week, not a month later.
- **On-chain multisig transparency** — for Safe-secured treasuries,
  reports show signer count and threshold ("secured by a 3-of-5
  multisig") as a verifiable fact, not a marketing claim.
- **PDF export, custom branding, GitHub-derived dev-activity metrics,
  DAO governance proposal tracking** (Snapshot integration) — rounding
  out the reporting surface for teams with more complex investor/token-
  holder relationships than a single-founder pre-seed startup.

## Impact / who benefits

- **Founders** at small Web3 teams get investor-grade reporting without
  hiring for it or building it themselves.
- **Investors and token holders** get a recurring, structured, harder-
  to-fake view into treasury health across every team that adopts this
  — the actual public-good surface, since it compounds across the
  ecosystem rather than benefiting one company at a time.
- **The broader ecosystem** gets a small but real lift in the baseline
  transparency norm for Web3 treasuries, the same category of benefit
  RPGF-style funding is designed to reward retroactively.

`[FOUNDER: add any concrete usage numbers here if you have them —
active projects, reports sent, investors reached. Do not estimate or
round up; leave blank rather than guess if you don't have a real
number.]`

## Team

`[FOUNDER: add a short team bio here. Grant reviewers generally want to
know who's behind the project and why they're credible to sustain it —
this section intentionally has no placeholder content, since inventing
a bio would misrepresent who's actually building this.]`

## Funding ask

`[FOUNDER: specify what funding would cover — e.g. ongoing hosting/API
costs (Alchemy, Dune, OpenRouter, Vercel), continued development of the
open roadmap (see ROADMAP.md's "Future features" and "Market-fit & UX
recommendations" sections), or a specific dollar figure if the program
requires one. Do not invent a number — leave this section blank until
you have one you're prepared to justify.]`

## Links

- Product: https://vaultbrief.io
- Roadmap: https://vaultbrief.io/roadmap
- Changelog: https://vaultbrief.io/changelog
- `[FOUNDER: add the GitHub repo link here ONLY if/when it's public —
  see "Before applying" above.]`
