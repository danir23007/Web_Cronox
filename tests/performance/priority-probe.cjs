const { chromium } = require('@playwright/test');
const fs = require('node:fs');
async function main() {
  const results = [];
  const browser = await chromium.launch();
  try {
    for (let run = 1; run <= 3; run++) for (const priority of ['auto', 'high']) {
      const context = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true });
      const page = await context.newPage();
      let preloaderRequests = 0;
      page.on('request', request => { if (/preloader-v2/.test(request.url())) preloaderRequests++; });
      await page.addInitScript(() => {
        window.__CRONOX_API_BASE__ = location.origin;
        window.__priorityProbe = {};
        window.addEventListener('cronox:storefront-ready', () => { window.__priorityProbe.reveal = performance.now(); });
        document.addEventListener('load', e => { if (e.target.matches?.('#hero img')) window.__priorityProbe.hero = performance.now(); }, true);
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1600 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto(`http://127.0.0.1:4186/?perf-priority=${priority}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.querySelector('#preloader') && document.querySelector('#hero img')?.complete);
      const result = { run, priority, ...await page.evaluate(() => window.__priorityProbe), preloaderRequests };
      results.push(result);
      console.log(result);
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync('output/performance-20261103/priority-probe.json', JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
