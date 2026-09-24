const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.resolve(__dirname, '../../cronox-front/assets');
const scripts = ['key-screen-time.js', 'key-screen-renderer.js', 'media-framing-geometry.js', 'admin-key-screen.js'];

test('wheel over the admin key-screen image scrolls the page, while only the slider changes zoom', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/assets/*.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/api/admin/key-screens', route => route.fulfill({ json: {
    settings: { enabled: true, activeScreenId: 'screen', expiresAt: null, serverTime: new Date().toISOString() },
    screens: [{ id: 'screen', internalName: 'Prerregistro', mediaAssetId: 'asset', desktopZoom: 1.3, mobileZoom: 1,
      desktopFocalX: 50, desktopFocalY: 50, desktopFit: 'COVER', mobileFit: 'COVER', overlayStrength: 25 }],
    assets: [{ id: 'asset', publicUrl: 'http://127.0.0.1:4173/assets/logo_browser.png', mediaType: 'image', originalFilename: 'image.png' }],
    preregisteredCount: 1,
  } }));
  await page.route('**/api/admin/launch', route => route.fulfill({ json: {
    status: 'PENDING', recipients: 1, sent: 0, pending: 1, uncertain: 0, emailReady: false, keyScreenEnabled: true,
  } }));
  await page.goto('/admin.html');
  await page.evaluate(() => {
    window.CRONOX_API = { API_BASE: '', getCsrfHeaders: async () => ({}) };
    document.querySelector('#adminShell').hidden = false;
    document.querySelector('#section-key-screen').hidden = false;
    document.body.style.minHeight = '4000px';
  });
  for (const script of scripts) await page.addScriptTag({ content: fs.readFileSync(path.join(assets, script), 'utf8') });
  await page.evaluate(() => window.CRONOX_KEY_SCREEN.load());
  const image = page.locator('#keyPreviewMedia img');
  await expect(image).toBeVisible();
  const zoom = page.locator('[name="desktopZoom"]');
  await expect(zoom).toHaveValue('1.3');
  await image.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  const box = await image.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 550);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  await expect(zoom).toHaveValue('1.3');
  await expect(zoom.locator('xpath=preceding-sibling::output[1]')).toHaveText('1.30×');
  await zoom.evaluate(input => { input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(zoom.locator('xpath=preceding-sibling::output[1]')).toHaveText('2.00×');
  expect(errors).toEqual([]);
});
