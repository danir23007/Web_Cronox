// Normal localhost pages with an in-memory cart response: no saved cart or stock changes.
async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  const product = (id, price) => ({ id, slug: `review-${id}`, name: `Review ${id}`, price, currency: 'EUR',
    imageUrl: '/favicon.png', images: [{ url: '/favicon.png', isPrimary: true }],
    variants: [{ id: id + 100, size: 'M', stock: 50, isActive: true }] });
  const products = [product(901, 3500), product(902, 2500)];
  const reset = () => products.map(product => ({ id: product.id, variantId: product.variants[0].id,
    qty: 1, priceAtAdd: product.price, variant: { ...product.variants[0], product } }));
  let items = reset();
  await page.route('**/api/cart**', async route => {
    const request = route.request(), url = new URL(request.url());
    const id = Number(url.pathname.split('/').pop());
    if (request.method() === 'PATCH') items.find(item => item.id === id).qty = request.postDataJSON().qty;
    if (request.method() === 'DELETE') items = items.filter(item => item.id !== id);
    await route.fulfill({ json: { id: 900, items, itemsCount: items.reduce((sum, item) => sum + item.qty, 0),
      subtotal: items.reduce((sum, item) => sum + item.qty * item.priceAtAdd, 0) } });
  });
  const amount = async selector => Number((await page.locator(selector).textContent()).replace(/[^0-9,]/g, '').replace(',', '.'));
  const results = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    items = reset();
    await page.goto('http://localhost:3000/cesta');
    await page.waitForSelector('.ci-qty');
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    assert(await page.locator('#filtersPanel, #btnMenu, [data-open-filters]').count() === 0, 'Cart page has no navigation menu or trigger');
    assert(await amount('#sumSubtotal') === 60 && await amount('#sumTotal') === 62.95, 'Initial page totals');
    await page.locator('.ci-qty[data-id="901"]').fill('2');
    await page.locator('.ci-qty[data-id="901"]').press('Tab');
    await page.waitForFunction(() => document.querySelector('#sumSubtotal').textContent.includes('95,00'));
    assert(await amount('#sumTotal') === 95, 'Quantity recalculates page totals and free shipping');
    await page.locator('.ci-remove[data-id="902"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.ci-qty').length === 1);
    assert(await amount('#sumSubtotal') === 70 && await amount('#sumTotal') === 70, 'Removal updates page totals');
    await page.screenshot({ path: `output/playwright/cart-scope-page-${width}.png` });
    await page.locator('#btnCheckout').click();
    await page.waitForURL('**/checkout');
    items = reset();
    await page.goto('http://localhost:3000/tienda');
    await page.evaluate(() => window.CRONOX_catalogReady);
    await page.locator('#cart-icon-btn').click();
    await page.waitForSelector('.cart-qty__input');
    assert(await page.locator('#cart-drawer [data-open-filters], #cart-drawer #btnMenu, #cart-drawer .black-menu').count() === 0, 'No navigation added to drawer');
    assert(await page.locator('#filtersPanel').count() === 1, 'Store keeps its background menu');
    assert(await amount('#cart-checkout-btn') === 60, 'Drawer initial subtotal');
    await page.locator('.cart-qty__btn[data-id="901"][data-action="inc"]').click();
    await page.waitForFunction(() => document.querySelector('.cart-qty__input[data-id="901"]').value === '2');
    assert(await amount('#cart-checkout-btn') === 95, 'Drawer quantity and total');
    await page.locator('.cart-line__remove[data-remove="902"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#cart-items-container .cart-line').length === 1);
    assert(await amount('#cart-checkout-btn') === 70, 'Drawer removal and total');
    await page.screenshot({ path: `output/playwright/cart-scope-drawer-${width}.png` });
    await page.locator('#cart-checkout-btn').click();
    await page.waitForURL('**/checkout');
    for (const route of ['/tienda', '/producto/ashen-shell']) {
      await page.goto(`http://localhost:3000${route}`);
      await page.locator('#btnMenu').click();
      await page.waitForFunction(() => Math.abs(document.querySelector('#filtersPanel').getBoundingClientRect().left) < 1);
      await page.locator('.black-menu__brand').evaluate(logo => logo.decode());
      await page.locator('.filters-close').click();
      await page.waitForSelector('#filtersPanel', { state: 'hidden' });
      await page.locator('#cart-icon-btn').click();
      await page.waitForSelector('#cart-drawer.is-visible');
      assert(await page.locator('#cart-drawer [data-open-filters], #cart-drawer .black-menu').count() === 0, 'Drawer stays cart-only');
      await page.locator('#cart-close-btn').click();
      await page.locator('#btnMenu').click();
      await page.locator('.filters-close').click();
      await page.waitForSelector('#filtersPanel', { state: 'hidden' });
    }
    results.push({ width, cartPageWithoutMenu: 'PASS', drawerWithoutMenu: 'PASS', quantitiesRemovalTotalsCheckout: 'PASS', storeAndProductMenu: 'PASS' });
  }
  await page.unroute('**/api/cart**');
  assert(errors.length === 0, 'Page errors: ' + errors.join('; '));
  return { results, pageErrors: errors, savedCartWrites: 0 };
}
