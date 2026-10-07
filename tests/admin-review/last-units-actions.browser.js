// Generate via last-units-fixtures.cjs; run actions-private.js after browser-private.js.
async page => {
  const fixture = __FIXTURE__;
  const origin = 'http://127.0.0.1:3000';
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  assert(new URL(page.url()).hostname === '127.0.0.1', 'Local browser only');
  const item = label => fixture.products.find(p => p.label === label);
  const store = async () => {
    // Re-enter through a document navigation, even after a failed CLI run;
    // a same-URL hash navigation would retain an open drawer or modal.
    await page.goto(origin + '/?search=' + fixture.tag + '&qa-actions=' + Date.now() + '#store');
    await page.waitForFunction(count => document.querySelectorAll('#productsGrid .product-card').length === count, fixture.products.length);
    await page.waitForFunction(() => !document.getElementById('preloader') || getComputedStyle(document.getElementById('preloader')).opacity === '0');
  };
  const open = async label => {
    await page.locator('.product-card[data-slug="' + item(label).slug + '"] .fav-add').click();
    await page.waitForFunction(() => document.getElementById('quickAdd').getAttribute('aria-hidden') === 'false');
  };
  const waitlistRequests = [];
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/waitlist/')) waitlistRequests.push(r.method()); });
  await page.setViewportSize({ width: 1365, height: 900 });
  await store();
  // Native navigation to the existing alerts section, keeping the explicit size.
  await open('three-out');
  const choice = item('three-out').variants.find(v => v.stockQty === 0);
  await page.locator('#qaSizes [data-size="' + choice.size + '"]').click();
  await page.locator('#qaNotify').click();
  await page.waitForURL(url => url.pathname === '/producto/' + item('three-out').slug && url.hash === '#productWaitlist');
  await page.locator('#restockSize').waitFor();
  await page.waitForFunction(() => document.activeElement.id === 'restockSize');
  assert(await page.locator('#restockSize').inputValue() === String(choice.id), 'AVÍSAME changed the chosen size');
  assert(waitlistRequests.every(method => method === 'GET'), 'AVÍSAME subscribed without confirmation');
  await page.locator('#restockSize').selectOption(String(choice.id));
  await page.waitForFunction(() => document.querySelector('#productWaitlist .restock-status').textContent.includes('Confirma tu aviso'));
  const join = page.waitForResponse(r => new URL(r.url()).pathname === '/api/waitlist/' + choice.id && r.request().method() === 'POST');
  await page.locator('#productWaitlist button').click();
  const blocked = await join;
  assert(blocked.status() === 403 && (await blocked.json()).message === 'Operación deshabilitada en la revisión local de datos históricos.', 'Unexpected local alert response');
  await page.waitForFunction(() => document.querySelector('#productWaitlist .restock-status').textContent.includes('Operación deshabilitada'));
  await page.locator('#productWaitlist').screenshot({ path: 'output/playwright/last-units/desktop-alert-flow.png' });
  await store();
  await open('two-out');
  await page.locator('#qaLink').click();
  await page.waitForURL('**/producto/' + item('two-out').slug);
  assert(await page.locator('#pName').textContent() === fixture.tag + ' two-out', 'Message opened the wrong details');
  await store();
  // The schema forbids duplicate size rows. Exercise a duplicated local snapshot
  // in the real renderer, without writing invalid rows or changing real inventory.
  const duplicate = await page.evaluate(slug => {
    const p = window.CRONOX_PRODUCTS.find(p => p.slug === slug);
    const copy = { ...p, variants: [...p.variants, { ...p.variants[0] }, { ...p.variants[1] }], sizes: [...p.sizes, 'XXL'] };
    window.CRONOX_openQuickAdd(copy);
    return { count: window.CRONOX_STOCK.soldOutSizeCount(copy.variants), notify: document.getElementById('qaNotify').disabled,
      sizes: [...document.querySelectorAll('#qaSizes [data-size]')].map(el => el.dataset.size) };
  }, item('two-out').slug);
  assert(duplicate.count === 2 && duplicate.notify && !duplicate.sizes.includes('XXL'), 'Duplicate or foreign sizes changed the decision');
  await page.locator('.qa-close').click();
  for (const [surface, width, height] of [['desktop', 1365, 900], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await store();
    // Add a low-stock fixture through Quick Add and the real local cart API.
    const cart = await page.evaluate(() => window.CRONOX_CART.fetchCart());
    if (!cart.items.length) {
      await open('five');
      await page.locator('#qaSizes .qa-size-btn:not(.is-unavailable)').first().click();
      const add = page.waitForResponse(r => new URL(r.url()).pathname === '/api/cart/items' && r.request().method() === 'POST');
      await page.locator('#qaAdd').click();
      assert((await add).ok(), 'Scarce fixture could not be added to the cart');
      await page.waitForFunction(() => document.getElementById('qaCartStatus').textContent.includes('añadido'));
      await page.locator('.qa-close').click();
    }
    await page.locator('#cart-icon-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('.cart-line').length === 1);
    await page.waitForFunction(() => window.CRONOX_CART.state.status === 'populated' &&
      document.querySelector('[data-cart-delivery] strong').textContent === window.CRONOX_DELIVERY.estimateCart(window.CRONOX_CART.state.data));
    const result = await page.evaluate(() => {
      const warnings = [...document.querySelectorAll('.cart-upsell__last-units')];
      const recommendations = [...document.querySelectorAll('.cart-upsell__item')];
      return { rowText: [...document.querySelectorAll('.cart-line')].map(el => el.textContent).join(''),
        decorations: document.querySelectorAll('.cart-line .product-last-units, .cart-line .stock-status, .cart-upsell__media .product-last-units').length,
        warningCount: warnings.length,
        styles: warnings.map(el => ({ color: getComputedStyle(el).color, text: el.textContent, dots: el.querySelectorAll('.product-last-units__dot').length })),
        exhausted: recommendations.some(el => {
          const p = window.CRONOX_PRODUCTS.find(p => p.slug === el.dataset.upsellProduct);
          return window.CRONOX_STOCK.productStockStatus(p.variants, p.lastUnitsThreshold) === 'out_of_stock';
        }), delivery: document.querySelector('[data-cart-delivery] strong').textContent,
        expected: window.CRONOX_DELIVERY.estimateCart(window.CRONOX_CART.state.data) };
    });
    assert(!/Últimas unidades|Agotado/i.test(result.rowText) && !result.decorations, surface + ' decorative warning in cart/image');
    assert(result.warningCount > 0 && !result.exhausted && result.delivery === result.expected, surface + ' recommendation availability/shared delivery');
    assert(result.styles.every(s => s.color === 'rgb(217, 162, 27)' && s.text === ' · Últimas unidades' && s.dots === 0), surface + ' recommendation colour/text/dot');
    await page.locator('.cart-drawer__panel').screenshot({ path: 'output/playwright/last-units/' + surface + '-cart-recommendations.png' });
    const lowRecommendation = page.locator('.cart-upsell__item').filter({ has: page.locator('.cart-upsell__last-units') }).first();
    await lowRecommendation.locator('.cart-upsell__add').click();
    await page.waitForFunction(() => document.getElementById('quickAdd').getAttribute('aria-hidden') === 'false');
    await page.locator('#qaSizes .qa-size-btn:not(.is-unavailable)').first().click();
    assert(await page.locator('#qaAdd').isEnabled(), surface + ' scarce recommendation purchase disabled');
    const add = page.waitForResponse(r => new URL(r.url()).pathname === '/api/cart/items' && r.request().method() === 'POST');
    await page.locator('#qaAdd').click();
    assert((await add).ok(), surface + ' scarce recommendation could not be added');
    await page.waitForFunction(() => document.getElementById('qaCartStatus').textContent.includes('añadido'));
    await page.locator('.qa-close').click();
    assert(await page.locator('.cart-line').count() === 2, surface + ' cart did not retain scarce items');
    // Remove only the fixture added from recommendations; keep the first fixture.
    await page.locator('.cart-line').last().locator('.cart-line__remove').click();
    await page.waitForFunction(() => document.querySelectorAll('.cart-line').length === 1);
    await page.locator('#cart-close-btn').click();
    await open('three-out');
    await page.locator('#qaSizes [data-size="' + choice.size + '"]').click();
    await page.locator('#qaNotify').click();
    await page.locator('#restockSize').waitFor();
    assert(await page.locator('#restockSize').inputValue() === String(choice.id), surface + ' alert entry changed the chosen size');
    await page.locator('#productWaitlist').screenshot({ path: 'output/playwright/last-units/' + surface + '-alert-entry.png' });
  }
  // Existing identity checks still apply: guest must authenticate and then confirm.
  await page.evaluate(() => window.CRONOX_API.logout());
  await page.goto(origin + '/producto/' + item('three-out').slug + '#productWaitlist');
  await page.locator('#restockSize').selectOption(String(choice.id));
  await page.waitForFunction(() => document.querySelector('#productWaitlist button').textContent === 'Iniciar sesión o registrarme');
  await page.locator('#productWaitlist button').click();
  await page.waitForFunction(() => document.querySelector('.cronox-auth.is-open'));
  return { alertEntry: 'passed; explicit confirmation deliberately blocked by existing local safety middleware (HTTP 403)', explicitSize: 'passed', guestAuth: 'passed', duplicateSizes: 'passed', cartAndRecommendations: 'desktop/mobile passed' };
}
