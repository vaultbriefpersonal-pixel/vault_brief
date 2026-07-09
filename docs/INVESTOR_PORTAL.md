# Investor Portal — design doc

_Status: design only (no code). TODO-005. Author date: 2026-07-01._

This document sketches the Investor Portal — the current "Now" item on
the public roadmap. It is a **design**; implementation is TODO-014 and is
gated on the approvals called out under "Forbidden areas" below. Nothing
here should be built without sign-off, because it touches auth and the DB
schema.

## Problem

Today an investor receives one report at a time: the founder clicks
"Send to investors", Resend emails each active investor a link to
`/r/<reportId>` (see `src/app/r/[reportId]/page.tsx`). That page shows a
**single** report, gated only by the report's UUID and `status='sent'`.

Gaps:
- **No history.** An investor can't see prior months in one place — they
  must dig through old emails for old links.
- **No identity.** The UUID *is* the access token; a forwarded link works
  for anyone. There's no notion of "this investor" viewing.
- **Founder toil.** Sharing the full picture means emailing every report.

## Goal

A token-gated home where an investor signs in once (to the email the
founder already has on file) and sees the **full history** of `sent`
reports for the project(s) they're an investor in — no full account, no
password, no billing (VaultBrief is free / public goods).

## Current state to build on (reuse, don't reinvent)

- **`investors` table** (`src/server/db/schema.ts:274`) — `id`,
  `projectId`, `name`, `email`, `firm`, `role`, `isActive`. This is the
  identity list; the portal authenticates against these emails.
- **`reports` table** — `status` (`draft|review|sent`), `projectId`,
  `snapshotId`, `periodStart/End`, `contentMd`. Portal lists the `sent`
  ones per project.
- **`/r/[reportId]` page** — already renders a single report with
  `ReportPreview` + `ReportWidgets` + project branding, status-gated to
  `sent`, `robots noindex`. The portal reuses these components for the
  per-report view; the portal adds the *list/history* + *identity* layer
  around them.
- **`reportEngagements`** (`schema.ts:419`) — per-recipient
  sent/opened/clicked events keyed by `recipientEmail`. Portal logins and
  views can extend this (or a sibling table) so founders see real
  engagement, not just email opens.
- **`ReportPreview`, `ReportWidgets`** (`src/components/report/`) — the
  render surface, unchanged.
- **Resend magic-link infra** — NextAuth already does passwordless email
  sign-in for founders; the portal wants the *pattern* (email a signed
  link) but scoped to investor access, not a full NextAuth account (see
  Open questions).

## Proposed data model

Reuse `investors` for identity. Add **one** new table for portal access
tokens (exact columns TBD at implementation; this is the shape):

```
investor_access
  id            uuid pk
  investorId    uuid  -> investors.id (cascade)
  tokenHash     text  (store a hash, never the raw token)
  expiresAt     timestamptz
  lastUsedAt    timestamptz null
  createdAt     timestamptz
```

- The raw token is emailed to the investor; only its hash is stored.
- Scope = the investor row → its `projectId` → that project's `sent`
  reports. An investor sees exactly the projects they're listed on.
- No change to `reports`/`projects` shape needed. Multi-project investors
  (same email across projects) resolve by matching `investors.email`.

> Adding this table is a **DB migration** → Forbidden area (approval +
> the migration itself run by a human). See below.

## Access / auth flow

1. Investor lands on `/portal` (or clicks "View all reports" in any
   report email) → enters their email.
2. If the email matches an active `investors.email`, we email a
   magic link containing a signed, single-use token (hash stored in
   `investor_access`). No enumeration: always show "check your email".
3. Link → `/portal/session?token=…` validates the hash + expiry, sets a
   short-lived, HttpOnly, SameSite cookie scoped to the portal, marks
   `lastUsedAt`.
4. Authenticated portal routes read the investor from the cookie, resolve
   their projects, and list `sent` reports (newest first).
5. Per-report view reuses the existing render (`ReportPreview` +
   `ReportWidgets`).

This is a **separate, narrower session** than the founder NextAuth
session — an investor is not a dashboard user. Keeping them distinct
avoids widening the auth surface (see Forbidden areas).

## Routes / UI (proposed)

- `/portal` — email entry ("see your reports").
- `/portal/session` — token exchange → cookie, then redirect.
- `/portal/reports` — history list for the signed-in investor (project
  name, period, sent date, open the report).
- `/portal/reports/[reportId]` — single report (reuse `/r` render), but
  access-checked against the investor's projects rather than a bare UUID.
- Keep `/r/[reportId]` working for backward-compatible one-off links.

All portal routes: `robots noindex`; allowlisted in `src/proxy.ts` like
`/r` (they run their own cookie check, not the founder auth gate).

## Engagement tie-in

Portal logins + report opens are richer signals than email opens. On a
portal view, log an event (extend `reportEngagements` with a source, or a
sibling `portal_views` table) so the founder's existing
`reports.getEngagements` panel can show "viewed in portal" alongside
email opens.

## Forbidden areas — require explicit approval before building

- **Auth/session** — the portal introduces a second session type
  (investor cookie). Any change near `src/lib/auth.ts` / `src/proxy.ts`
  allowlist is security-sensitive (see `SECURITY_NOTES.md`).
- **DB migration** — the `investor_access` (and optional `portal_views`)
  table is a schema change; migrations are approval-gated and run by a
  human, never automatically.
- **Public write path** — `/portal` email submission is unauthenticated;
  it must be rate-limited (Upstash, like `/api/chat`) and must not leak
  whether an email exists.

## Phasing (suggested, each its own task under TODO-014)

1. **Read-only history, magic-link.** `investor_access` table + `/portal`
   email flow + `/portal/reports` list reusing existing render. No
   engagement changes.
2. **Engagement tie-in.** Log portal views; surface in the founder's
   engagement panel.
3. **Polish.** Per-project filtering for multi-project investors,
   link-expiry/resend UX, optional branding per project.

## Open questions

- **Session mechanism:** custom signed cookie vs. a scoped NextAuth
  credentials provider? Custom cookie keeps investors out of the `users`
  table and off the founder auth surface — leaning that way.
- **Token lifetime:** one-time login link (short TTL) that mints a longer
  session cookie? Cookie TTL (hours? 30 days?) — a security/UX tradeoff
  for the founder to weigh.
- **Backward compat:** keep bare-UUID `/r/<id>` links forever, or migrate
  emails to portal links over time?
- **Do we still email full reports, or shift to "new report — view in
  portal" notifications?** Affects the email templates.

## Out of scope

- Any billing/paywall (VaultBrief is free — public goods).
- Investor accounts with passwords or profile management.
- Investor-side commenting / Q&A (that's TODO-017, depends on this).
