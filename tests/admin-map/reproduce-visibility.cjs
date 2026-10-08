// Record visibility on a failed sales GET. --before names the original evidence.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { start } = require('./review-server.cjs');

(async () => {
  const server = start(43129);
  const browser = await chromium.launch({ headless: true });
  const out = path.resolve('output/playwright/admin-map');
  await fs.mkdir(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const resources = [];
  const stage = process.argv.includes('--before') ? 'before' : 'after';
  page.on('response', response => {
    if (response.url().includes('/assets/maps/')) resources.push({ url: response.url(), status: response.status() });
  });
  try {
    await page.route('**/api/admin/map?**', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"simulated sales failure"}' }));
    await page.goto('http://127.0.0.1:43129/admin.html#section-map');
    await expect(page.locator('[data-retry]')).toBeVisible();
    const evidence = await page.evaluate(() => {
      const svg = document.querySelector('.map-graphic svg');
      const results = document.querySelector('.map-results');
      return { svgPresent: !!svg, regionCount: svg?.querySelectorAll('[data-region]').length, visible: !!svg?.getBoundingClientRect().height, resultsHidden: results.hidden,
        navigationParent: document.querySelector('[data-nav-target="section-map"]').parentElement.id };
    });
    await page.screenshot({ path: path.join(out, `reproduction-${stage}-error.png`), fullPage: true });
    await fs.writeFile(path.join(out, `reproduction-${stage}.json`), JSON.stringify({ ...evidence, resources }, null, 2));
    console.log(JSON.stringify({ ...evidence, resources }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
