// Verifies Google Analytics is actually sending hits from the live dashboard.
// Loads the production site in a fresh headless browser and waits for a GA4
// page_view request to google-analytics.com/g/collect. Checking that gtag.js
// loads isn't enough: from 2026-09-05 to 2026-10-07 it loaded fine while every
// hit was silently dropped (see the gtag stub comment in src/utils/analytics.ts).
//
// Usage: npm run verify:ga   (needs Playwright: npm i --no-save playwright && npx playwright install chromium)

import { readFileSync } from 'node:fs';

const SITE_URL = process.env.SITE_URL ?? 'https://cloudstatus.synepho.com/';
const WAIT_MS = 20_000;
const ATTEMPTS = 2;

// Read the measurement ID from the app itself so this check can't drift from it.
const analyticsSrc = readFileSync(new URL('../src/utils/analytics.ts', import.meta.url), 'utf8');
const MEASUREMENT_ID = analyticsSrc.match(/GA_MEASUREMENT_ID = '(G-[A-Z0-9]+)'/)?.[1];
if (!MEASUREMENT_ID) {
  console.error('Could not find GA_MEASUREMENT_ID in src/utils/analytics.ts');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright not installed. Run: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

/** Event names in a GA4 /g/collect request (query string for single hits, body lines for batches). */
function eventNames(request) {
  const text = `${request.url()}\n${request.postData() ?? ''}`;
  return [...text.matchAll(/(?:^|[?&\n])en=([^&\s]+)/g)].map((m) => decodeURIComponent(m[1]));
}

async function attempt(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen = { gtagJs: null, hits: [] };

  page.on('response', (res) => {
    if (res.url().includes('googletagmanager.com/gtag/js')) seen.gtagJs = res.status();
  });
  const pageView = page
    .waitForRequest(
      (req) => {
        if (!req.url().includes('/g/collect') || !req.url().includes(`tid=${MEASUREMENT_ID}`)) return false;
        const names = eventNames(req);
        seen.hits.push(...names);
        return names.includes('page_view');
      },
      { timeout: WAIT_MS },
    )
    .then(() => true)
    .catch(() => false);

  try {
    await page.goto(SITE_URL, { waitUntil: 'load' });
  } catch (err) {
    await context.close();
    return { ok: false, loadError: err.message.split('\n')[0], ...seen, gtag: 'n/a', dataLayer: [] };
  }
  const ok = await pageView;

  // Diagnostics for the failure message: what the page actually set up.
  const state = await page.evaluate(() => ({
    gtag: typeof window.gtag === 'function' ? String(window.gtag).slice(0, 120) : typeof window.gtag,
    dataLayer: (window.dataLayer ?? []).slice(0, 3).map((e) =>
      Array.isArray(e) ? 'Array (ignored by gtag.js!)' : Object.prototype.toString.call(e),
    ),
  }));
  await context.close();
  return { ok, ...seen, ...state };
}

const browser = await chromium.launch();
let result;
for (let i = 1; i <= ATTEMPTS; i++) {
  result = await attempt(browser);
  if (result.ok) break;
  console.warn(`Attempt ${i}/${ATTEMPTS}: no page_view hit within ${WAIT_MS / 1000}s`);
}
await browser.close();

if (result.ok) {
  console.log(`✓ GA4 ${MEASUREMENT_ID} is sending hits from ${SITE_URL} (events: ${result.hits.join(', ')})`);
  process.exit(0);
}

console.error(`✗ No GA4 page_view hit for ${MEASUREMENT_ID} from ${SITE_URL}`);
if (result.loadError) console.error(`  page load failed:  ${result.loadError}`);
console.error(`  gtag.js response:  ${result.gtagJs ?? 'never requested'}`);
console.error(`  collect events:    ${result.hits.join(', ') || 'none'}`);
console.error(`  window.gtag:       ${result.gtag}`);
console.error(`  dataLayer[0..2]:   ${result.dataLayer.join(' | ') || 'empty'}`);
process.exit(1);
