// Normal local app: login only, then read-only sales/map requests. No fixtures in DB.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');

(async () => {
  const env = loadLocalEnvironment(); // rejects remote databases and production services
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage(), errors = [], responses = [];
  const out = path.resolve('output/playwright/admin-map');
  await fs.mkdir(out, { recursive: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/api/admin/map?') || response.url().includes('/assets/maps/')) responses.push({ url: response.url(), status: response.status() });
  });
  await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  try {
    await page.goto('http://localhost:3000/admin.html#section-map');
    if (await page.locator('#adminLoginEmail').isVisible()) {
      await page.locator('#adminLoginEmail').fill(env.LOCAL_ADMIN_EMAIL);
      await page.locator('#adminLoginPassword').fill(env.LOCAL_ADMIN_PASSWORD);
      await page.locator('#adminLoginSubmit').click();
    }
    await expect(page.locator('#adminShell')).toBeVisible();
    await page.locator('nav > .sidebar-destination[data-nav-target="section-map"]').click();
    await expect(page.locator('#section-map')).toBeVisible();
    await expect(page.locator('.map-graphic svg')).toBeVisible();
    await page.locator('#adminMap [name="from"]').fill('2000-01-01');
    await page.locator('#adminMap [name="to"]').fill('2000-01-02');
    const salesResponse = page.waitForResponse(response => response.url().includes('/api/admin/map?') && response.url().includes('to=2000-01-02'));
    await page.getByRole('button', { name: 'Aplicar fechas', exact: true }).click();
    const sales = await salesResponse;
    if (sales.status() !== 200) throw new Error(`Local Mapa API returned HTTP ${sales.status()}`);
    await expect(page.locator('.map-status')).toHaveText('No hay pedidos pagados en este período');
    await expect(page.locator('nav > .sidebar-destination[data-nav-target="section-map"]')).toBeVisible();
    await page.getByRole('switch', { name: 'Modo oscuro' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, 'desktop-local-empty.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.map-graphic [data-region="18"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.map-tooltip')).toContainText('Ceuta');
    await expect(page.locator('.map-detail')).toContainText('No hay pedidos pagados');
    await page.locator('.map-cartography').screenshot({ path: path.join(out, 'mobile-local-empty.png') });
    expect(errors).toEqual([]);
    await fs.writeFile(path.join(out, 'local-report.json'), JSON.stringify({ responses, errors, base: await page.evaluate(() => window.CRONOX_API.API_BASE) }, null, 2));
    console.log('PASS: normal localhost app, authenticated API 200, local empty map visible, desktop/mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
