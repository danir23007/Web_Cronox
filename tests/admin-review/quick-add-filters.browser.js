// Actual localhost storefront; only image delivery is held to exercise slow/out-of-order loads.
// No cart writes; unit tests inspect emitted cart actions independently.
async page => {
  await page.context().unrouteAll({ behavior: 'ignoreErrors' });
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  const results = [];
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('http://localhost:3000/tienda');
    await page.waitForFunction(() => document.querySelectorAll('#productsGrid .product-card').length === 7);
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    await page.locator('#btnMenu').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-store-category]').length === 6);
    const labels = await page.locator('#storeCategoryFilters .black-menu__link').allTextContents();
    assert(labels.join('|') === 'Novedades|D#01|Camisetas|Chaquetas|Complementos|Pantalones', 'Group order: ' + labels);
    const row = page.locator('label.black-menu__category-row').filter({ has: page.locator('[value="camisetas"]') });
    await row.click();
    await page.waitForFunction(() => document.querySelectorAll('#productsGrid .product-card').length === 4);
    await row.locator('input').focus(); await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelectorAll('#productsGrid .product-card').length === 7);
    await page.keyboard.press('Escape');

    const held = [];
    const holdImages = async route => {
      if (route.request().resourceType() === 'image') held.push(route);
      else await route.continue();
    };
    await page.context().route('**/*', holdImages); // Routing also disables the HTTP cache.
    const cards = page.locator('#productsGrid .product-card');
    const firstName = await cards.nth(0).locator('.product-name').textContent();
    const secondName = await cards.nth(1).locator('.product-name').textContent();
    await cards.nth(0).locator('.fav-add').click();
    const original = await page.locator('#qaImg1').elementHandle();
    await page.waitForFunction(() => document.querySelector('.qa-media').getAttribute('aria-busy') === 'true');
    assert(await page.locator('#qaImg1').evaluate(el => getComputedStyle(el).opacity === '0'), 'First uncached image hidden');
    const originalSources = await page.locator('.qa-media img').evaluateAll(images => images.map(image => image.src));
    const mediaHeight = await page.locator('.qa-media').evaluate(el => el.getBoundingClientRect().height);
    await page.locator('.qa-close').click();
    await cards.nth(1).locator('.fav-add').click();
    const currentSources = await page.locator('.qa-media img').evaluateAll(images => images.map(image => image.src));
    assert(await page.locator('#qaName').textContent() === secondName, 'Name follows selected card');
    assert(!await original.evaluate(el => el.isConnected), 'Previous bitmap node detached');
    assert(currentSources.every(url => !originalSources.includes(url)), 'New sources never fall back to previous product');
    assert(await page.locator('#qaImg1').evaluate(el => getComputedStyle(el).opacity === '0'), 'Previous photo cannot paint while new loads');
    assert(await page.locator('.qa-media').evaluate(el => el.getBoundingClientRect().height) === mediaHeight, 'Media space stable');
    await page.screenshot({ path: `output/playwright/quick-add-filters-2026-10-05/loading-${width}.png` });

    // Finish old requests last: their responses must not alter the selected product.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#444"/></svg>';
    await page.waitForFunction(() => [...document.querySelectorAll('.qa-media img')].every(image => image.src));
    await new Promise(resolve => setTimeout(resolve, 100)); // Network interception rendezvous, never a product delay.
    const pending = held.splice(0);
    for (const route of [...pending].reverse()) {
      try { await route.fulfill({ contentType: 'image/svg+xml', body: svg }); } catch {} // Detached request can be cancelled by the browser.
    }
    await page.waitForFunction(() => document.querySelector('.qa-media').getAttribute('aria-busy') === 'false');
    assert(await page.locator('#qaName').textContent() === secondName, 'Late previous response ignored');
    await page.locator('.qa-close').click();
    await cards.nth(0).locator('.fav-add').click();
    const beforeReopen = await page.locator('#qaImg1').elementHandle();
    await page.locator('.qa-close').click(); // Close before delivery, then reopen the same product.
    await cards.nth(0).locator('.fav-add').click();
    assert(await page.locator('#qaName').textContent() === firstName, 'Reopen follows current card');
    assert(!await beforeReopen.evaluate(el => el.isConnected), 'Reopen has independent image nodes');
    assert(await page.locator('#qaImg1').evaluate((el, urls) =>
      getComputedStyle(el).opacity === '0' || (el.naturalWidth > 0 && urls.includes(el.src)), originalSources),
    'Reopen only shows the current product, including a decoded cache hit');
    await page.locator('.qa-close').click();
    for (const route of held.splice(0)) { try { await route.abort(); } catch {} }
    await page.context().unroute('**/*', holdImages);
    assert(await page.locator('.qa-media img').count() === 0, 'Closed modal has no image content');
    results.push({ width, filterOrder: labels, slowAndReorderedImages: 'PASS', closeReopen: 'PASS' });
  }
  assert(errors.length === 0, 'JavaScript errors: ' + errors.join('; '));
  return { results, pageErrors: errors, cartWrites: 0, catalogMocks: 0 };
}
