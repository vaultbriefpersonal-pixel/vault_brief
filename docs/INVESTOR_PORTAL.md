# Investor Portal — design doc

_Status: design only (no code). TODO-005, revised by TODO-028.
Author date: 2026-07-01 (original), 2026-07-02 (identity-scoping revision)._

This document sketches the Investor Portal — the current "Now" item on
the public roadmap. It is a **design**; implementation is TODO-014 and is
gated on the approvals called out under "Forbidden areas" below. Nothing
here should be built without sign-off, because it touches auth and the DB
schema.

> **Binding decision (TODO-028, must land before TODO-014 starts):**
> Investor access is scoped by **email identity across every project**
> that email is listed on — not one login per project. The original
> draft's data model (below, since corrected) tied an access token to a
> single `investors.id` row, which is one specific project. A VC who
> backs three portfolio companies on VaultBrief would have gotten three
> separate logins under that design. See "Proposed data model" and
> "Data-model implications" for the corrected shape — get this right
> before writing any TODO-014 code, because retrofitting identity
> scoping onto a shipped project-scoped token table means a second
> migration and an auth-surface change after the fact, not before.

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

A token-gated home where an investor signs in **once, with one email**,
and sees the **full history** of `sent` reports across **every project**
that email is listed as an active investor on — not a separate login
per project. No full account, no password, no billing (VaultBrief is
free / public goods). This cross-project scoping is also a deliberate
growth lever: a VC who likes the portal on one portfolio company has a
direct incentive to get their other portfolio founders onto VaultBrief
too, since it's the same login either way.

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

Reuse `investors` for identity — **do not** key the access token to a
single `investors.id` row. That row is per-project (`investors.projectId`
is a required FK), so a token scoped to one row can only ever unlock one
project. Key the token to the **email** instead, and resolve projects at
session time by querying every `investors` row that matches:

```
investor_access
  id            uuid pk
  email         text  (normalized lowercase at write time)
  tokenHash     text  (store a hash, never the raw token)
  expiresAt     timestamptz
  lastUsedAt    timestamptz null
  createdAt     timestamptz
```

- The raw token is emailed to the investor; only its hash is stored.
- Scope resolution: `SELECT DISTINCT projectId FROM investors WHERE
  LOWER(email) = LOWER(:email) AND isActive = true` — the investor sees
  every project that query returns, not just one. Re-run this on every
  portal request (or cache briefly) rather than baking the project list
  into the token, so adding/removing the investor from a project takes
  effect without re-issuing anything.
- No change to `reports`/`projects` shape needed — this is a **read
  pattern change** (query across `investors` rows by email instead of
  by a single row's id), not a new relationship. The existing schema
  already supports one email having many `investors` rows (one per
  project); the original design just never queried it that way.

> Adding the `investor_access` table is still a **DB migration** →
> Forbidden area (approval + the migration itself run by a human). See
> below. Note this table is actually *smaller* in this corrected design
> — one token type serves every project the investor is on, instead of
> needing a separate token per project.

## Data-model implications (TODO-028)

- **No `investors` schema change.** Cross-project resolution is a query
  pattern (`WHERE LOWER(email) = ...`), not a new column or relation.
- **`investor_access` keys on `email`, not `investorId`.** This is the
  one actual schema difference from the original draft — smaller than
  before, since it's a single row per investor identity rather than
  one per (investor, project) pair.
- **Case-insensitive matching is load-bearing.** `investors.email` is
  founder-entered free text today, not normalized. Either normalize on
  write (lowercase before insert, in the existing `investors.add`
  mutation) or always compare with `LOWER(...)` at read time — pick one
  and apply it everywhere reports/portal touch investor email, not just
  in the new portal code path. Flagged again under "Open questions".
- **`/portal/reports` needs a per-row project label.** Single-project
  scoping made "which project is this report for" implicit; multi-
  project scoping means the history list must show the project name
  (or logo) next to each report, not just period + status.
- **Engagement logging is unaffected.** `reportEngagements` is already
  keyed per-report, not per-identity — a portal view of report X still
  logs against report X regardless of how many other projects that
  investor can also see. No change needed there.

## Access / auth flow

1. Investor lands on `/portal` (or clicks "View all reports" in any
   report email) → enters their email.
2. If the email matches at least one active `investors.email` row
   (in any project), we email a magic link containing a signed,
   single-use token (hash + normalized email stored in
   `investor_access`). No enumeration: always show "check your email"
   regardless of whether a match was found.
3. Link → `/portal/session?token=…` validates the hash + expiry, sets a
   short-lived, HttpOnly, SameSite cookie carrying the **email** (not a
   project or investor-row id), marks `lastUsedAt`.
4. Authenticated portal routes read the email from the cookie, resolve
   **every** project that email is an active investor on (the `investors`
   query from "Proposed data model"), and list `sent` reports across all
   of them (newest first, project name shown per row).
5. Per-report view reuses the existing render (`ReportPreview` +
   `ReportWidgets`), access-checked by confirming the report's project is
   in the resolved set for that email — not just "does this report exist".

This is a **separate, narrower session** than the founder NextAuth
session — an investor is not a dashboard user. Keeping them distinct
avoids widening the auth surface (see Forbidden areas).

## Routes / UI (proposed)

- `/portal` — email entry ("see your reports").
- `/portal/session` — token exchange → cookie, then redirect.
- `/portal/reports` — history list for the signed-in investor, spanning
  every project their email is listed on. Each row shows **project name
  (or logo)**, period, sent date — the project label is no longer
  optional the way it would have been under single-project scoping.
- `/portal/reports/[reportId]` — single report (reuse `/r` render), but
  access-checked against the investor's resolved project set (email →
  every matching `investors` row's `projectId`), not just a bare UUID.
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

1. **Read-only history, magic-link.** `investor_access` table (keyed on
   `email`, per the corrected data model above) + `/portal` email flow +
   `/portal/reports` list reusing existing render, already showing every
   project the email is on. No engagement changes.
2. **Engagement tie-in.** Log portal views; surface in the founder's
   engagement panel.
3. **Polish.** Per-project *filtering* within the portal UI (an investor
   on 5 projects may want to focus on one), link-expiry/resend UX,
   optional branding per project when viewing that project's reports.

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
- **Case normalization for `investors.email` (new, from TODO-028):**
  normalize on write (lowercase in the `investors.add` mutation, plus a
  one-time backfill for existing rows) vs. always compare with
  `LOWER(...)` at read time and leave existing data as-is? Normalizing on
  write is cleaner long-term but touches existing rows/behavior outside
  the portal itself — decide at TODO-014 implementation time, not now.

## Out of scope

- Any billing/paywall (VaultBrief is free — public goods).
- Investor accounts with passwords or profile management.
- Investor-side commenting / Q&A (that's TODO-017, depends on this).
