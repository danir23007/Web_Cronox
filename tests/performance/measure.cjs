// Reproducible lab comparison: same browser, public snapshots, real
// DevTools network/CPU throttling. Warm navigation retains HTTP cache/storage.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');
const out = path.resolve(__dirname, '../../output/performance-20261103');
const tooling = path.join(out, 'tooling/node_modules');
const puppeteer = require(path.join(tooling, 'puppeteer-core'));
const label = process.argv[2] || 'before';
const only = process.argv[3];
const url = process.env.PERF_URL || 'http://127.0.0.1:4186/';
if (!['http://127.0.0.1:4186/', 'https://cronox.es/'].includes(url)) throw Error('UNAPPROVED_PERFORMANCE_ORIGIN');
async function main() {
  const { default: lighthouse } = await import(pathToFileURL(path.join(tooling, 'lighthouse/core/index.js')));
  fs.mkdirSync(path.join(out, label), { recursive: true });
  for (const device of ['mobile', 'desktop'].filter(d => !only || only === d)) {
    for (let run = 1; run <= Number(process.env.PERF_RUNS || 3); run++) {
      console.log(`Starting ${label} ${device} ${run}`);
      const browser = await puppeteer.launch({ executablePath: chromium.executablePath(), headless: true, pipe: true, args: ['--no-sandbox'] });
      try {
        const page = await browser.newPage();
        if (url === 'https://cronox.es/') {
          // Public measurements never submit forms or create orders, payments,
          // subscriptions, favorites or carts. The anonymous refresh is local.
          await page.setRequestInterception(true);
          page.on('request', request => {
            if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
              return request.respond({ status: 401, contentType: 'application/json', body: '{}' });
            }
            return request.continue();
          });
        }
        await page.evaluateOnNewDocument(() => {
          window.__CRONOX_API_BASE__ = location.origin;
          window.__perf = { lcp: [] };
          new PerformanceObserver(list => list.getEntries().forEach(e => window.__perf.lcp.push({ at: e.startTime, load: e.loadTime, render: e.renderTime, url: e.url, element: e.element?.outerHTML?.slice(0, 600) }))).observe({ type: 'largest-contentful-paint', buffered: true });
          window.addEventListener('cronox:storefront-ready', () => { window.__perf.reveal = performance.now(); });
          document.addEventListener('DOMContentLoaded', () => { window.__perf.domReady = performance.now(); });
          const observe = () => {
            if (document.body?.classList.contains('is-loaded') && !document.querySelector('.preloader')) window.__perf.visible = performance.now();
            else requestAnimationFrame(observe);
          };
          requestAnimationFrame(observe);
        });
        for (const cache of ['cold', 'warm']) {
          const mobile = device === 'mobile';
          const result = await lighthouse(url, {
            logLevel: process.env.PERF_LOG || 'error', output: 'json', onlyCategories: ['performance'],
            formFactor: device, throttlingMethod: 'devtools', disableStorageReset: cache === 'warm',
            screenEmulation: { mobile, width: mobile ? 412 : 1366, height: mobile ? 823 : 768, deviceScaleFactor: mobile ? 1.75 : 1, disabled: false },
            throttling: { requestLatencyMs: mobile ? 150 : 40, downloadThroughputKbps: mobile ? 1600 : 10240, uploadThroughputKbps: mobile ? 750 : 10240, cpuSlowdownMultiplier: mobile ? 4 : 1 },
            maxWaitForLoad: 45000,
          }, undefined, page);
          const key = `${device}-${run}-${cache}`;
          fs.writeFileSync(path.join(out, label, key + '.lhr.json'), JSON.stringify(result.lhr));
          fs.writeFileSync(path.join(out, label, key + '.trace.json'), JSON.stringify(result.artifacts.Trace || result.artifacts.traces?.defaultPass || {}));
          fs.writeFileSync(path.join(out, label, key + '.network.json'), JSON.stringify(result.artifacts.DevtoolsLog || result.artifacts.devtoolsLogs?.defaultPass || []));
          const evidence = await page.evaluate(() => ({
            ...window.__perf, resources: performance.getEntriesByType('resource').map(e => ({ url: e.name, start: e.startTime, end: e.responseEnd, bytes: e.transferSize })),
            images: [...document.images].filter(e => e.currentSrc).map(e => ({ alt: e.alt, src: e.currentSrc, width: e.getBoundingClientRect().width, natural: e.naturalWidth, loading: e.loading })),
            cookiesVisible: [...document.querySelectorAll('[role="dialog"]')].filter(e => e.getBoundingClientRect().height).map(e => e.getAttribute('aria-label')),
          }));
          await page.screenshot({ path: path.join(out, label, key + '.png') });
          // Interaction is deliberately AFTER LCP collection (input ends LCP).
          evidence.menu = await page.evaluate(() => {
            const button = document.querySelector('#btnMenu');
            button?.click();
            return { at: performance.now(), expanded: button?.getAttribute('aria-expanded'), panel: document.querySelector('#filtersPanel')?.outerHTML.slice(0, 250) };
          });
          fs.writeFileSync(path.join(out, label, key + '.evidence.json'), JSON.stringify(evidence, null, 2));
          const audits = result.lhr.audits;
          console.log(JSON.stringify({ label, device, run, cache, score: result.lhr.categories.performance.score * 100, fcp: audits['first-contentful-paint'].numericValue, lcp: audits['largest-contentful-paint'].numericValue, si: audits['speed-index'].numericValue, tbt: audits['total-blocking-time'].numericValue, cls: audits['cumulative-layout-shift'].numericValue, bytes: audits['total-byte-weight'].numericValue, reveal: evidence.reveal, visible: evidence.visible, errors: result.lhr.runtimeError }));
        }
      } finally { await browser.close(); }
    }
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
