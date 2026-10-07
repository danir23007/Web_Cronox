// Generate with last-units-fixtures.cjs, then run through playwright-cli run-code.
async page => {
  const fixture = __FIXTURE__;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = 'http://127.0.0.1:3000';
  assert(new URL(page.url()).hostname === '127.0.0.1', 'Local browser only');
  const wait = (fn, arg) => page.waitForFunction(fn, arg);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.locator('#adminLoginEmail').fill(fixture.actor.email);
  await page.locator('#adminLoginPassword').fill(fixture.actor.password);
  await page.locator('#adminLoginSubmit').click();
  await page.waitForURL('**/admin.html');
  await page.goto(origin + '/admin.html#section-products');
  await page.locator('#productSearch').fill(fixture.tag);
  await wait(count => document.querySelectorAll('#productsBody [data-edit-product]').length === count, fixture.products.length);
  const product = fixture.products.find(p => p.label === 'five');
  const edit = async () => {
    await page.locator('[data-edit-product="' + product.id + '"]').click();
    await wait(() => document.getElementById('productModal').classList.contains('show'));
  };
  const save = async () => {
    const response = page.waitForResponse(r => r.url().endsWith('/api/admin/products/' + product.id) && r.request().method() === 'PATCH');
    await page.locator('#productSubmitBtn').click();
    const saved = await response;
    assert(saved.status() === 200, 'Editor save failed: ' + await saved.text());
    await wait(() => !document.getElementById('productModal').classList.contains('show'));
  };
  await edit();
  assert(await page.locator('#productLastUnits').inputValue() === '5', 'Persisted threshold missing');
  for (const invalid of ['-1', '1.5']) {
    await page.locator('#productLastUnits').fill(invalid);
    await page.locator('#productSubmitBtn').click();
    assert(await page.locator('#productLastUnits').evaluate(input => !input.validity.valid), 'Frontend accepted ' + invalid);
    assert(await page.locator('#productModal').evaluate(modal => modal.classList.contains('show')), 'Invalid edit closed');
  }
  await page.locator('#productLastUnits').fill('4');
  await save(); await edit();
  assert(await page.locator('#productLastUnits').inputValue() === '4', 'Threshold save/reopen failed');
  await page.locator('#productLastUnits').fill('');
  await save(); await edit();
  assert(await page.locator('#productLastUnits').inputValue() === '', 'Clearing threshold failed');
  await page.locator('#productLastUnits').fill('0');
  await save(); await edit();
  assert(await page.locator('#productLastUnits').inputValue() === '0', 'Zero lost on reopen');
  await page.locator('#productLastUnits').fill('5'); await save();
  const rejected = await page.evaluate(async id => {
    const results = [];
    for (const value of [-1, 1.5, '5', '', false, 2147483648]) {
      try { await window.CRONOX_API.admin.updateAdminProduct(id, { lastUnitsThreshold: value }); results.push('accepted'); }
      catch (error) { results.push(error.status); }
    }
    return results;
  }, product.id);
  assert(rejected.every(status => status === 400), 'Backend invalid values: ' + rejected);
  await page.reload();
  await page.locator('#productSearch').fill(fixture.tag);
  await wait(count => document.querySelectorAll('#productsBody [data-edit-product]').length === count, fixture.products.length);
  await edit();
  assert(await page.locator('#productLastUnits').inputValue() === '5', 'Persisted threshold after reload failed');
  await page.locator('#productCancelBtn').click();
  const publicData = await page.request.get(origin + '/api/products?search=' + fixture.tag + '&limit=100');
  const publicBody = await publicData.json();
  assert(publicData.headers()['cache-control'] === 'no-store', 'Catalog caching');
  assert(publicBody.items.length === fixture.products.length, 'Catalog fixture count');
  assert(publicBody.items.every(p => !('privateCost' in p) && !('unitCostCents' in p) && !('searchKeywords' in p)), 'Private data exposed');
  const favoriteResponse = await page.request.get(origin + '/api/favorites');
  assert((await favoriteResponse.json())[0].product.lastUnitsThreshold === 5, 'Favorite threshold missing');
  await page.goto(origin + '/index.html?search=' + fixture.tag + '#store');
  await wait(count => document.querySelectorAll('#productsGrid .product-card').length === count, fixture.products.length);
  await wait(() => !document.getElementById('preloader') || getComputedStyle(document.getElementById('preloader')).opacity === '0');
  const rejectCookies = page.getByRole('button', { name: /^rechazar$/i });
  if (await rejectCookies.isVisible()) await rejectCookies.click();
  const badge = label => page.locator('.product-card[data-slug="' + fixture.products.find(p => p.label === label).slug + '"] .product-last-units');
  const verifyQuickAdd = async surface => {
    for (const item of fixture.products) {
      const status = await page.evaluate(slug => {
        const p = window.CRONOX_PRODUCTS.find(p => p.slug === slug);
        return window.CRONOX_STOCK.productStockStatus(p.variants, p.lastUnitsThreshold);
      }, item.slug);
      const out = status === 'out_of_stock', low = status === 'low';
      const expected = out ? 'Agotado' : low ? 'Últimas unidades' : '';
      const card = page.locator('#productsGrid .product-card[data-slug="' + item.slug + '"]');
      await card.locator('.fav-add').click();
      await wait(() => document.getElementById('quickAdd').getAttribute('aria-hidden') === 'false');
      const warning = page.locator('#qaPrice').locator('..').locator('.stock-status');
      assert((await warning.count() ? await warning.textContent() : '') === expected, surface + ' Quick Add warning: ' + item.label);
      assert(await page.locator('#qaSizes [aria-checked="true"]').count() === 1, surface + ' initial selected size: ' + item.label);
      assert(await page.locator('#qaAdd').isDisabled() === out && await page.locator('#qaAdd').isVisible() === !out && await page.locator('#qaNotify').isDisabled() === !out, surface + ' initial actions: ' + item.label);
      const variants = await page.evaluate(slug => window.CRONOX_PRODUCTS.find(p => p.slug === slug).variants, item.slug);
      const sizes = [...new Set(variants.filter(v => v.isActive !== false).map(v => v.size.toUpperCase()))];
      const exhausted = sizes.filter(size => !variants.some(v => v.size.toUpperCase() === size && v.isActive !== false && v.isAvailable !== false && (v.stockQty ?? v.stock) > 0)).length;
      await page.locator(out ? '#qaSizes .qa-size-btn' : '#qaSizes .qa-size-btn:not(.is-unavailable)').first().click();
      assert(await page.locator('#qaAdd').isDisabled() === out && await page.locator('#qaNotify').isDisabled() === !out, surface + ' selected-size action: ' + item.label);
      assert(await page.locator('#qaNotify').isVisible() === (exhausted > 0 || out), surface + ' AVÍSAME visibility: ' + item.label);
      assert(await page.locator('#qaLink').textContent() === 'Ver detalles del producto', surface + ' footer message: ' + item.label);
      const date = await page.locator('#qaDelivery').evaluate(notice => ({
        hidden: notice.hidden, text: notice.querySelector('strong').textContent,
        expected: window.CRONOX_DELIVERY.estimateCart({ items: [{ qty: 1 }] }),
        corner: notice.classList.contains('qa-delivery--corner'), parent: notice.parentElement.className,
      }));
      assert(date.hidden === out && (out || date.text === date.expected), surface + ' shared estimate: ' + item.label);
      assert(date.corner && date.parent === 'qa-footer', surface + ' delivery position: ' + item.label);
      if (!out) {
        await page.locator('#qaDelivery').scrollIntoViewIfNeeded();
        const overlap = await page.locator('#qaDelivery').evaluate(notice => {
          const a = notice.getBoundingClientRect();
          return [...document.querySelectorAll('#qaAdd, #qaNotify:not([hidden]), #qaLink')].some(el => {
            const b = el.getBoundingClientRect();
            return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          });
        });
        assert(!overlap, surface + ' delivery overlaps controls: ' + item.label);
      }
      if (expected) {
        const result = await warning.evaluate(element => ({
          color: getComputedStyle(element).color,
          font: getComputedStyle(element).fontSize,
          dotColor: element.firstElementChild ? getComputedStyle(element.firstElementChild).backgroundColor : null,
          animation: element.firstElementChild ? getComputedStyle(element.firstElementChild).animationName : null,
          inline: element.parentElement.contains(document.getElementById('qaPrice')) && element.parentElement.classList.contains('stock-price-row'),
          dots: element.querySelectorAll('.product-last-units__dot').length,
        }));
        assert(result.color === (out ? 'rgb(255, 100, 100)' : 'rgb(217, 162, 27)'), 'Exact original Quick Add colours: ' + item.label);
        assert(result.inline && result.font === '12px' && result.dots === (out ? 0 : 1), 'Inline size/dot: ' + item.label);
        assert(out || (result.dotColor === 'rgb(255, 100, 100)' && result.animation === 'none'), 'Fixed red low-stock dot: ' + item.label);
      }
      if (item.label === 'one') {
        await page.locator('#qaSizes .qa-size-btn:not(.is-unavailable)').first().click();
        assert(await page.locator('#qaAdd').isEnabled(), 'One sellable size cannot exhaust the product');
      }
      if (['five', 'empty'].includes(item.label)) await page.screenshot({ path: 'output/playwright/last-units/' + surface + '-quick-add-' + (out ? 'out' : 'low') + '.png' });
      if (['one-out', 'three-out', 'four-out'].includes(item.label)) await page.screenshot({ path: 'output/playwright/last-units/' + surface + '-quick-add-' + item.label + '.png' });
      await page.locator('.qa-close').click();
    }
  };
  const captureCards = async (surface, width, height) => {
    const viewport = page.viewportSize();
    // Fit the complete grid for export; keep the fixed toolbar above the crop.
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, Math.max(0, document.getElementById('productsGrid').getBoundingClientRect().top + window.scrollY - 90)));
    await page.locator('#productsGrid').screenshot({ path: 'output/playwright/last-units/' + surface + '-cards.png' });
    await page.setViewportSize(viewport);
  };
  for (const label of ['five', 'one', 'inactive']) assert(await badge(label).count() === 1, 'Missing badge: ' + label);
  for (const label of ['six', 'disabled', 'zero']) assert(await badge(label).count() === 0, 'Unexpected badge: ' + label);
  for (const label of ['empty', 'disabled-empty', 'zero-empty']) assert(await badge(label).textContent() === 'AGOTADO', 'Missing real-stock exhaustion: ' + label);
  for (const label of ['empty', 'disabled-empty', 'zero-empty']) {
    assert(await badge(label).evaluate(element => getComputedStyle(element).color) === 'rgb(255, 100, 100)', 'Original card exhausted red: ' + label);
    assert(await badge(label).locator('.product-last-units__dot').count() === 0, 'Exhausted card has a dot: ' + label);
  }
  assert(await page.locator('#productsGrid .product-card__price-row .product-last-units, #productsGrid .product-card__stock-label, #productsGrid .product-card__price-row .stock-status').count() === 0, 'Warning remains below card price');
  const fiveCard = page.locator('.product-card[data-slug="' + product.slug + '"]');
  await fiveCard.scrollIntoViewIfNeeded();
  const styles = await badge('five').evaluate(element => {
    const css = getComputedStyle(element), dot = getComputedStyle(element.firstElementChild);
    return { color: css.color, font: css.fontSize, pointerEvents: css.pointerEvents, dotColor: dot.backgroundColor, dotAnimation: dot.animationName,
      background: css.backgroundColor, border: css.borderTopWidth, shadow: css.boxShadow };
  });
  assert(styles.pointerEvents === 'none' && styles.dotAnimation === 'none', 'Badge intercepts interactions or blinks');
  assert(styles.font === '11px', 'Card warning size');
  assert(styles.color === 'rgb(217, 162, 27)' && styles.dotColor === 'rgb(255, 100, 100)', 'Original warning colours changed');
  assert(styles.background === 'rgba(0, 0, 0, 0)' && styles.border === '0px' && styles.shadow === 'none', 'Card warning has a box');
  await verifyQuickAdd('desktop');
  await captureCards('desktop', 1365, 1400);
  await fiveCard.hover();
  assert(await fiveCard.locator('.product-images').getAttribute('data-active-index') === '1', 'Hover broken');
  await fiveCard.locator('.product-arrow.next').click();
  await fiveCard.locator('.fav-add').click();
  await wait(() => document.getElementById('quickAdd').getAttribute('aria-hidden') === 'false');
  assert((await page.locator('#qaName').textContent()) === fixture.tag + ' five', 'Quick Add product mismatch');
  await page.locator('.qa-close').click();
  await page.screenshot({ path: 'output/playwright/last-units/desktop.png', fullPage: true });
  // Fresh availability/threshold values replace the current catalog, without per-card reads.
  await page.evaluate(async id => window.CRONOX_API.admin.updateAdminProduct(id, { lastUnitsThreshold: 4 }), product.id);
  await page.evaluate(() => window.CRONOX_reloadCatalog());
  assert(await badge('five').count() === 0, 'Threshold change left stale badge');
  const variants = product.variants.map(v => ({ size: v.size, stockQty: v.size === 'S' ? 1 : 0 }));
  await page.evaluate(async ({ id, variants }) => window.CRONOX_API.admin.updateAdminProduct(id, { variants }), { id: product.id, variants });
  await page.evaluate(() => window.CRONOX_reloadCatalog());
  assert(await badge('five').count() === 1, 'Stock change left stale badge');
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.reload();
  await wait(count => document.querySelectorAll('#productsGrid .product-card').length === count, fixture.products.length);
  await wait(() => !document.getElementById('preloader') || getComputedStyle(document.getElementById('preloader')).opacity === '0');
  await fiveCard.scrollIntoViewIfNeeded();
  const overlap = await fiveCard.evaluate(card => {
    const badge = card.querySelector('.product-last-units').getBoundingClientRect();
    const media = card.querySelector('.product-media').getBoundingClientRect();
    const controls = [...card.querySelectorAll('.favorite-toggle, .fav-add')].map(el => el.getBoundingClientRect());
    const intersects = box => badge.left < box.right && badge.right > box.left && badge.top < box.bottom && badge.bottom > box.top;
    return badge.left < media.left || badge.right > media.right || controls.some(intersects);
  });
  assert(!overlap, 'Mobile badge overlaps controls/image boundary');
  const gallery = fiveCard.locator('.product-images');
  const box = await gallery.boundingBox();
  const beforeSwipe = await gallery.getAttribute('data-active-index');
  const touch = { x: box.x + box.width * .8, y: box.y + box.height * .35 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x - box.width * .6, y: touch.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(await gallery.getAttribute('data-active-index') !== beforeSwipe, 'Touch swipe broken');
  await fiveCard.locator('.fav-add').click();
  await wait(() => document.getElementById('quickAdd').getAttribute('aria-hidden') === 'false');
  await page.locator('.qa-close').click();
  await verifyQuickAdd('mobile');
  await captureCards('mobile', 390, 4000);
  await page.screenshot({ path: 'output/playwright/last-units/mobile.png', fullPage: true });
  await page.goto(origin + '/favorites.html');
  await wait(() => document.querySelector('#favorites-grid .product-last-units'));
  assert(await page.locator('#favorites-grid .product-last-units').count() === 1, 'Favorites shared card badge');
  return { desktop: 'passed', mobile: 'passed', persistence: 'passed', frontendValidation: 'passed', httpInvalid: rejected, publicFields: 'passed', freshStockAndThreshold: 'passed' };
}
