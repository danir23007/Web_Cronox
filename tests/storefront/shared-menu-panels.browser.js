async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  const results = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('http://localhost:3000/cuenta');
    await page.waitForFunction(() => Boolean(window.CRONOX_USER));
    assert(new URL(page.url()).pathname === '/cuenta', 'Actual authenticated profile');
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    await page.locator('#btnMenu').click();
    await page.locator('.filters-close').click();
    await page.waitForSelector('#filtersPanel', { state: 'hidden' });
    await page.goto('http://localhost:3000/checkout');
    await page.waitForFunction(() => !document.body.classList.contains('is-loading'));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const checkoutScroll = await page.evaluate(() => scrollY);
    await page.locator('#btnMenu').click();
    await page.locator('.filters-close').click();
    await page.waitForSelector('#filtersPanel', { state: 'hidden' });
    assert(Math.abs(await page.evaluate(() => scrollY) - checkoutScroll) <= 1, 'Checkout menu accessible at footer without changing scroll');
    for (const mode of ['CAROUSEL', 'MOSAIC']) {
      // Test both existing public renderers without editing the saved gallery configuration.
      await page.route('**/api/gallery', async route => {
        const response = await route.fetch(), payload = await response.json();
        payload.mode = mode;
        await route.fulfill({ response, json: payload });
      });
      await page.goto('http://localhost:3000/galeria');
      await page.waitForFunction(expected => document.querySelector('#galleryGrid')?.dataset.galleryMode === expected, mode);
      await page.locator('#btnMenu').click();
      await page.waitForFunction(() => Math.abs(document.querySelector('#filtersPanel').getBoundingClientRect().left) < 1);
      await page.screenshot({ path: `output/playwright/shared-menu-${mode.toLowerCase()}-${width}.png` });
      await page.locator('.filters-close').click();
      await page.waitForSelector('#filtersPanel', { state: 'hidden' });
      assert(await page.locator('#galleryGrid').getAttribute('data-gallery-mode') === mode, 'Gallery renderer preserved');
      await page.unroute('**/api/gallery');
    }
    await page.goto('http://localhost:3000/tienda');
    await page.evaluate(() => window.CRONOX_catalogReady);
    await page.locator('#btnSearch').click();
    await page.locator('#btnMenu').click();
    await page.locator('.filters-close').click();
    await page.waitForSelector('#filtersPanel', { state: 'hidden' });
    assert(await page.evaluate(() => document.documentElement.classList.contains('has-scroll-lock')), 'Search retains lock');
    assert(await page.locator('#overlay').isVisible(), 'Search retains backdrop');
    await page.locator('.searchbar__close').click();
    assert(await page.evaluate(() => !document.documentElement.classList.contains('has-scroll-lock')), 'Search releases last lock');
    // Small viewport and a long dynamic category list cannot scroll the logo/X away.
    await page.setViewportSize({ width, height: 360 });
    await page.evaluate(async () => {
      const original = window.CRONOX_API.getAllCategories;
      window.CRONOX_API.getAllCategories = async () => [...await original(),
        ...Array.from({ length: 40 }, (_, i) => ({ name: `Test ${i}`, slug: `test-${i}`, group: 'GARMENT' }))];
      await window.CRONOX_STORE_CATEGORIES.refresh();
    });
    await page.locator('#btnMenu').click();
    await page.waitForFunction(() => Math.abs(document.querySelector('#filtersPanel').getBoundingClientRect().left) < 1);
    const geometry = await page.locator('#filtersPanel').evaluate(panel => {
      const list = panel.querySelector('.black-menu__list'); list.scrollTop = list.scrollHeight;
      const logo = panel.querySelector('.black-menu__brand').getBoundingClientRect();
      const close = panel.querySelector('.filters-close'); const rect = close.getBoundingClientRect();
      return { listScroll: list.scrollTop, logoTop: logo.top, logoBottom: logo.bottom,
        hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === close };
    });
    assert(geometry.listScroll > 0 && geometry.logoTop >= 0 && geometry.logoBottom < 360 && geometry.hit, 'Header stays visible during menu scroll');
    await page.locator('.filters-close').click();
    await page.waitForSelector('#filtersPanel', { state: 'hidden' });
    results.push({ width, authenticatedProfile: 'PASS', checkoutFooter: 'PASS', carousel: 'PASS', mosaic: 'PASS', searchLock: 'PASS', shortViewportLongList: 'PASS' });
  }
  return results;
}
