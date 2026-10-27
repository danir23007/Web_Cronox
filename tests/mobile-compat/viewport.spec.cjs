const { test, expect } = require('@playwright/test');
const { installDiagnostics } = require('./diagnostics.cjs');
const editable = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=hidden]):visible,select:visible,textarea:visible';
async function prepare(context, newsletter = false) {
 await context.addInitScript(installDiagnostics);
 if (!newsletter) await context.addInitScript(() => sessionStorage.setItem('cronoxNewsletterShown', 'true'));
}
async function visit(page, url) {
 await page.goto(url);
 const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
 if (await reject.isVisible()) await reject.click();
 await page.evaluate(() => document.fonts.ready);
}
async function geometry(page, label, testInfo) {
 const state = await page.evaluate(label => compatMeasure(label), label);
 await testInfo.attach(label, { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
 expect(state.viewport).toHaveLength(1);
 expect(state.viewport[0]).toMatch(/width=device-width/);
 expect(state.viewport[0]).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
 expect(state.scrollWidth).toBeLessThanOrEqual(state.clientWidth + 1);
 // Desktop innerWidth includes the native scrollbar; mobile normally has none.
 expect(state.innerWidth - state.clientWidth).toBeLessThanOrEqual(20);
 if (state.visual) expect(state.visual.scale).toBeCloseTo(1, 2);
}
async function fields(page) {
 const inputs = await page.locator(editable).evaluateAll(es => es.map(e => ({ name: e.id || e.name || e.type, size: parseFloat(getComputedStyle(e).fontSize) })));
 for (const input of inputs) expect(input.size, input.name).toBeGreaterThanOrEqual(16);
}
for (const width of [320, 360, 375, 390, 412, 430, 844, 1440]) {
 test(`public geometry and fields ${width}`, async ({ page, context }, testInfo) => {
  await prepare(context);
  await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
  for (const url of ['/tienda?utm_source=qr', '/producto/compat-shirt', '/cesta', '/checkout']) {
   await visit(page, url);
   await geometry(page, `${url}-${width}`, testInfo);
   if (width <= 844) await fields(page);
   if (url.startsWith('/tienda')) {
    const marks = await page.locator('.footer-primary-mark,.footer-secondary-logo,.footer-cx-logo').evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, center: r.x + r.width / 2 }; }));
    if (width <= 430) {
     expect(Math.abs(marks[1].center - width / 2)).toBeLessThan(1);
     expect(marks[0].right).toBeLessThan(marks[1].x);
     expect(marks[1].right).toBeLessThan(marks[2].x);
    }
    await page.locator('#btnSearch').click();
    await expect(page.locator('#searchInput')).toBeFocused();
    if (width <= 844) await fields(page);
    await geometry(page, `search-${width}`, testInfo);
    await page.locator('.searchbar__close').click();
    await page.locator('#profileBtn').click();
    await expect(page.locator('#authOverlay')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('[data-auth-switch="register"]').first().click();
    if (width <= 844) await fields(page);
    await page.keyboard.press('Tab');
    expect(await page.locator('#authOverlay').evaluate(e => e.contains(document.activeElement))).toBe(true);
    await page.locator('#authCloseBtn').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.locator('#authOverlay').evaluate(e => e.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.locator('#authCloseBtn')).toBeFocused();
    await geometry(page, `register-${width}`, testInfo);
    await page.keyboard.press('Escape');
    await expect(page.locator('#authOverlay')).toHaveAttribute('aria-hidden', 'true');
    await page.locator('.product-card .fav-add').first().click();
    await expect(page.locator('#quickAdd')).toHaveAttribute('aria-hidden', 'false');
    if (width <= 844) await fields(page);
    await geometry(page, `quick-add-${width}`, testInfo);
    await page.locator('.qa-close').click();
    await page.locator('#cart-icon-btn').click();
    await expect(page.locator('#cart-drawer')).toHaveAttribute('aria-hidden', 'false');
    await geometry(page, `cart-drawer-${width}`, testInfo);
    await page.locator('#cart-close-btn').click();
   }
  }
  await context.addCookies([{ name: 'compat-auth', value: '1', url: 'http://127.0.0.1:4185' }]);
  await visit(page, '/cuenta');
  if (width <= 844) await fields(page);
  await page.locator('[data-profile-tab="accreditation"]').click();
  await expect(page.locator('.crx-metacrilatos')).toBeVisible();
  await expect(page.locator('.crx-rim-panel')).toHaveCount(68);
  await geometry(page, `profile-accreditation-${width}`, testInfo);
  await page.screenshot({ path: `output/playwright/mobile-compat/after-${testInfo.project.name}-profile-${width}.png`, fullPage: true });
 });
}
test('first visit, delayed newsletter, focus, reload and return', async ({ page, context }, testInfo) => {
 await prepare(context, true);
 await visit(page, '/?utm_source=qr&utm_campaign=event');
 await expect(page.locator('.newsletter-modal-overlay')).toHaveAttribute('aria-hidden', 'false', { timeout: 12000 });
 await expect(page.locator('.newsletter-modal-close')).toBeFocused();
 await geometry(page, 'newsletter-first-visit', testInfo);
 await fields(page);
 await page.locator('#newsletterEmail').focus();
 await page.keyboard.type('local@example.test');
 await geometry(page, 'newsletter-email-focused', testInfo);
 await page.setViewportSize({ width: 844, height: 390 });
 await fields(page);
 await geometry(page, 'newsletter-landscape', testInfo);
 await page.keyboard.press('Escape');
 await expect(page.locator('.newsletter-modal-overlay')).toHaveAttribute('aria-hidden', 'true');
 const samples = await page.evaluate(() => compatSamples);
 await testInfo.attach('load-timeline', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
 for (const sample of samples) {
  if (sample.visual) expect(sample.visual.scale, sample.reason).toBeCloseTo(1, 2);
  expect(sample.viewport, sample.reason).toHaveLength(1);
 }
 await page.reload();
 await geometry(page, 'cached-reload', testInfo);
 await visit(page, '/producto/compat-shirt');
 await page.goBack();
 await geometry(page, 'back-navigation', testInfo);
 await page.goto('/tienda');
 await geometry(page, 'cached-navigation', testInfo);
 await testInfo.attach('cache-resource-timing', { body: JSON.stringify(await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('/assets/')).map(e => ({ name: e.name, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize })))), contentType: 'application/json' });
});
test('slow assets, failed fonts, enlarged text and manual zoom', async ({ page, context, browserName }, testInfo) => {
 await prepare(context);
 await page.route('**/*.woff2*', route => route.abort());
 await page.route('**/*.css*', async route => { await new Promise(resolve => setTimeout(resolve, 350)); await route.continue(); });
 await page.route('**/assets/metacrilatos/*.png', async route => { await new Promise(resolve => setTimeout(resolve, 400)); await route.continue(); });
 await visit(page, '/compat-accreditation');
 await page.evaluate(() => renderer.ready);
 await geometry(page, 'font-failure-card', testInfo);
 await expect(page.locator('[data-crx-name]')).toHaveText('Persona Prueba');
 await visit(page, '/tienda');
 await page.addStyleTag({ content: 'body[data-cronox-surface="customer"] { -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }' });
 await geometry(page, 'text-enlarged', testInfo);
 if (browserName === 'chromium') {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => visualViewport.scale)).toBeCloseTo(2);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => visualViewport.scale)).toBeCloseTo(2);
  await testInfo.attach('manual-zoom', { body: JSON.stringify(await page.evaluate(() => compatMeasure('manual zoom 2x'))), contentType: 'application/json' });
 }
});
test('direct auth links and desktop forms preserve accessible focus', async ({ browser }, testInfo) => {
 const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
 await prepare(context);
 const page = await context.newPage();
 try {
  for (const entry of ['/?login=1', '/?register=1']) {
   await visit(page, entry);
   await expect(page.locator('#authOverlay')).toHaveAttribute('aria-hidden', 'false');
   await expect.poll(() => page.locator('#authOverlay').evaluate(e => e.contains(document.activeElement))).toBe(true);
   await geometry(page, entry, testInfo);
   await page.locator('#authCloseBtn').click();
  }
  await visit(page, '/checkout');
  await geometry(page, 'desktop-checkout', testInfo);
 } finally { await context.close(); }
});
test('late fonts and themed public forms', async ({ page, context, browserName }, testInfo) => {
 await prepare(context);
 await page.route('**/*.woff2*', async route => { await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue(); });
 await page.goto('/tienda', { waitUntil: 'domcontentloaded' });
 await geometry(page, 'before-delayed-fonts', testInfo);
 await page.evaluate(() => document.fonts.ready);
 await geometry(page, 'after-delayed-fonts', testInfo);
 const cdp = browserName === 'chromium' ? await context.newCDPSession(page) : null;
 for (const colorScheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme });
  for (const url of ['/tienda', '/checkout', '/privacidad']) {
   await visit(page, url);
   await geometry(page, `${colorScheme}-${url}`, testInfo);
   await fields(page);
   if (cdp && colorScheme === 'dark') {
    await cdp.send('Emulation.setAutoDarkModeOverride', { enabled: true });
    await page.screenshot({ path: `output/playwright/mobile-compat/auto-dark-public-${url.slice(1)}.png`, fullPage: true });
    await geometry(page, `auto-dark-${url}`, testInfo);
    await cdp.send('Emulation.setAutoDarkModeOverride', { enabled: false });
   }
  }
 }
});
