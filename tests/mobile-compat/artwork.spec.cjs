const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const sharp = require('../../cronox-backend/node_modules/sharp');
const { prepareZXingModule, readBarcodes } = require('zxing-wasm/reader');
const { installDiagnostics } = require('./diagnostics.cjs');
const token = 'CRX:1:local-compatibility-fixture-not-a-credential';
async function differences(a, b) {
 const aa = await sharp(a).ensureAlpha().raw().toBuffer();
 const bb = await sharp(b).ensureAlpha().raw().toBuffer();
 expect(aa.length).toBe(bb.length);
 let changed = 0, sum = 0;
 for (let i = 0; i < aa.length; i += 4) {
  const delta = Math.max(...[0, 1, 2].map(c => Math.abs(aa[i + c] - bb[i + c])));
  if (delta > 12) changed++;
  sum += delta;
 }
 return { fraction: changed / (aa.length / 4), average: sum / (aa.length / 4) };
}
test('five circles: real alpha, rendered logos, both faces and decodable QR', async ({ page, context }, testInfo) => {
 await context.addInitScript(installDiagnostics);
 prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });
 await page.goto('/compat-accreditation');
 for (let circleLevel = 1; circleLevel <= 5; circleLevel++) {
  await page.evaluate(async circleLevel => { await renderer.update({ ...fixtureData, circleLevel }); }, circleLevel);
  await expect(page.locator('.crx-rim-panel')).toHaveCount(68);
  for (const name of ['symbol', 'wordmark', 'eye']) {
   const { data, info } = await sharp(`cronox-front/assets/metacrilatos/${name}-${circleLevel}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
   const source = await sharp(`cronox-front/assets/metacrilatos/${name}.png`).metadata();
   expect([info.width, info.height]).toEqual([source.width, source.height]);
   let transparent = 0, ink = 0;
   for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) transparent++; if (data[i] > 190) ink++; }
   expect(transparent / (data.length / 4)).toBeGreaterThan(0.5);
   expect(ink).toBeGreaterThan(1000);
  }
  for (const face of ['front', 'back']) {
   if (face === 'back') await page.locator('[data-crx-flip]').click();
   await expect(page.locator(`.crx-${face}`)).toBeVisible();
   const original = await page.locator('.crx-stage').screenshot({ path: `output/playwright/mobile-compat/after-${testInfo.project.name}-circle-${circleLevel}-${face}.png` });
   // Actual pixel equivalence with the risky filter/blend stack disabled;
   // catches a future return to black/white rectangular image backgrounds.
   const reset = await page.addStyleTag({ content: '.crx-label-symbol img,.crx-long-logo img,.crx-eye-logo {filter:none!important;mix-blend-mode:normal!important}' });
   const plain = await page.locator('.crx-stage').screenshot();
   expect((await differences(original, plain)).fraction).toBe(0);
   await reset.evaluate(e => e.remove());
   if (face === 'back') {
    const { data, info } = await sharp(await page.locator('.crx-qr').screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const codes = await readBarcodes({ data: new Uint8ClampedArray(data), width: info.width, height: info.height }, { formats: ['QRCode'], tryHarder: true });
    expect(codes.map(c => c.text)).toEqual([token]);
    expect(codes[0].isMirrored).toBe(false);
   }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 }
});
test('automatic darkening is separate from dark preference and preserves artwork', async ({ page, context, browserName }, testInfo) => {
 test.skip(browserName !== 'chromium', 'Auto-dark CDP override is Chromium-specific; other engines still test light/dark preferences.');
 const cdp = await context.newCDPSession(page);
 await page.goto('/compat-accreditation');
 await page.evaluate(() => renderer.ready);
 const samples = [];
 for (let circleLevel = 1; circleLevel <= 5; circleLevel++) {
  await page.evaluate(async circleLevel => { await renderer.update({ ...fixtureData, circleLevel }); }, circleLevel);
  for (const face of ['front', 'back']) {
   if (face === 'back') await page.locator('[data-crx-flip]').click();
   await cdp.send('Emulation.setAutoDarkModeOverride', { enabled: false });
   await page.emulateMedia({ colorScheme: 'light' });
   const light = await page.locator('.crx-stage').screenshot();
   await page.emulateMedia({ colorScheme: 'dark' });
   const dark = await page.locator('.crx-stage').screenshot();
   expect((await differences(light, dark)).fraction).toBeLessThan(0.001);
   // Match Chrome DevTools' documented mode: dark media preference AND the
   // independent auto-dark override. Merely setting the preference is not it.
   await cdp.send('Emulation.setAutoDarkModeOverride', { enabled: true });
   const auto = await page.locator('.crx-stage').screenshot({ path: `output/playwright/mobile-compat/after-auto-dark-circle-${circleLevel}-${face}.png` });
   const delta = await differences(dark, auto);
   samples.push({ circleLevel, face, ...delta });
   expect(delta.fraction).toBeLessThan(0.005);
  }
 }
 await testInfo.attach('auto-dark-pixel-differences', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
});
test('light/dark preferences, forced contrast and touch/keyboard flip remain usable', async ({ page }, testInfo) => {
 await page.goto('/compat-accreditation');
 await page.evaluate(() => renderer.ready);
 for (const colorScheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme });
  await page.locator('[data-crx-flip]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.crx-back')).toBeVisible();
  await page.locator('[data-crx-flip]').tap();
  await expect(page.locator('.crx-front')).toBeVisible();
 }
 await page.emulateMedia({ forcedColors: 'active' });
 const contrast = await page.locator('.crx-metacrilatos').evaluate(e => ({ supported: CSS.supports('forced-color-adjust', 'auto'), value: getComputedStyle(e).forcedColorAdjust }));
 if (contrast.supported) expect(contrast.value).toBe('auto');
 await testInfo.attach('contrast-support', { body: JSON.stringify(contrast), contentType: 'application/json' });
 await page.locator('[data-crx-flip]').focus();
 await expect(page.locator('[data-crx-flip]')).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(page.locator('.crx-back')).toBeVisible();
 await expect(page.locator('.crx-qr img')).toBeVisible();
 await page.screenshot({ path: `output/playwright/mobile-compat/contrast-${testInfo.project.name}.png` });
});
