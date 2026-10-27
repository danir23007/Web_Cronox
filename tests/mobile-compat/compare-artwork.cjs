// Review artifact: compares the current renderer with an explicit Git revision.
// Usage: node tests/mobile-compat/compare-artwork.cjs [revision]
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const sharp = require('../../cronox-backend/node_modules/sharp');
const revision = process.argv[2] || 'HEAD';
const out = 'output/playwright/mobile-compat';
(async () => {
 const browser = await chromium.launch();
 const comparisons = [];
 try {
  for (const stage of ['before', 'after']) {
   const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, reducedMotion: 'reduce' });
   const page = await context.newPage();
   if (stage === 'before') for (const file of ['metacrilatos.js', 'metacrilatos.css']) {
    const body = execFileSync('git', ['show', `${revision}:cronox-front/assets/${file}`]);
    await page.route(`**/assets/${file}*`, route => route.fulfill({ body, contentType: file.endsWith('.js') ? 'text/javascript' : 'text/css' }));
   }
   const cdp = await context.newCDPSession(page);
   await page.goto('http://127.0.0.1:4185/compat-accreditation');
   await page.evaluate(() => renderer.ready);
   for (let circleLevel = 1; circleLevel <= 5; circleLevel++) {
    await page.evaluate(async circleLevel => { await renderer.update({ ...fixtureData, circleLevel }); }, circleLevel);
    for (const face of ['front', 'back']) {
     if (face === 'back') await page.locator('[data-crx-flip]').click();
     for (const auto of [false, true]) {
      await page.emulateMedia({ colorScheme: auto ? 'dark' : 'light' });
      await cdp.send('Emulation.setAutoDarkModeOverride', { enabled: auto });
      await page.locator('.crx-stage').screenshot({ path: `${out}/compare-${stage}-${circleLevel}-${face}-auto-${auto}.png` });
     }
    }
   }
   await context.close();
  }
  for (let circle = 1; circle <= 5; circle++) for (const face of ['front', 'back']) {
   const a = await sharp(`${out}/compare-before-${circle}-${face}-auto-false.png`).raw().toBuffer();
   const b = await sharp(`${out}/compare-after-${circle}-${face}-auto-false.png`).raw().toBuffer();
   if (a.length !== b.length) throw Error('Artwork geometry changed');
   let total = 0, changed = 0;
   for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); total += delta; if (delta > 12) changed++; }
   comparisons.push({ circle, face, meanChannelDifference: total / a.length, changedChannelFraction: changed / a.length });
  }
  fs.writeFileSync(`${out}/artwork-comparison.json`, JSON.stringify({ revision, comparisons }, null, 2));
  console.log(JSON.stringify(comparisons));
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
