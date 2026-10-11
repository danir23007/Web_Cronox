// Browser UI checks with an in-memory API cart; never changes the saved basket or stock.
async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  const products = [901, 902, 903].map((id, i) => ({ id, slug: `review-${id}`, name: `Review ${id}`,
    price: 3500 + i * 500, currency: 'EUR', isActive: true, imageUrl: '/favicon.png',
    images: [{ url: '/favicon.png', isPrimary: true }], sizeSystem: 'APPAREL',
    variants: [{ id: id + 100, size: 'M', stock: i === 2 ? 0 : 50, isActive: true }] }));
  let items = [], writes = 0;
  await page.route('**/api/products**', async route => {
    const slug = new URL(route.request().url()).pathname.split('/').pop();
    await route.fulfill({ json: products.find(product => product.slug === slug) || { items: products, meta: { pageCount: 1 } } });
  });
  await page.route('**/api/cart**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const { variantId, qty } = request.postDataJSON();
      const product = products.find(product => product.variants[0].id === variantId);
      assert(product && product.variants[0].stock > 0, 'Only available recommendation can be added');
      const existing = items.find(item => item.variantId === variantId);
      if (existing) existing.qty += qty;
      else items.push({ id: product.id, variantId, qty, priceAtAdd: product.price, variant: { ...product.variants[0], product } });
      writes++;
    }
    await route.fulfill({ json: { id: 900, items, itemsCount: items.reduce((sum, item) => sum + item.qty, 0),
      subtotal: items.reduce((sum, item) => sum + item.qty * item.priceAtAdd, 0) } });
  });
  const results = [];
  await page.goto('http://localhost:3000/tienda');
  const routes = await page.locator('#footer-panel-soporte a, #footer-panel-colabora a, #footer-panel-legal a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  assert(routes.length === 9, 'All nine real footer destinations');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    let reference;
    for (const route of ['/tienda', ...routes]) {
      items = [];
      await page.goto(`http://localhost:3000${route}`);
      const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
      if (await reject.isVisible()) await reject.click();
      await page.locator('#cart-icon-btn').click();
      await page.waitForSelector('.cart-upsell__add');
      const cards = await page.locator('.cart-upsell__item').evaluateAll(cards => cards.map(card => ({
        key: card.dataset.upsellProduct, name: card.querySelector('.cart-upsell__name').textContent,
        width: Math.round(card.getBoundingClientRect().width), font: getComputedStyle(card.querySelector('.cart-upsell__name')).font.split(',')[0],
      })));
      assert(cards.length === 2 && !cards.some(card => card.key === 'review-903'), 'Sold out recommendation excluded');
      if (!reference) reference = cards;
      assert(JSON.stringify(cards) === JSON.stringify(reference), `Same recommendations and geometry: ${route}/${width}`);
      assert(await page.locator('#cart-drawer #btnMenu, #cart-drawer .black-menu, #cart-drawer [data-open-filters]').count() === 0, 'No navigation inside basket');
      await page.locator('.cart-upsell__add').first().click();
      await page.waitForSelector('#quickAdd[aria-hidden="false"]');
      await page.locator('#qaAdd').click();
      await page.waitForFunction(() => document.querySelector('.cart-qty__input')?.value === '1');
      assert((await page.locator('#cart-checkout-btn').textContent()).includes('35,00'), 'Recommendation updates total');
      await page.locator('#qaAdd').click();
      await page.waitForFunction(() => document.querySelector('.cart-qty__input')?.value === '2');
      assert((await page.locator('#cart-checkout-btn').textContent()).includes('70,00'), 'Repeated add updates quantity and total');
      await page.locator('.qa-close').click();
      assert(await page.locator('.cart-upsell__item[data-upsell-product="review-901"]').count() === 0, 'Basket product excluded from recommendations');
      if (route === '/faqs') await page.screenshot({ path: `output/playwright/footer-recommendations-${width}.png` });
      await page.locator('#cart-close-btn').click();
      await page.locator('#cart-icon-btn').click();
      await page.locator('#cart-close-btn').click();
      await page.locator('#btnMenu').click();
      await page.waitForFunction(() => Math.abs(document.querySelector('#filtersPanel').getBoundingClientRect().left) < 1);
      await page.locator('.filters-close').click();
      await page.waitForSelector('#filtersPanel', { state: 'hidden' });
      await page.locator('#btnMenu').click();
      await page.locator('.filters-close').click();
      await page.waitForSelector('#filtersPanel', { state: 'hidden' });
      results.push({ width, route, recommendationsAddAndReopen: 'PASS' });
    }
    await page.setViewportSize({ width, height: 320 });
    await page.goto('http://localhost:3000/tienda');
    await page.evaluate(async () => {
      window.CRONOX_API.getAllCategories = async () => Array.from({ length: 40 }, (_, i) => ({
        name: `Opción ${i} extremadamente larga sin espacios ${'COLECCION'.repeat(12)}`, slug: `test-${i}`, group: 'GARMENT',
      }));
      await window.CRONOX_STORE_CATEGORIES.refresh();
    });
    await page.locator('#btnMenu').click();
    await page.waitForFunction(() => Math.abs(document.querySelector('#filtersPanel').getBoundingClientRect().left) < 1);
    await page.locator('.black-menu__brand').evaluate(logo => logo.decode());
    for (const position of ['start', 'end']) {
      if (position === 'end') await page.locator('.black-menu__link').last().scrollIntoViewIfNeeded();
      await page.locator('.black-menu__link')[position === 'end' ? 'last' : 'first']().hover({ force: true });
      const geometry = await page.evaluate(() => {
        const panel = document.querySelector('#filtersPanel'), list = panel.querySelector('.black-menu__list');
        list.scrollLeft = 100;
        const logo = panel.querySelector('img').getBoundingClientRect(), close = panel.querySelector('.filters-close'), rect = close.getBoundingClientRect();
        return { panelWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth, listWidth: list.clientWidth,
          listScrollWidth: list.scrollWidth, horizontalScroll: list.scrollLeft, verticalScroll: list.scrollTop,
          logoTop: logo.top, logoBottom: logo.bottom, closeHit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === close };
      });
      assert(geometry.panelScrollWidth === geometry.panelWidth && geometry.listWidth === geometry.listScrollWidth && geometry.horizontalScroll === 0, 'No horizontal overflow: ' + JSON.stringify(geometry));
      assert(geometry.logoTop >= 0 && geometry.logoBottom < 320 && geometry.closeHit, 'Header remains visible and accessible');
      if (position === 'end') assert(geometry.verticalScroll > 0, 'Long list scrolls vertically to last option');
    }
    await page.screenshot({ path: `output/playwright/menu-long-list-${width}.png` });
    await page.locator('.filters-close').click();
    await page.waitForSelector('#filtersPanel', { state: 'hidden' });
  }
  await page.unroute('**/api/cart**');
  await page.unroute('**/api/products**');
  assert(errors.length === 0, 'Page errors: ' + errors.join('; '));
  return { results, longListsAndHorizontalOverflow: 'PASS', simulatedAdds: writes, savedCartWrites: 0, pageErrors: errors };
}
