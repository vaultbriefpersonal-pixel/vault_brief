import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const MAGIC = 'https://www.vaultbrief.io/api/auth/callback/resend?callbackUrl=https%3A%2F%2Fwww.vaultbrief.io%2Fprojects&token=2350c1ceeb7cfca32036548f9ef2259a272e0908123f468933077e423f95276d&email=conctract.sol%40gmail.com';
const BASE = 'https://www.vaultbrief.io';

mkdirSync('tmp-screenshots/e2e', { recursive: true });

const log = (...a) => { console.log(new Date().toISOString().slice(11,19), ...a); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
});

const page = await ctx.newPage();
const redirects = [];
const consoleErrors = [];
const netFailures = [];

page.on('response', (r) => {
  if ([301,302,303,307,308].includes(r.status())) {
    redirects.push({ status: r.status(), from: r.request().url(), to: r.headers()['location'] || '?' });
  }
});
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0,200)); });
page.on('requestfailed', (r) => netFailures.push(`${r.url()} ${r.failure()?.errorText ?? '?'}`));

log('STEP 1 — click magic link');
const r = await page.goto(MAGIC, { waitUntil: 'domcontentloaded', timeout: 30000 });
log('arrived at', page.url(), 'status:', r ? r.status() : '?');
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.screenshot({ path: 'tmp-screenshots/e2e/01-after-auth.png', fullPage: true });

// Show what cookies we have (without leaking values)
const cookies = await ctx.cookies();
const sessionCookieNames = cookies.map(c => c.name);
log('cookies after auth:', sessionCookieNames);

// Detect Safe Browsing warning
const bodyText = await page.locator('body').innerText().catch(() => '');
const isDangerousWarning = /dangerous site|attackers on the site/i.test(bodyText);
log('safe browsing warning present?', isDangerousWarning);

writeFileSync('tmp-screenshots/e2e/state.json', JSON.stringify({
  finalUrl: page.url(),
  redirects,
  consoleErrors,
  netFailures,
  cookiesPresent: sessionCookieNames,
  isDangerousWarning,
  bodyPreview: bodyText.slice(0, 400),
}, null, 2));

// If we landed on /projects (or any auth-gated page), we are authed.
log('STEP 2 — navigate to /projects/new');
await page.goto(BASE + '/projects/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.screenshot({ path: 'tmp-screenshots/e2e/02-new-project-wizard.png', fullPage: true });
const wizardUrl = page.url();
log('wizard url:', wizardUrl);

// Don't auto-submit anything. Save cookies so we can resume.
const storageState = await ctx.storageState();
writeFileSync('tmp-screenshots/e2e/storage.json', JSON.stringify(storageState));
log('saved session state');

await browser.close();
log('DONE');
