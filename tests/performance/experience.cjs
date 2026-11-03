const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const label = process.argv[2] || 'before';
const out = path.resolve(__dirname, '../../output/performance-20261103', label);
async function main() {
  const browser = await chromium.launch();
  try {
    for (const mobile of [true, false]) {
      const device = mobile ? 'mobile' : 'desktop';
      const context = await browser.newContext({ viewport: { width: mobile ? 412 : 1366, height: mobile ? 823 : 768 }, deviceScaleFactor: mobile ? 1.75 : 1, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      // Runtime fallback URLs embedded in JS are outside the HTML/JSON mirror.
      // Mirror them for visual QA too (Lighthouse uses its own fixed protocol).
      await page.route('https://*.supabase.co/storage/v1/object/public/**', async route => {
        const response = await page.request.get('http://127.0.0.1:4186/__media/' + Buffer.from(route.request().url()).toString('base64url'));
        await route.fulfill({ response });
      });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        window.__CRONOX_API_BASE__ = location.origin;
        window.__ux = { images: [], lcp: [] };
        const original = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, ...rest) {
          if (this.id === 'btnMenu' && type === 'click') window.__ux.menuBound = performance.now();
          return original.call(this, type, ...rest);
        };
        window.addEventListener('cronox:storefront-ready', () => { window.__ux.reveal = performance.now(); });
        document.addEventListener('load', event => {
          if (event.target instanceof HTMLImageElement) window.__ux.images.push({ at: performance.now(), url: event.target.currentSrc, class: event.target.className });
        }, true);
        new PerformanceObserver(list => list.getEntries().forEach(e => window.__ux.lcp.push({ at: e.startTime, url: e.url, element: e.element?.outerHTML.slice(0, 300) }))).observe({ type: 'largest-contentful-paint', buffered: true });
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: mobile ? 150 : 40, downloadThroughput: (mobile ? 1600 : 10240) * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: mobile ? 4 : 1 });
      await page.goto('http://127.0.0.1:4186/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.querySelector('#preloader'));
      const result = await page.evaluate(() => ({ ...window.__ux, visibleAt: performance.now(), galleryRequested: performance.getEntriesByType('resource').some(e => /\/api\/gallery/.test(e.name)), consentVisible: Boolean(document.querySelector('.cronox-consent')?.getBoundingClientRect().height) }));
      await page.screenshot({ path: path.join(out, `experience-${device}-entry.png`) });
      await page.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
      await page.locator('#btnMenu').click();
      result.menuOpened = await page.locator('#btnMenu').getAttribute('aria-expanded');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(out, `experience-${device}-home.png`) });
      await page.locator('#store').scrollIntoViewIfNeeded();
      await page.waitForTimeout(mobile ? 7000 : 2000);
      result.cards = await page.locator('.product-media img.active').evaluateAll(images => images.map(e => ({ currentSrc: e.currentSrc, sizes: e.sizes, renderedWidth: e.getBoundingClientRect().width, complete: e.complete })));
      await page.screenshot({ path: path.join(out, `experience-${device}-catalog.png`) });
      // Separate loading progress from quality comparison; do not compare a
      // partly decoded photograph with a completely downloaded one.
      await page.waitForFunction(() => [...document.querySelectorAll('.product-media img.active')].every(e => e.complete && e.naturalWidth), null, { timeout: 45000 });
      await page.waitForTimeout(200);
      const newsletterClose = page.locator('.newsletter-modal-overlay[aria-hidden="false"] .newsletter-modal-close');
      if (await newsletterClose.isVisible()) { await newsletterClose.click(); await page.waitForTimeout(400); }
      await page.screenshot({ path: path.join(out, `experience-${device}-catalog-settled.png`) });
      await page.locator('[data-gallery-homepage-section]').scrollIntoViewIfNeeded();
      await page.locator('.gallery-carousel__slide img').first().waitFor();
      await page.waitForTimeout(mobile ? 8000 : 2000);
      if (await newsletterClose.isVisible()) { await newsletterClose.click(); await page.waitForTimeout(400); }
      result.gallery = await page.locator('.gallery-carousel__slide img').evaluateAll(images => images.filter(e => e.currentSrc).map(e => ({ currentSrc: e.currentSrc, sizes: e.sizes, renderedWidth: e.getBoundingClientRect().width, complete: e.complete })));
      await page.screenshot({ path: path.join(out, `experience-${device}-gallery.png`) });
      result.errors = errors;
      fs.writeFileSync(path.join(out, `experience-${device}.json`), JSON.stringify(result, null, 2));
      console.log(device, JSON.stringify({ reveal: result.reveal, menuBound: result.menuBound, visible: result.visibleAt, menuOpened: result.menuOpened, galleryRequested: result.galleryRequested, errors }));
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
