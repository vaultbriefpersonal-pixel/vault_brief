# VaultBrief — Deployment Guide

## Prerequisites

1. **Neon** (PostgreSQL) — free tier at neon.tech
2. **Vercel** — for Next.js hosting
3. **Trigger.dev** — for background jobs
4. **Resend** — for emails
5. **Google Cloud Console** — for OAuth
6. **Alchemy** — for on-chain data
7. **Dune** — for wallet balances

> **Billing is disabled.** VaultBrief is free / public goods — no paid
> plans, no trial. The Stripe + Atlos integration code remains in the repo
> but is dormant and requires no setup or env vars to deploy.

---

## Step 1: Database (Neon)

```bash
# Create project at neon.tech
# Copy connection string → DATABASE_URL

# Apply schema
npx drizzle-kit push
```

---

## Step 2: Auth (Google OAuth)

1. Go to console.cloud.google.com → New project
2. Enable OAuth 2.0 → Create credentials
3. Authorized redirect URIs: `https://vaultbrief.io/api/auth/callback/google`
4. Copy Client ID → `AUTH_GOOGLE_ID`
5. Copy Client Secret → `AUTH_GOOGLE_SECRET`
6. Generate auth secret: `openssl rand -base64 32` → `AUTH_SECRET`

---

## Step 3: Email (Resend)

1. resend.com → Add domain → verify DNS records
2. Create API key → `RESEND_API_KEY`
3. Set `RESEND_FROM_EMAIL=reports@yourdomain.com`

---

## Step 4: Billing — disabled (public goods)

VaultBrief is free. There are no paid plans, trial, or payment setup.

The Stripe + Atlos integration code (`billing.ts` router,
`/api/billing/checkout`, `/api/webhooks/{stripe,atlos}`, `src/lib/atlos.ts`,
`PayWithUsdcButton`) is retained in the repo but **dormant** — no
`STRIPE_*` / `ATLOS_*` env vars are required to build or deploy. To
re-introduce paid plans later, restore the limit maps + `assertTrialActive`
body in `src/server/lib/plan-limits.ts`, re-add the pricing route, and
provision the Stripe/Atlos env vars.

---

## Step 5: Trigger.dev

```bash
# Login
npx trigger.dev@latest login

# Create project at trigger.dev, copy project ID
# Update trigger.config.ts with real project ID

# Deploy jobs
npx trigger.dev@latest deploy
```

Copy `TRIGGER_SECRET_KEY` from dashboard.

---

## Step 6: Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Set all environment variables in Vercel dashboard:
# Settings → Environment Variables → paste all from .env.example
```

Required env vars for production:
- `DATABASE_URL`
- `AUTH_SECRET`
- `AUTH_URL=https://www.vaultbrief.io` — must be the canonical (www) origin. Apex `vaultbrief.io` 307s to www; using apex here drops session cookies on the redirect.
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `DUNE_API_KEY`
- `ALCHEMY_API_KEY`
- `OPENROUTER_API_KEY`
- `TRIGGER_SECRET_KEY`
- `GITHUB_TOKEN` — recommended; without it GitHub API caps at 60 req/hr per IP and snapshots record zeros for any project syncing GitHub data. Read-only `public_repo` scope is sufficient.
- `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` — optional; sets up server + browser error tracking. Without these the SDK silently no-ops (app behaves identically). To enable: create a project at sentry.io, copy the DSN to both vars, redeploy.
- `NEXT_PUBLIC_APP_URL=https://vaultbrief.io`

> Billing env vars (`STRIPE_*`, `ATLOS_*`) are **not required** — billing
> is disabled (public goods). The payment code is dormant.

---

## Step 7: Custom Domain

In Vercel dashboard → Domains → Add `vaultbrief.io`
Update DNS at your registrar as shown.

---

## Verification Checklist

- [ ] `https://vaultbrief.io` returns 200
- [ ] Login with Google works
- [ ] Magic link email arrives
- [ ] Create project → add wallet → see it listed
- [ ] Trigger.dev dashboard shows `monthly-data-sync` job
- [ ] PDF download works
- [ ] Email delivery works in Resend logs
