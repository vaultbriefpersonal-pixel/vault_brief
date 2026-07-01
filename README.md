# VaultBrief

Automated, investor-ready monthly reports for crypto teams. Connect your
treasury wallets once; VaultBrief syncs on-chain balances, classifies
expenses, pulls token and GitHub metrics, drafts an AI narrative, and
emails a branded report your investors read at a public link — no account
required on their end.

Live in production at **[vaultbrief.io](https://vaultbrief.io)**.

> **Read-only on-chain.** VaultBrief never signs or sends transactions and
> holds no private keys. There are no smart contracts in this repo.

## What it does

- **Treasury sync** across Ethereum, Arbitrum, Polygon, Base, and Solana
- **Expense classification** + token price / market-cap / holder metrics
- **GitHub activity** (commits, merged PRs, active contributors)
- **AI narrative** generated from each monthly snapshot
- **Report editor** with live KPI / treasury / expense / token widgets
- **Public investor view** at `/r/<id>` with custom branding, plus PDF export
- **Email distribution** with per-recipient open/click engagement tracking
- **Free — a public good.** No paid plans, no trial, no per-account limits

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · tRPC v11 ·
Drizzle ORM + Neon Postgres · NextAuth v5 (Google + Resend magic-link) ·
Trigger.dev (scheduled jobs) · Resend · Alchemy / Dune / Helius · OpenRouter
(LLM) · Upstash Redis · Vercel (hosting + Blob) · Sentry.

## Local setup

```bash
npm install
npm run dev      # http://localhost:3000
```

The app needs environment variables for its external services (database,
auth, email, on-chain data, billing). These are **not** committed — see
`DEPLOY.md` for the full list and how to provision each service. With
placeholder values the app builds, but live features stay inert.

## Common commands

```bash
npm run dev       # dev server
npm run build     # production build (also full typecheck)
npm run lint      # eslint
npm run test:e2e  # Playwright end-to-end suite
```

See **[VERIFY.md](VERIFY.md)** for the complete, authoritative list of
verification commands (including E2E against a deployed URL and
approval-gated database commands).

## Project layout

```
src/app/          routes — (marketing), (auth), (dashboard), r/[reportId], api/
src/components/    UI — marketing, report, settings, ui
src/server/        db (Drizzle schema), trpc routers, services, jobs
src/lib/           auth, utils, chains, billing helpers, trpc client
e2e/               Playwright specs (E1–E13)
scripts/           seed + smoke scripts, migrations
```

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — system map, routes, data flow
- **[DEPLOY.md](DEPLOY.md)** — services and environment setup
- **[VERIFY.md](VERIFY.md)** — how to build, test, and validate
- **[ROADMAP.md](ROADMAP.md)** — what's shipped and what's next
- **[SECURITY_NOTES.md](SECURITY_NOTES.md)** — sensitive areas and rules
- **[AGENTS.md](AGENTS.md)** — conventions for contributors and AI agents

## Contributing

Work proceeds one small task at a time from `TODO.md` on short-lived
`task/...` branches; see `AGENTS.md` and `DECISIONS.md` for the workflow.
Never commit secrets or `.env` files, and never push directly to `main`.
