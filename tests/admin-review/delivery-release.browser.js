// Read-only release verification. Cart scenarios are browser-only fixtures;
// all non-GET/HEAD requests are blocked, including checkout and telemetry.
async page => {
  const origin = new URL(page.url()).origin;
  if (!['http://localhost:3000', 'https://cronox.es'].includes(origin)) throw Error('Unexpected release target');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.context().route('**/*', route =>
    ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  const dates = [
    ['2026-10-05T12:00:00Z', '8 de octubre'],
    ['2026-10-09T12:00:00Z', '14 de octubre'],
    ['2026-11-08T12:00:00Z', '12 de noviembre'],
    ['2026-04-28T12:00:00Z', '4 de mayo'],
    ['2026-05-12T12:00:00Z', '17 de mayo'],
    ['2026-12-30T12:00:00Z', '4 de enero'],
    ['2027-12-29T12:00:00Z', null],
  ];
  const results = [];
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(origin + '/tienda');
    await page.waitForFunction(() => document.querySelectorAll('#productsGrid .product-card').length > 1);
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    const productPath = await page.locator('#productsGrid .product-card').first().getAttribute('href');
    await page.locator('#btnMenu').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-store-category]').length > 0);
    const categories = await page.evaluate(async () => {
      const rows = await window.CRONOX_API.getAllCategories();
      const rank = { NEW: 0, DROP: 1, GARMENT: 2 };
      const collator = new Intl.Collator('es', { sensitivity: 'base' });
      return rows.filter(c => c.isActive !== false && c.showInStoreFilters !== false)
        .sort((a, b) => (rank[a.group] ?? 3) - (rank[b.group] ?? 3) || collator.compare(a.name, b.name))
        .map(c => c.name);
    });
    const labels = await page.locator('#storeCategoryFilters .black-menu__link').allTextContents();
    assert(JSON.stringify(labels) === JSON.stringify(categories), 'Public dynamic category order/visibility');
    const input = page.locator('[data-store-category]').last();
    await input.focus(); await page.keyboard.press('Space');
    assert(await input.isChecked(), 'Keyboard selection');
    await page.keyboard.press('Space');
    assert(!await input.isChecked(), 'Keyboard deselection');
    assert(await input.evaluate(el => getComputedStyle(el).clipPath === 'inset(50%)'), 'Checkbox stays visually hidden');
    await page.keyboard.press('Escape');
    const cards = page.locator('#productsGrid .product-card');
    await cards.first().locator('.fav-add').click();
    const oldImage = await page.locator('#qaImg1').elementHandle();
    await page.locator('.qa-close').click();
    const selectedName = await cards.nth(1).locator('.product-name').textContent();
    await cards.nth(1).locator('.fav-add').click();
    assert(!await oldImage.evaluate(el => el.isConnected), 'Quick Add replaces previous image nodes');
    assert(await page.locator('#qaName').textContent() === selectedName, 'Quick Add current product');
    await page.locator('.qa-close').click();

    // No network cart mutations: install only a client-side getCart fixture.
    await page.evaluate(async () => {
      const response = await fetch('/api/products?limit=48');
      const data = await response.json();
      const products = data.items || data;
      const makeItem = (product, id) => ({ id, qty: 1, variantId: product.variants[0].id,
        product, productId: product.id, priceCents: product.priceCents || 1000 });
      window.__deliveryReviewItems = products.slice(0, 2).map((product, i) => makeItem(product, i + 1));
      window.CRONOX_API.getCart = async () => ({
        items: window.__deliveryReviewItems, currency: 'EUR',
        itemsCount: window.__deliveryReviewItems.reduce((sum, item) => sum + item.qty, 0),
        subtotalCents: window.__deliveryReviewItems.reduce((sum, item) => sum + item.qty * item.priceCents, 0),
      });
      await window.CRONOX_CART.fetchCart();
    });
    await page.locator('#cart-icon-btn').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#cart-drawer')).transform === 'matrix(1, 0, 0, 1, 0, 0)');
    const cartNotice = page.locator('[data-cart-delivery]');
    for (const [instant, expected] of dates) {
      await page.evaluate(instant => {
        Date.now = () => Date.parse(instant);
        dispatchEvent(new Event('pageshow'));
      }, instant);
      assert(await cartNotice.isVisible() === !!expected, 'Cart calendar coverage');
      assert(await cartNotice.locator('[data-delivery-date]').textContent() === (expected || ''), 'Controlled cart date ' + instant);
    }
    await page.evaluate(async () => {
      Date.now = () => Date.parse('2026-10-09T12:00:00Z');
      window.__deliveryReviewItems[0].qty = 3;
      await window.CRONOX_CART.fetchCart();
    });
    assert(await cartNotice.locator('[data-delivery-date]').textContent() === '14 de octubre', 'Quantity uses shared forecast');
    assert(await cartNotice.count() === 1, 'One order forecast');
    const borders = await page.evaluate(() => [
      getComputedStyle(document.querySelector('#cart-items-container .cart-line:last-of-type')).borderBottomWidth,
      getComputedStyle(document.querySelector('#cart-upsell-section')).borderTopWidth,
      getComputedStyle(document.querySelector('#cart-items-container')).borderBottomWidth,
    ]);
    assert(borders.join('|') === '0px|0px|1px', 'Single separator');
    await page.screenshot({ path: `output/playwright/delivery-release-2026-10-05/${new URL(origin).hostname}-cart-${width}.png` });
    await page.locator('#cart-close-btn').click(); await page.locator('#cart-icon-btn').click();
    assert(await cartNotice.count() === 1, 'Reopen does not duplicate forecast');
    await page.evaluate(async () => {
      window.__deliveryReviewItems = [];
      await window.CRONOX_CART.fetchCart();
    });
    assert(!await cartNotice.isVisible(), 'Empty cart has no forecast');
    await page.locator('#cart-close-btn').click();

    await page.goto(origin + productPath);
    await page.waitForFunction(() => !!window.CRONOX_DELIVERY);
    const productNotice = page.locator('[data-delivery-notice]:not([data-cart-delivery])');
    assert(await productNotice.isVisible(), 'Real product forecast visible');
    for (const [instant, expected] of dates) {
      await page.evaluate(instant => {
        Date.now = () => Date.parse(instant);
        dispatchEvent(new Event('pageshow'));
      }, instant);
      assert(await productNotice.isVisible() === !!expected, 'Product calendar coverage');
      assert(await productNotice.locator('[data-delivery-date]').textContent() === (expected || ''), 'Same controlled product date ' + instant);
    }
    await page.evaluate(() => {
      Date.now = () => Date.parse('2026-10-09T12:00:00Z');
      dispatchEvent(new Event('pageshow'));
    });
    await page.screenshot({ path: `output/playwright/delivery-release-2026-10-05/${new URL(origin).hostname}-product-${width}.png` });
    assert(!await page.locator('meta[name="robots"]').evaluateAll(nodes => nodes.some(node => /noindex/i.test(node.content))), 'Public PDP is indexable');
    results.push({ width, categories: labels, quickAdd: 'PASS', sharedDates: dates.length, cartFixture: 'browser only', singleSeparator: true });
  }
  assert(errors.length === 0, 'JavaScript errors: ' + errors.join('; '));
  return { origin, results, pageErrors: errors, serverWrites: 0 };
}
