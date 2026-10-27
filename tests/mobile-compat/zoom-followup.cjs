// Targeted follow-up only. Start server.cjs separately. All data/API are local fixtures.
// Usage: node tests/mobile-compat/zoom-followup.cjs
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const script = fs.readFileSync(`${__dirname}/voluntary-zoom-diagnostics.js`, 'utf8');
const out = 'output/playwright/mobile-followup';
fs.mkdirSync(out, { recursive: true });
const onlyEngine = process.argv[2];
const result = onlyEngine && fs.existsSync(`${out}/zoom-results.json`)
  ? JSON.parse(fs.readFileSync(`${out}/zoom-results.json`, 'utf8'))
  : { timelines: [], comparison: [], calibration: {}, privacy: {} };
if (onlyEngine) {
  assert.ok(['chromium', 'webkit'].includes(onlyEngine));
  result.timelines = result.timelines.filter(r => r.engine !== onlyEngine);
  result.comparison = result.comparison.filter(r => r.engine !== onlyEngine);
}
const save = () => fs.writeFileSync(`${out}/zoom-results.json`, JSON.stringify(result, null, 2));
const read = page => page.evaluate(() => JSON.parse(CRONOXZoomDiagnostic.exportJSON()));
async function install(context) {
  // Explicitly pre-consented automated fixture. Never use this bypass on a person's phone.
  await context.addInitScript({ content: 'window.__CRONOX_API_BASE__ = location.origin;\n' + script + '\nconst originalConfirm = window.confirm; window.confirm = () => true; CRONOXZoomDiagnostic.start(); window.confirm = originalConfirm;' });
}
async function mark(page) { return page.evaluate(() => CRONOXZoomDiagnostic.mark()); }
async function reject(page) { await page.getByRole('button', { name: 'RECHAZAR', exact: true }).click(); }
function stable(sample) {
  if (!sample.viewportMeta.length) return; // Pre-parser sample, not yet a rendered document.
  assert.equal(sample.viewportMeta.length, 1);
  assert.equal(sample.viewportMeta[0].width, 'device-width');
  assert.equal(sample.viewportMeta[0]['initial-scale'], '1');
  assert.equal(sample.visual.scale, 1, JSON.stringify(sample));
  assert.ok(sample.scrollWidth <= sample.clientWidth + 1, JSON.stringify(sample));
}
(async () => {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    if (onlyEngine && name !== onlyEngine) continue;
    const browser = await engine.launch();
    try {
      for (const delayedConsent of [false, true]) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await install(context);
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:4185/${delayedConsent ? '' : '?utm_source=qr'}`, { waitUntil: 'domcontentloaded' });
        if (delayedConsent) {
          await page.waitForTimeout(7000);
          assert.equal(await page.locator('.newsletter-modal-overlay').getAttribute('aria-hidden'), 'true');
        }
        await reject(page);
        await page.locator('.newsletter-modal-overlay--visible').waitFor({ timeout: 12000 });
        await page.waitForFunction(() => document.activeElement?.classList.contains('newsletter-modal-close'));
        const opened = await mark(page);
        await page.waitForTimeout(Math.max(0, 12000 - opened.elapsedMs));
        await page.locator('#newsletterEmail').focus();
        const email = await mark(page);
        assert.ok(email.active.style.fontSize >= 16);
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(300);
        const landscape = await mark(page);
        assert.ok(landscape.active.style.fontSize >= 16);
        await page.keyboard.press('Escape');
        await page.locator('#profileBtn').click();
        await page.waitForFunction(() => document.activeElement?.matches('#authOverlay input'));
        await page.locator('[data-auth-switch="register"]').first().focus();
        await page.keyboard.press('Enter');
        const switched = await mark(page);
        assert.equal(await page.locator('#authCloseBtn').evaluate(e => e === document.activeElement), true);
        assert.equal(switched.active.style.visible, true);
        await page.keyboard.press('Escape');
        await page.evaluate(() => CRONOXZoomDiagnostic.stop());
        const data = await read(page);
        // Initial addInitScript sample precedes parsing. Evaluate stability from DOMContentLoaded.
        const loaded = data.samples.findIndex(s => s.reason === 'DOMContentLoaded');
        assert.ok(loaded >= 0);
        data.samples.slice(loaded).forEach(stable);
        assert.ok(data.samples.some(s => s.reason === 'focusin'));
        fs.writeFileSync(`${out}/timeline-${name}-${delayedConsent ? 'consent-held' : 'qr'}.json`, JSON.stringify(data, null, 2));
        result.timelines.push({ engine: name, delayedConsent, samples: data.samples.length, newsletterCloseFocusedMs: opened.elapsedMs, emailFontSize: email.active.style.fontSize, landscapeFontSize: landscape.active.style.fontSize, minScale: Math.min(...data.samples.slice(loaded).map(s => s.visual.scale)), maxScale: Math.max(...data.samples.slice(loaded).map(s => s.visual.scale)), maxHorizontalOverflow: Math.max(...data.samples.slice(loaded).map(s => s.scrollWidth - s.clientWidth)) });
        await context.close();
        save(); console.log('timeline', name, delayedConsent, 'passed');
      }
      // Compare only the two already-corrected mechanisms relevant to focus/rotation.
      for (const before of [true, false]) {
        const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
        await context.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; sessionStorage.setItem('cronoxNewsletterShown', 'true'); });
        const page = await context.newPage();
        if (before) for (const asset of ['customer-typography.css', 'app.js']) {
          const body = execFileSync('git', ['show', `HEAD:cronox-front/assets/${asset}`]);
          await page.route(`**/assets/${asset}*`, route => route.fulfill({ body, contentType: asset.endsWith('.js') ? 'text/javascript' : 'text/css' }));
        }
        await page.goto('http://127.0.0.1:4185/tienda'); await reject(page);
        await page.locator('#btnSearch').click();
        const font = await page.locator('#searchInput').evaluate(e => getComputedStyle(e).fontSize);
        await page.locator('.searchbar__close').click(); await page.locator('#profileBtn').click();
        // keyboard activation keeps focus on the link in the form being hidden.
        await page.locator('[data-auth-switch="register"]').first().focus(); await page.keyboard.press('Enter');
        const focus = await page.evaluate(() => ({ closeFocused: document.activeElement?.id === 'authCloseBtn', visible: !!document.activeElement?.getClientRects().length, scale: visualViewport.scale }));
        if (!before) { assert.equal(font, '16px'); assert.equal(focus.closeFocused, true); }
        result.comparison.push({ engine: name, stage: before ? 'HEAD-before-compatibility' : 'current', searchFont: font, focus });
        await context.close();
      }
      if (name === 'chromium') {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        await page.route('http://diagnostic.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}h1{font-size:16px;width:max-content}</style><h1>Calibration</h1><input id="PRIVATE-ID" name="PRIVATE-NAME" value="PRIVATE-VALUE"><a href="/?token=PRIVATE-TOKEN">PRIVATE-TEXT</a>' }));
        await page.goto('http://diagnostic.invalid/?personal=PRIVATE-URL');
        await page.addScriptTag({ content: script });
        let requests = 0; page.on('request', () => requests++);
        assert.equal((await read(page)).samples.length, 0);
        page.once('dialog', dialog => dialog.dismiss());
        assert.equal(await page.evaluate(() => CRONOXZoomDiagnostic.start()), false);
        assert.equal((await read(page)).samples.length, 0);
        page.once('dialog', dialog => dialog.accept());
        assert.equal(await page.evaluate(() => CRONOXZoomDiagnostic.start()), true);
        await page.locator('input').focus();
        result.calibration.normal = await mark(page);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
        result.calibration.pinch2x = await mark(page);
        assert.equal(result.calibration.pinch2x.visual.scale, 2);
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
        await page.locator('h1').evaluate(e => e.style.fontSize = '32px');
        result.calibration.text2x = await mark(page);
        assert.equal(result.calibration.text2x.visual.scale, 1);
        assert.equal(result.calibration.text2x.probes.heading.style.fontSize, 32);
        assert.ok(result.calibration.text2x.probes.headingGlyphBox.width > result.calibration.normal.probes.headingGlyphBox.width * 1.9);
        await page.evaluate(() => { const div = document.createElement('div'); div.style.cssText = 'width:900px;height:10px'; document.body.append(div); });
        result.calibration.overflow = await mark(page);
        assert.ok(result.calibration.overflow.scrollWidth > result.calibration.overflow.clientWidth);
        // Mobile engines may ALSO zoom out when overflow appears; do not assume categories exclusive.
        const exported = await page.evaluate(() => CRONOXZoomDiagnostic.exportJSON());
        assert.ok(!/PRIVATE-|diagnostic.invalid/.test(exported));
        assert.equal(requests, 0);
        await page.evaluate(() => CRONOXZoomDiagnostic.stop());
        const stopped = (await read(page)).samples.length;
        await page.locator('h1').click(); await page.waitForTimeout(600);
        assert.equal((await read(page)).samples.length, stopped);
        result.privacy = { inertBeforeConsent: true, declinedNoSamples: true, sentinelDataAbsent: true, requests: 0, stoppedNoNewSamples: true };
        await context.close();
      }
    } finally { await browser.close(); save(); }
  }
  console.log(JSON.stringify({ timelines: result.timelines, comparison: result.comparison, privacy: result.privacy }, null, 2));
})().catch(error => { save(); console.error(error); process.exitCode = 1; });
