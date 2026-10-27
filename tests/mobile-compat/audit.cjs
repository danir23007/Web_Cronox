const { chromium, webkit, firefox } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { installDiagnostics } = require('./diagnostics.cjs');
const out = path.resolve('output/playwright/mobile-compat');
fs.mkdirSync(out, { recursive: true });
(async () => {
 const summary = [];
 const stage = process.argv[2] || 'current';
 for (const [engine, type] of Object.entries({ chromium, webkit, firefox })) {
  const browser = await type.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: engine !== 'firefox', hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(installDiagnostics);
  const page = await context.newPage();
  for (const url of ['/tienda?utm_source=qr', '/producto/compat-shirt', '/cesta', '/checkout', '/cuenta', '/compat-accreditation']) {
   if (url === '/cuenta') await context.addCookies([{ name: 'compat-auth', value: '1', url: 'http://127.0.0.1:4185' }]);
   await page.goto('http://127.0.0.1:4185' + url);
   const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
   if (await reject.isVisible()) await reject.click();
   await page.waitForTimeout(url.startsWith('/tienda') ? 7000 : 1000);
   if (url === '/cuenta') { await page.locator('[data-profile-tab="accreditation"]').click(); await page.waitForTimeout(1000); }
   if (url === '/compat-accreditation') await page.evaluate(() => renderer.ready);
   const stats = await page.evaluate(() => ({ current: compatMeasure('settled'), samples: compatSamples, inputs: [...document.querySelectorAll('input,select,textarea')].filter(e => e.getBoundingClientRect().width).map(e => ({ id: e.id, type: e.type, font: getComputedStyle(e).fontSize })) }));
   const label = url.replace(/[^a-z]+/gi, '-');
   fs.writeFileSync(path.join(out, `${stage}-${engine}${label}.json`), JSON.stringify(stats, null, 2));
   await page.screenshot({ path: path.join(out, `${stage}-${engine}${label}.png`), fullPage: true });
   summary.push({ engine, url, scale: stats.current.visual?.scale, width: stats.current.innerWidth, scroll: stats.current.scrollWidth, focus: stats.current.active, inputs: stats.inputs });
  }
  if (engine === 'chromium') {
   const cdp = await context.newCDPSession(page);
   for (const forced of [false, true]) {
    await cdp.send('Emulation.setAutoDarkModeOverride', { enabled: forced });
    for (let circleLevel = 1; circleLevel <= 5; circleLevel++) {
     await page.evaluate(async circleLevel => { await renderer.update({ ...fixtureData, circleLevel }); }, circleLevel);
     await page.locator('.crx-metacrilatos').screenshot({ path: path.join(out, `${stage}-chromium-circle-${circleLevel}-auto-${forced}.png`) });
    }
   }
  }
  await browser.close();
 }
 fs.writeFileSync(path.join(out, `${stage}-summary.json`), JSON.stringify(summary, null, 2));
 console.log(JSON.stringify(summary));
})().catch(e => { console.error(e); process.exit(1); });
