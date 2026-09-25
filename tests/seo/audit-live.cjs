// Read-only production inspection: public GET endpoints only. No customer session.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') return route.abort();
    if (url.pathname.startsWith('/api/') && !/^\/api\/(products|categories|gallery|footer|key-screen|media-framing)(\/|$)/.test(url.pathname)) {
      return route.fulfill({ status: 401, json: {} });
    }
    return route.continue();
  });
  const findings = [];
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const pathname of ['/', '/producto/scarred-tee-red', '/producto/no-existe-seo-audit']) {
      const response = await page.goto(`https://cronox.es${pathname}`);
      await page.waitForTimeout(3500);
      findings.push({ width, pathname, status: response.status(), ...await page.evaluate(() => ({
        title: document.title,
        canonical: document.querySelector('link[rel=canonical]')?.href,
        description: document.querySelector('meta[name=description]')?.content,
        robots: document.querySelector('meta[name=robots]')?.content,
        cards: document.querySelectorAll('.product-card').length,
        name: document.querySelector('#pName')?.textContent,
        preloader: document.querySelector('#preloader') ? getComputedStyle(document.querySelector('#preloader')).opacity : null,
        structuredData: [...document.scripts].filter(s => s.type === 'application/ld+json').map(s => s.textContent),
        overflow: document.documentElement.scrollWidth > innerWidth,
      })) });
    }
  }
  const directory = path.resolve('test-results/seo-live');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'audit.json'), JSON.stringify({ at: new Date().toISOString(), findings }, null, 2));
  console.log(JSON.stringify(findings, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
