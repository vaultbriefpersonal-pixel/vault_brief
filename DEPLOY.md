# VaultBrief — Deployment Guide

## Prerequisites

1. **Neon** (PostgreSQL) — free tier at neon.tech
2. **Vercel** — for Next.js hosting
3. **Trigger.dev** — for background jobs
4. **Stripe** — for billing
5. **Resend** — for emails
6. **Google Cloud Console** — for OAuth
7. **Alchemy** — for on-chain data
8. **Dune** — for wallet balances

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
3. Authorized redirect URIs: `https://vaultbrief.com/api/auth/callback/google`
4. Copy Client ID → `AUTH_GOOGLE_ID`
5. Copy Client Secret → `AUTH_GOOGLE_SECRET`
6. Generate auth secret: `openssl rand -base64 32` → `AUTH_SECRET`

---

## Step 3: Email (Resend)

1. resend.com → Add domain → verify DNS records
2. Create API key → `RESEND_API_KEY`
3. Set `RESEND_FROM_EMAIL=reports@yourdomain.com`

---

## Step 4: Stripe

1. stripe.com → Create account
2. Products → Create:
   - Starter: $149/mo recurring → copy Price ID → `STRIPE_PRICE_STARTER`
   - Growth: $349/mo → `STRIPE_PRICE_GROWTH`
   - VC Suite: $999/mo → `STRIPE_PRICE_VC_SUITE`
3. API Keys → copy:
   - Secret key → `STRIPE_SECRET_KEY`
   - Publishable key → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
4. Webhooks → Add endpoint: `https://vaultbrief.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
   - Copy signing secret → `STRIPE_WEBHOOK_SECRET`

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
- `AUTH_URL=https://vaultbrief.com`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `DUNE_API_KEY`
- `ALCHEMY_API_KEY`
- `OPENROUTER_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_VC_SUITE`
- `TRIGGER_SECRET_KEY`
- `GITHUB_TOKEN` — recommended; without it GitHub API caps at 60 req/hr per IP and snapshots record zeros for any project syncing GitHub data. Read-only `public_repo` scope is sufficient.
- `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` — optional; sets up server + browser error tracking. Without these the SDK silently no-ops (app behaves identically). To enable: create a project at sentry.io, copy the DSN to both vars, redeploy.
- `STRIPE_PRICE_*_ANNUAL` — optional. To enable annual billing for the /pricing toggle: in Stripe Dashboard create three additional recurring prices (annual interval, 20% discount on the monthly amount), copy the IDs into `STRIPE_PRICE_STARTER_ANNUAL` / `STRIPE_PRICE_GROWTH_ANNUAL` / `STRIPE_PRICE_VC_SUITE_ANNUAL`. Without them checkout falls back to the monthly variant when "Annual" is selected.
- `NEXT_PUBLIC_APP_URL=https://vaultbrief.com`

---

## Step 7: Custom Domain

In Vercel dashboard → Domains → Add `vaultbrief.com`
Update DNS at your registrar as shown.

---

## Verification Checklist

- [ ] `https://vaultbrief.com` returns 200
- [ ] Login with Google works
- [ ] Magic link email arrives
- [ ] Create project → add wallet → see it listed
- [ ] Trigger.dev dashboard shows `monthly-data-sync` job
- [ ] Stripe test checkout completes
- [ ] Stripe webhook shows 200 in Stripe dashboard
- [ ] PDF download works
- [ ] Email delivery works in Resend logs
