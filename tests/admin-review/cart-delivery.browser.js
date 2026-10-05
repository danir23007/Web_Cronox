// Local anonymous cart only. Never visits checkout, creates orders or reserves inventory.
async page => {
  if (new URL(page.url()).origin !== 'http://localhost:3000') throw Error('Local storefront required');
  const cookies = await page.context().cookies();
  if (cookies.some(cookie => ['jwt', 'refresh_token'].includes(cookie.name))) throw Error('Use a fresh anonymous browser');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  const catalog = await page.evaluate(async () => {
    const data = await (await fetch('/api/products?limit=48')).json();
    return data.items || data;
  });
  const stock = products => products.flatMap(product => product.variants.map(variant => [variant.id, variant.stockQty]));
  const beforeStock = JSON.stringify(stock(catalog));
  const selected = catalog.map(product => ({ product, variant: product.variants.find(variant => variant.isActive !== false && variant.stockQty >= 2) }))
    .filter(item => item.variant).slice(0, 2);
  assert(selected.length === 2, 'Two distinct in-stock products required');
  const results = [];
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('http://localhost:3000/tienda');
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    await page.evaluate(async () => {
      const cart = await window.CRONOX_CART.fetchCart();
      if (cart.items.length) throw Error('Initial cart is not empty; refusing to change an existing cart');
    });
    await page.evaluate(async variantId => window.CRONOX_CART.addCartItem({ variantId, qty: 1 }), selected[0].variant.id);
    await page.locator('#cart-icon-btn').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#cart-drawer')).transform === 'matrix(1, 0, 0, 1, 0, 0)');
    const notice = page.locator('[data-cart-delivery]');
    await notice.waitFor({ state: 'visible' });
    const expected = await page.evaluate(() => window.CRONOX_DELIVERY.estimateProduct());
    assert(await notice.locator('[data-delivery-date]').textContent() === expected, 'Same calendar as PDP');
    assert(await notice.count() === 1, 'Only one order estimate');
    const borders = await page.evaluate(() => ({
      last: getComputedStyle(document.querySelector('#cart-items-container .cart-line:last-of-type')).borderBottomWidth,
      items: getComputedStyle(document.querySelector('#cart-items-container')).borderBottomWidth,
      noticeInsideLast: document.querySelector('#cart-items-container').lastElementChild.matches('[data-cart-delivery]'),
      upsell: getComputedStyle(document.querySelector('#cart-upsell-section')).borderTopWidth,
      dot: getComputedStyle(document.querySelector('[data-cart-delivery] .pdp__delivery-dot')).backgroundColor,
    }));
    assert(borders.last === '0px' && borders.items === '1px' && borders.noticeInsideLast && borders.upsell === '0px', 'Delivery inside items, followed by exactly one separator: ' + JSON.stringify(borders));
    assert(borders.dot === 'rgb(105, 189, 145)', 'Shared green dot');
    await page.evaluate(async variantId => window.CRONOX_CART.addCartItem({ variantId, qty: 1 }), selected[1].variant.id);
    await page.evaluate(async () => {
      const first = window.CRONOX_CART.state.data.items[0];
      await window.CRONOX_CART.updateCartItem(first.id, 2);
    });
    assert(await notice.locator('[data-delivery-date]').textContent() === expected, 'Whole order after quantity update');
    assert(await notice.evaluate(el => el.getBoundingClientRect().right <= innerWidth), 'Delivery remains within the viewport');
    await page.screenshot({ path: `output/playwright/cart-delivery-2026-10-05/cart-${width}.png` });
    await page.locator('#cart-close-btn').click();
    await page.locator('#cart-icon-btn').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#cart-drawer')).transform === 'matrix(1, 0, 0, 1, 0, 0)');
    await notice.waitFor({ state: 'visible' });
    assert(await notice.count() === 1, 'Reopening does not duplicate estimate');
    await page.evaluate(async () => {
      const ids = window.CRONOX_CART.state.data.items.map(item => item.id);
      await window.CRONOX_CART.removeCartItem(ids[0]);
    });
    assert(await notice.isVisible(), 'Estimate remains for remaining item');
    await page.evaluate(async () => window.CRONOX_CART.removeCartItem(window.CRONOX_CART.state.data.items[0].id));
    assert(!await notice.isVisible(), 'Empty cart has no estimate');
    await page.locator('#cart-close-btn').click();
    results.push({ width, oneAndMultipleItems: 'PASS', quantityRemovalReopening: 'PASS', separator: 'one' });
  }
  const afterStock = await page.evaluate(async () => {
    const data = await (await fetch('/api/products?limit=48')).json();
    return (data.items || data).flatMap(product => product.variants.map(variant => [variant.id, variant.stockQty]));
  });
  assert(JSON.stringify(afterStock) === beforeStock, 'Inventory unchanged');
  return { results, inventoryUnchanged: true, checkoutRequests: 0, emptyAtEnd: true };
}
