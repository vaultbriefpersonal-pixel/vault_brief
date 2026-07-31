// Manual bridge for onboarding a paying client before self-serve Stripe
// checkout exists. Stripe checkout is currently disabled behind placeholder
// price IDs, so paid plans are turned on by the founder flipping the
// `user.plan` column directly, by hand, after a client pays via
// invoice/wire outside Stripe.
//
// `plan_expires_at` (the optional third argument) is purely informational
// for the founder's own follow-up — nothing in the app currently reads it
// to auto-downgrade a client back to `free`. Renewing or downgrading a
// client is still a manual re-run of this script each billing cycle.
//
// Usage:
//   node --env-file=.env.local scripts/set-user-plan.mjs <email> <plan> [expiresYYYY-MM-DD]
//
// Examples:
//   node --env-file=.env.local scripts/set-user-plan.mjs founder@example.com starter 2026-08-31
//   node --env-file=.env.local scripts/set-user-plan.mjs founder@example.com free

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Export it or load .env.local before running this script."
  );
  process.exit(1);
}

const VALID_PLANS = ["free", "starter", "growth", "vc_suite"];

const [email, plan, expiresArg] = process.argv.slice(2);

if (!email || !plan) {
  console.error(
    "Usage: node --env-file=.env.local scripts/set-user-plan.mjs <email> <plan> [expiresYYYY-MM-DD]"
  );
  console.error(`<plan> must be one of: ${VALID_PLANS.join(", ")}`);
  process.exit(1);
}

if (!VALID_PLANS.includes(plan)) {
  console.error(
    `Invalid plan "${plan}". Must be one of: ${VALID_PLANS.join(", ")}`
  );
  process.exit(1);
}

let expiresAt = undefined;
if (expiresArg !== undefined) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresArg)) {
    console.error(
      `Invalid expiry date "${expiresArg}". Expected format: YYYY-MM-DD`
    );
    process.exit(1);
  }
  expiresAt = expiresArg;
}

const sql = neon(DATABASE_URL);

async function run() {
  const [before] = await sql`
    select id, email, plan, plan_expires_at
    from "user"
    where email = ${email}
  `;

  if (!before) {
    console.error(`No user found with email "${email}".`);
    process.exit(1);
  }

  console.log("Before:", before);

  let after;
  if (expiresAt !== undefined) {
    [after] = await sql`
      update "user"
      set plan = ${plan}, plan_expires_at = ${expiresAt}
      where email = ${email}
      returning id, email, plan, plan_expires_at
    `;
  } else {
    // Plan-only update — leave plan_expires_at exactly as it was, don't
    // null it out just because this invocation didn't pass a date.
    [after] = await sql`
      update "user"
      set plan = ${plan}
      where email = ${email}
      returning id, email, plan, plan_expires_at
    `;
  }

  console.log("After:", after);
}

run().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
