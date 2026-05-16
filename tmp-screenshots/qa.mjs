import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://vault-brief-git-feat-p-612fa1-vaultbriefpersonal-7238s-projects.vercel.app';

const ROUTES = [
  '/',
  '/login',
  '/demo',
  '/pricing',
  '/docs',
  '/blog',
  '/about',
  '/changelog',
  '/security',
  '/privacy',
  '/terms',
  '/cookies',
  '/status',
  // auth-gated — should redirect to /login
  '/projects',
  '/projects/new',
  '/billing',
  // API
  '/api/health',
];

mkdirSync('tmp-screenshots/qa', { recursive: true });

const report = {
  base: BASE,
  routes: [],
  clickthrough: [],
  faq: null,
  mobileDrawer: null,
  chat: null,
  externalLinks: [],
  notes: [],
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
});

async function inspect(route) {
  const consoleErrors = [];
  const consoleWarns = [];
  const failedNet = [];
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 240));
    if (msg.type() === 'warning') consoleWarns.push(msg.text().slice(0, 240));
  });
  page.on('requestfailed', (r) => {
    failedNet.push(`${r.method()} ${r.url()} -- ${r.failure()?.errorText ?? '?'}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.status() !== 404 /* let 404s through if intentional */) {
      // ignore
    }
  });

  let status = null, finalUrl = null, title = null, h1 = null, err = null;
  try {
    const resp = await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 30000 });
    status = resp ? resp.status() : null;
    finalUrl = page.url();
    title = await page.title();
    try {
      h1 = await page.locator('h1').first().innerText({ timeout: 1500 });
    } catch {
      h1 = '(no h1)';
    }
    // collect all links visible on the page for click-through
    const links = await page.$$eval('a[href]', (els) => els.map((a) => ({
      href: a.getAttribute('href'),
      text: (a.textContent || '').trim().slice(0, 60),
    })));

    // screenshots
    const safe = route.replace(/[/?=]/g, '_') || '_root';
    const fname = `tmp-screenshots/qa/${safe}.png`;
    await page.screenshot({ path: fname, fullPage: true });
    report.routes.push({
      route,
      status,
      finalUrl,
      title,
      h1: h1.slice(0, 120),
      consoleErrors,
      consoleWarns: consoleWarns.slice(0, 5),
      failedNet,
      screenshot: fname,
      linkCount: links.length,
    });

    // Save links for click-through phase (only for landing)
    if (route === '/') report._landingLinks = links;
  } catch (e) {
    err = e.message;
    report.routes.push({ route, error: err });
  }
  await page.close();
}

for (const r of ROUTES) {
  console.log('inspecting', r);
  await inspect(r);
}

// FAQ accordion test on /
{
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  // FAQ section button — first question
  try {
    const btn = page.locator('button[aria-controls^="faq-answer"]').first();
    const beforeExpanded = await btn.getAttribute('aria-expanded');
    await btn.click();
    await page.waitForTimeout(400);
    const afterExpanded = await btn.getAttribute('aria-expanded');
    const answerVisible = await page.locator('#faq-answer-0').isVisible();
    report.faq = { beforeExpanded, afterExpanded, answerVisible };
  } catch (e) {
    report.faq = { error: e.message };
  }
  await page.close();
}

// Mobile drawer on /
{
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  try {
    const burger = page.getByRole('button', { name: /Open menu/i }).first();
    const visible = await burger.isVisible();
    await burger.click();
    await page.waitForTimeout(300);
    const drawerLinks = await page.$$eval('a[href]', (a) => a.length);
    await page.screenshot({ path: 'tmp-screenshots/qa/_mobile_drawer.png', fullPage: false });
    report.mobileDrawer = { burgerVisible: visible, drawerLinks };
  } catch (e) {
    report.mobileDrawer = { error: e.message };
  }
  await page.close();
}

// Chat widget detection on /
{
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  try {
    // ChatWidget is mounted bottom-right via marketing layout
    const candidates = await page.$$eval('button, div[role="button"]', (els) =>
      els
        .map((el) => ({
          text: (el.textContent || '').trim().slice(0, 30),
          aria: el.getAttribute('aria-label') ?? '',
          posClass: (el.className || '').toString().slice(0, 60),
        }))
        .filter((x) => /chat|ask|help/i.test(x.aria) || /chat/i.test(x.text))
    );
    report.chat = { candidates };
  } catch (e) {
    report.chat = { error: e.message };
  }
  await page.close();
}

// Click-through every internal link from the landing page
{
  const page = await ctx.newPage();
  const links = (report._landingLinks ?? []).filter((l) => l.href && !l.href.startsWith('mailto:'));
  delete report._landingLinks;
  for (const l of links) {
    const target = l.href.startsWith('http')
      ? l.href
      : l.href.startsWith('#')
        ? null // ignore in-page anchors here
        : BASE + l.href;
    if (!target) continue;
    if (!target.startsWith(BASE) && !target.startsWith('http')) continue;
    try {
      const resp = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
      report.clickthrough.push({
        text: l.text,
        href: l.href,
        status: resp ? resp.status() : null,
        finalUrl: page.url(),
      });
    } catch (e) {
      report.clickthrough.push({ text: l.text, href: l.href, error: e.message });
    }
  }
  await page.close();
}

await browser.close();
writeFileSync('tmp-screenshots/qa/report.json', JSON.stringify(report, null, 2));
console.log('DONE — wrote tmp-screenshots/qa/report.json');
