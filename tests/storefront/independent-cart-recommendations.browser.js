// Runs through playwright-cli. All catalogue/cart responses are simulated; no real writes.
async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  const categories = ['chaquetas', 'camisetas', 'pantalones', 'drop-1', 'vacio'].map((slug, i) => ({
    id: i + 1, slug, name: slug, group: slug === 'drop-1' ? 'DROP' : 'GARMENT', isActive: true,
  }));
  const products = [
    [901, 'chaquetas', 9000, 10], [902, 'camisetas', 3500, 10],
    [903, 'pantalones', 5000, 10], [904, 'drop-1', 2500, 1], [905, 'camisetas', 4500, 0],
  ].map(([id, slug, price, stock]) => ({ id, slug: `review-${id}`, name: `Review ${slug} ${id}`,
    price, currency: 'EUR', isActive: true, lastUnitsThreshold: 2, sizeSystem: 'APPAREL',
    imageUrl: '/favicon.png', images: [{ url: '/favicon.png', isPrimary: true }],
    categories: [{ category: categories.find(category => category.slug === slug) }],
    variants: [{ id: id + 100, size: 'M', stock, isActive: true }], reviewCategory: slug,
  }));
  let items = [], fullRequests = [], adds = 0;
  await page.route('**/api/products**', async route => {
    const url = new URL(route.request().url());
    const product = products.find(product => url.pathname === `/api/products/${product.slug}`);
    if (product) return route.fulfill({ json: product });
    assert(!url.searchParams.has('categorySlug') && !url.searchParams.has('search'), 'Full catalogue must have no navigation filter');
    const number = Number(url.searchParams.get('page') || 1);
    fullRequests.push(number);
    await route.fulfill({ json: { items: number === 1 ? [products[0], products[4]] : products.slice(1, 4),
      meta: { page: number, pageCount: 2, total: products.length } } });
  });
  await page.route('**/api/categories**', async route => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/\/categories\/([^/]+)\/products$/);
    if (match) {
      const category = categories.find(category => category.slug === match[1]);
      const list = products.filter(product => product.reviewCategory === category.slug);
      return route.fulfill({ json: { category, products: { items: list, meta: { pageCount: 1, total: list.length } } } });
    }
    await route.fulfill({ json: { items: categories, meta: { page: 1, limit: 100, total: categories.length, pageCount: 1 } } });
  });
  await page.route('**/api/cart**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const { variantId, qty } = request.postDataJSON();
      const product = products.find(product => product.variants[0].id === variantId);
      assert(product?.variants[0].stock > 0, 'Only purchasable stock added');
      const existing = items.find(item => item.variantId === variantId);
      if (existing) existing.qty += qty;
      else items.push({ id: product.id, variantId, qty, priceAtAdd: product.price, variant: { ...product.variants[0], product } });
      adds++;
    }
    await route.fulfill({ json: { id: 900, items, itemsCount: items.reduce((sum, item) => sum + item.qty, 0),
      subtotal: items.reduce((sum, item) => sum + item.qty * item.priceAtAdd, 0) } });
  });
  const eligible = ['review-901', 'review-902', 'review-903', 'review-904'];
  const keys = selector => page.locator(`${selector} .cart-upsell__item`).evaluateAll(cards => cards.map(card => card.dataset.upsellProduct));
  const waitMenuClosed = () => page.waitForSelector('#filtersPanel', { state: 'hidden' });
  const results = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    items = []; fullRequests = [];
    await page.goto('http://localhost:3000/tienda?categorySlug=chaquetas');
    await page.evaluate(() => window.CRONOX_catalogReady);
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    assert(fullRequests.length === 0, 'Direct filtered entry does not load a full store catalogue');
    for (const slug of ['chaquetas', 'camisetas', 'pantalones', 'drop-1', 'vacio', '', 'chaquetas']) {
      await page.locator('#btnMenu').click();
      await page.locator(`label.black-menu__category-row:has(input[value="${slug}"])`).click();
      await page.evaluate(() => window.CRONOX_catalogReady);
      assert(await page.locator('[data-store-category]:checked').count() === 1, 'Single navigation selection');
      if (slug === 'vacio') assert(await page.locator('#productsGrid .product-card').count() === 0 && await page.locator('#productsFallback').isVisible(), 'Empty category remains empty');
      await page.locator('.filters-close').click(); await waitMenuClosed();
      await page.locator('#cart-icon-btn').click();
      await page.waitForSelector('#cart-upsell-list .cart-upsell__add');
      await page.evaluate(() => window.CRONOX_FULL_CATALOG.load());
      assert(JSON.stringify(await keys('#cart-upsell-list')) === JSON.stringify(eligible), `Full recommendations for ${slug || 'Todos'}`);
      assert(await page.locator('[data-upsell-product="review-904"] .cart-upsell__last-units').count() === 1, 'Last units remain eligible');
      assert(JSON.stringify(fullRequests) === JSON.stringify([1, 2]), 'One shared full pagination load despite filter changes/reopening/Todos');
      await page.locator('#cart-close-btn').click();
    }
    await page.locator('#cart-icon-btn').click();
    await page.locator('[data-upsell-product="review-902"] .cart-upsell__add').click();
    await page.locator('#qaAdd').click();
    await page.waitForFunction(() => document.querySelector('.cart-qty__input')?.value === '1');
    await page.locator('#qaAdd').click();
    await page.waitForFunction(() => document.querySelector('.cart-qty__input')?.value === '2');
    await page.locator('.qa-close').click();
    assert((await page.locator('#cart-checkout-btn').textContent()).includes('70,00'), 'Other-category add updates quantities and total');
    assert(new URL(page.url()).searchParams.get('categorySlug') === 'chaquetas', 'Adding never changes navigation URL');
    await page.screenshot({ path: `output/playwright/independent-recommendations-${width}.png` });
    await page.locator('#cart-close-btn').click();
    assert((await page.locator('#productsGrid .product-name').allTextContents()).every(name => name.includes('chaquetas')), 'Store remains filtered after add');
    await page.locator('#btnMenu').click();
    assert(await page.locator('input[value="chaquetas"]').isChecked(), 'Active option remains highlighted');
    await page.locator('.filters-close').click(); await waitMenuClosed();
    items = []; fullRequests = [];
    await page.goto('http://localhost:3000/cesta?categorySlug=vacio');
    await page.waitForSelector('#cartMain .cart-upsell__add');
    assert(await page.locator('#filtersPanel, #btnMenu').count() === 0, 'Cart page has no filters or opener');
    assert(JSON.stringify(await keys('#cartMain')) === JSON.stringify(eligible), 'Cart page uses full catalogue despite URL filter');
    assert(JSON.stringify(fullRequests) === JSON.stringify([1, 2]), 'Cart and store module share one full load');
    await page.locator('#cartMain [data-upsell-product="review-902"] .cart-upsell__add').click();
    await page.locator('#qaAdd').click();
    await page.waitForFunction(() => document.querySelector('#sumSubtotal')?.textContent.includes('35,00'));
    await page.locator('.qa-close').click();
    assert(await page.locator('#cartMain .ci-qty').inputValue() === '1', 'Page recommendation updates page basket');
    await page.screenshot({ path: `output/playwright/cart-page-recommendations-${width}.png` });
    for (const route of ['/faqs', '/envios', '/devoluciones', '/desarrolla', '/eventos', '/privacidad', '/cookies', '/terminos', '/aviso-legal']) {
      items = []; fullRequests = [];
      await page.goto(`http://localhost:3000${route}?categorySlug=vacio`);
      await page.locator('#cart-icon-btn').click();
      await page.waitForSelector('#cart-upsell-list .cart-upsell__add');
      assert(JSON.stringify(await keys('#cart-upsell-list')) === JSON.stringify(eligible), `Footer full recommendations: ${route}`);
      assert(JSON.stringify(fullRequests) === JSON.stringify([1, 2]), 'Footer dependencies reuse full load');
      await page.locator('#cart-close-btn').click();
    }
    results.push({ width, categoriesDropsEmptyTodos: 'PASS', twoRequestsForEntireCatalogue: 'PASS', otherCategoryAdd: 'PASS', cartPageAndNineFooterPages: 'PASS' });
  }
  await page.unroute('**/api/products**'); await page.unroute('**/api/categories**'); await page.unroute('**/api/cart**');
  assert(errors.length === 0, 'JavaScript errors: ' + errors.join('; '));
  return { results, simulatedAdds: adds, savedWrites: 0, pageErrors: errors };
}
