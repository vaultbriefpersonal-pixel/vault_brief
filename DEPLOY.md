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

## Step 4: Stripe

1. stripe.com → Create account
2. Products → Create:
   - Starter: $149/mo recurring → copy Price ID → `STRIPE_PRICE_STARTER`
   - Growth: $349/mo → `STRIPE_PRICE_GROWTH`
   - VC Suite: $999/mo → `STRIPE_PRICE_VC_SUITE`
3. API Keys → copy:
   - Secret key → `STRIPE_SECRET_KEY`
   - Publishable key → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
4. Webhooks → Add endpoint: `https://vaultbrief.io/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
   - Copy signing secret → `STRIPE_WEBHOOK_SECRET`

---

## Step 4b: Crypto Payments (ATLOS)

VaultBrief accepts USDC subscriptions through ATLOS in addition to Stripe. To enable:

1. Sign up at [merchants.atlos.io](https://merchants.atlos.io/signup) → copy the `Merchant ID` shown in the dashboard.
2. Settings → API Secret → reveal/copy → this is the HMAC secret used to sign postbacks.
3. Settings → Postback URL → set to `https://www.vaultbrief.io/api/webhooks/atlos`.
4. Set in Vercel:
   - `NEXT_PUBLIC_ATLOS_MERCHANT_ID` — public merchant ID (used by atlos.js widget)
   - `ATLOS_API_SECRET` — server-only HMAC secret (verifies postbacks)
5. Plan→price mapping is hard-coded in `src/lib/atlos.ts` (`ATLOS_PLAN_AMOUNTS`). Keep these in sync with Stripe price amounts on `/pricing`.

The widget loads on `/billing` for logged-in free-plan users. Each successful postback (Status 100) extends the user's plan by 30 days; missed renewals expire automatically. The webhook is idempotent on `TransactionId` — replays from the merchant panel are safe.

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
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_VC_SUITE`
- `TRIGGER_SECRET_KEY`
- `NEXT_PUBLIC_ATLOS_MERCHANT_ID` — required to render the "Pay with USDC" button on `/billing`. Without it the button no-ops with a console warning.
- `ATLOS_API_SECRET` — required to verify ATLOS postback signatures. Without it the webhook returns 500 and crypto payments will not activate plans even if money was received (though postbacks log on the ATLOS side and are replayable).
- `GITHUB_TOKEN` — recommended; without it GitHub API caps at 60 req/hr per IP and snapshots record zeros for any project syncing GitHub data. Read-only `public_repo` scope is sufficient.
- `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` — optional; sets up server + browser error tracking. Without these the SDK silently no-ops (app behaves identically). To enable: create a project at sentry.io, copy the DSN to both vars, redeploy.
- `STRIPE_PRICE_*_ANNUAL` — optional. To enable annual billing for the /pricing toggle: in Stripe Dashboard create three additional recurring prices (annual interval, 20% discount on the monthly amount), copy the IDs into `STRIPE_PRICE_STARTER_ANNUAL` / `STRIPE_PRICE_GROWTH_ANNUAL` / `STRIPE_PRICE_VC_SUITE_ANNUAL`. Without them checkout falls back to the monthly variant when "Annual" is selected.
- `NEXT_PUBLIC_APP_URL=https://vaultbrief.io`

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
- [ ] Stripe test checkout completes
- [ ] Stripe webhook shows 200 in Stripe dashboard
- [ ] PDF download works
- [ ] Email delivery works in Resend logs
