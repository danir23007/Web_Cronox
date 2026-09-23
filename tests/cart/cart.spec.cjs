const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  page.cartErrors = [];
  page.cartConsole = [];
  page.on('pageerror', error => page.cartErrors.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) page.cartConsole.push(message.text());
  });
});
test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach('console', { body: JSON.stringify(page.cartConsole || [], null, 2), contentType: 'application/json' });
  expect(page.cartErrors || []).toEqual([]);
});

const products = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, slug: `test-tee-${i + 1}`, name: i === 0 ? 'Camiseta CRONOX con un nombre de producto muy largo edición especial' : `TEST TEE ${i + 1}`,
  price: 3500, currency: 'EUR', imageUrl: '/assets/logo_banner.png',
  images: [{ url: '/assets/logo_banner.png', isPrimary: true }],
  variants: [{ id: 101 + i, size: i % 2 ? 'XL' : 'M', stock: 50, isActive: true }],
}));
const cartWith = (count) => ({ id: 1, items: products.slice(0, count).map((product, i) => ({
  id: i + 1, variantId: product.variants[0].id, qty: 1, priceAtAdd: product.price,
  variant: { ...product.variants[0], product },
})) });
const totals = (cart) => ({ ...cart, itemsCount: cart.items.reduce((n, i) => n + i.qty, 0), subtotal: cart.items.reduce((n, i) => n + i.qty * i.priceAtAdd, 0) });

async function fixture(page, count = 2) {
  const state = { cart: cartWith(count), signedIn: false, delay: 0, fail: false, failWrite: false, malformed: false, reads: 0, writes: 0 };
  await page.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    sessionStorage.setItem('cronox_newsletter_seen', '1');
    document.cookie = 'cronox_cookie_consent=' + encodeURIComponent(JSON.stringify({ necessary: true, preferences: false, analytics: false, marketing: false, consentVersion: '2', timestamp: new Date().toISOString() })) + '; path=/';
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let data = {};
    if (url.pathname === '/api/auth/csrf') data = { csrfToken: 'local-cart-fixture' };
    else if (url.pathname === '/api/me') data = state.signedIn ? { id: 1, email: 'fixture@example.test', role: 'USER' } : null;
    else if (url.pathname === '/api/auth/login') {
      state.signedIn = true;
      state.cart = cartWith(3);
      data = { user: { id: 1, email: 'fixture@example.test', role: 'USER' } };
    }
    else if (url.pathname === '/api/auth/logout') { state.signedIn = false; data = { ok: true }; }
    else if (url.pathname === '/api/products') data = { items: products, meta: { total: products.length } };
    else if (url.pathname.startsWith('/api/products/')) data = products.find(p => url.pathname.endsWith(p.slug)) || products[0];
    else if (url.pathname === '/api/favorites') data = [];
    else if (url.pathname.startsWith('/api/cart')) {
      if (request.method() === 'GET') {
        state.reads++;
        const snapshot = structuredClone(totals(state.cart));
        if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
        if (state.fail) return route.fulfill({ status: 503, json: { message: 'Fixture unavailable' } });
        if (state.malformed) return route.fulfill({ json: {} });
        return route.fulfill({ json: snapshot });
      }
      state.writes++;
      if (state.failWrite) return route.fulfill({ status: 503, json: { message: 'Fixture unavailable' } });
      const body = request.postDataJSON();
      const id = Number(url.pathname.split('/').pop());
      if (request.method() === 'POST') {
        const product = products.find(p => p.variants[0].id === body.variantId);
        const existing = state.cart.items.find(i => i.variantId === body.variantId);
        if (existing) existing.qty += body.qty;
        else state.cart.items.push({ id: product.id, variantId: body.variantId, qty: body.qty, priceAtAdd: product.price, variant: { ...product.variants[0], product } });
      } else if (request.method() === 'PATCH') state.cart.items.find(i => i.id === id).qty = body.qty;
      else state.cart.items = Number.isFinite(id) ? state.cart.items.filter(i => i.id !== id) : [];
      data = totals(state.cart);
    }
    return route.fulfill({ json: data });
  });
  return state;
}

async function open(page) {
  await page.locator('#cart-icon-btn').click();
  await expect(page.locator('#cart-drawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#cart-items-container .cart-line').first()).toBeVisible();
  await page.waitForTimeout(350); // Drawer's CSS transition only.
}

test('first opening keeps purchased rows visible with six recommendations on a short desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 600 });
  await fixture(page);
  await page.goto('/');
  await open(page);
  await expect(page.locator('.cart-upsell__item')).toHaveCount(6);
  const bounds = await page.locator('#cart-items-container').evaluate(el => ({ height: el.getBoundingClientRect().height, overflow: getComputedStyle(el).overflowY }));
  expect(bounds.height).toBeGreaterThan(120);
  await expect(page.locator('#cart-items-container .cart-line').first()).toBeInViewport();
  await expect(page.locator('#cart-checkout-btn')).toBeInViewport();
});

test('a slow initial read cannot replace a newer add response', async ({ page }) => {
  const state = await fixture(page, 1);
  state.delay = 700;
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.CRONOX_CART);
  await page.evaluate(() => window.CRONOX_CART.addCartItem({ variantId: 102, qty: 1 }));
  await page.waitForTimeout(850);
  expect(await page.evaluate(() => window.CRONOX_CART.state.data.itemsCount)).toBe(2);
});

test('first opening shares the pending initial request and visibly loads existing items', async ({ page }) => {
  const state = await fixture(page, 2);
  state.delay = 1500;
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#cart-icon-btn').click();
  await expect(page.locator('#cart-drawer .cart-status')).toContainText('Cargando cesta');
  await expect(page.locator('#cart-empty-state')).toHaveCount(0);
  await expect(page.locator('.cart-line')).toHaveCount(2);
  expect(state.reads).toBe(1);
});

test('restored pages refresh the cart without requiring resize or an add', async ({ page }) => {
  const state = await fixture(page, 1);
  await page.goto('/');
  await open(page);
  state.cart = cartWith(3);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.cart-line')).toHaveCount(3);
  await expect(page.locator('#cart-checkout-btn')).toContainText('105,00');
});

test('touch mobile viewport adapts to a shorter visible viewport and landscape', async ({ browser, browserName }, testInfo) => {
  test.skip(browserName === 'firefox', 'Playwright does not support isMobile in Firefox');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  await fixture(page, 3);
  await page.goto('http://127.0.0.1:4173/');
  await open(page);
  for (const viewport of [{ width: 390, height: 600 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#cart-close-btn')).toBeInViewport();
    await expect(page.locator('#cart-checkout-btn')).toBeInViewport();
    await expect(page.locator('.cart-line').first()).toBeInViewport();
  }
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  await page.screenshot({ path: testInfo.outputPath('touch-landscape.png') });
  await context.close();
});

for (const [width, height] of [[320,568], [375,667], [390,844], [430,932], [768,1024], [1024,768], [1366,600], [1920,1080], [844,390], [568,320]]) {
  test(`drawer layout ${width}x${height}: empty, one, many, reopen and rotate`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const state = await fixture(page, 0);
    await page.goto('/');
    await page.locator('#cart-icon-btn').click();
    await expect(page.locator('#cart-empty-state')).toBeVisible();
    await expect(page.locator('#cart-checkout-btn')).toBeHidden();
    for (const count of [1, 7]) {
      state.cart = cartWith(count);
      await page.locator('#cart-close-btn').click();
      await open(page);
      await expect(page.locator('.cart-line')).toHaveCount(count);
      await expect(page.locator('#cart-close-btn')).toBeInViewport();
      await expect(page.locator('#cart-checkout-btn')).toBeInViewport();
      const geometry = await page.locator('.cart-drawer__panel').evaluate(el => {
        const rows = document.querySelector('#cart-items-container');
        const rect = el.getBoundingClientRect();
        return { horizontalOverflow: el.scrollWidth - el.clientWidth, top: rect.top, bottom: rect.bottom, viewport: innerHeight, rowsOverflow: getComputedStyle(rows).overflowY, rowsHeight: rows.getBoundingClientRect().height };
      });
      expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.rowsOverflow).toBe('visible');
      expect(geometry.rowsHeight).toBeGreaterThan(90);
      await page.locator('.cart-line').last().locator('[data-remove]').scrollIntoViewIfNeeded();
      await expect(page.locator('.cart-line').last().locator('[data-remove]')).toBeInViewport();
      await page.locator('.cart-line').last().locator('[data-remove]').click({ trial: true });
    }
    await page.locator('#cart-close-btn').click();
    await open(page);
    await expect(page.locator('.cart-line').first()).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`cart-${width}x${height}.png`) });
    await page.setViewportSize({ width: height, height: width });
    await expect(page.locator('#cart-close-btn')).toBeInViewport();
    await expect(page.locator('#cart-checkout-btn')).toBeInViewport();
  });
}

test('failure is explicit, preserves known rows, and supports retry; initial failure is not empty', async ({ page }) => {
  const state = await fixture(page, 1);
  state.fail = true;
  await page.goto('/');
  await page.locator('#cart-icon-btn').click();
  await expect(page.locator('#cart-drawer .cart-status')).toContainText('No se pudo cargar');
  await expect(page.locator('#cart-empty-state')).toHaveCount(0);
  state.fail = false;
  await page.locator('#cart-drawer .cart-status button').click();
  await expect(page.locator('.cart-line')).toHaveCount(1);
  state.fail = true;
  await page.locator('#cart-close-btn').click();
  await open(page);
  await expect(page.locator('#cart-drawer .cart-status')).toContainText('No se pudo cargar');
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(page.locator('#cart-checkout-btn')).toBeDisabled();
  await expect(page.locator('.cart-count').first()).toHaveText('1');
});

test('all entry points share rows, quantities, shipping, subtotal and badge', async ({ page }) => {
  await fixture(page, 0);
  await page.goto('/producto/test-tee-1');
  await expect(page.locator('#pAdd')).toBeEnabled();
  await page.locator('#pAdd').click();
  await expect(page.locator('.cart-count').first()).toHaveText('1');
  await open(page);
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(page.locator('#free-shipping-text')).toContainText('Te faltan');
  await page.locator('.cart-upsell__add').first().click();
  await page.locator('#qaAdd').click();
  await expect(page.locator('#qaCartStatus')).toContainText('Artículo añadido');
  await page.locator('.qa-close').click();
  await expect(page.locator('.cart-line')).toHaveCount(2);
  await expect(page.locator('#free-shipping-text')).toContainText('¡Envío gratuito conseguido!');
  await expect(page.locator('#cart-checkout-btn')).toContainText('70,00');
  await page.locator('#cart-close-btn').click();
  await page.goto('/tienda#store');
  await page.locator('.product-card .fav-add').first().click();
  await page.locator('#qaAdd').click();
  await expect(page.locator('#qaCartStatus')).toContainText('Artículo añadido');
  await page.locator('.qa-close').click();
  await open(page);
  await expect(page.locator('.cart-count').first()).toHaveText('3');
  await page.locator('[data-cart-line="1"] [data-action="inc"]').click();
  await expect(page.locator('#cart-checkout-btn')).toContainText('140,00');
  await expect(page.locator('.cart-count').first()).toHaveText('4');
  await page.locator('[data-cart-line="1"] [data-remove]').click();
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await page.locator('[data-remove]').click();
  await expect(page.locator('#cart-empty-state')).toBeVisible();
  await expect(page.locator('#cart-checkout-btn')).toBeHidden();
  await expect(page.locator('.cart-count').first()).toBeHidden();
});

test('standalone cart shows empty and errors and shares drawer mutations', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const state = await fixture(page, 1);
  await page.goto('/cart');
  await expect(page.locator('#cartItems .cart-item')).toHaveCount(1);
  await page.locator('.ci-qty').fill('3');
  await page.locator('.ci-qty').press('Tab');
  await expect(page.locator('#sumSubtotal')).toContainText('105,00');
  await open(page);
  await expect(page.locator('.cart-qty__input')).toHaveValue('3');
  await page.locator('[data-remove]').click();
  await expect(page.locator('#cart-empty-state')).toBeVisible();
  await page.locator('#cart-close-btn').click();
  await expect(page.locator('#cartItems [data-empty]')).toBeVisible();
  await expect(page.locator('#btnCheckout')).toBeDisabled();
  state.fail = true;
  await page.reload();
  await expect(page.locator('#cartMain .cart-status')).toContainText('No se pudo cargar');
  await expect(page.locator('#cartItems [data-empty]')).toHaveCount(0);
});

test('rapid mutations are serialized and navigation/reload retain the canonical cart', async ({ page }) => {
  const state = await fixture(page, 1);
  await page.goto('/');
  await page.evaluate(async () => {
    await Promise.all([
      window.CRONOX_CART.updateCartItem(1, 2),
      window.CRONOX_CART.addCartItem({ variantId: 102, qty: 1 }),
      window.CRONOX_CART.updateCartItem(1, 4),
      window.CRONOX_CART.fetchCart(),
    ]);
  });
  expect(state.cart.items[0].qty).toBe(4);
  await page.goto('/cart');
  await expect(page.locator('#sumSubtotal')).toContainText('175,00');
  await page.goBack();
  await open(page);
  await expect(page.locator('#cart-checkout-btn')).toContainText('175,00');
  await page.goForward();
  await page.reload();
  await expect(page.locator('#sumSubtotal')).toContainText('175,00');
});

test('auth ownership change discards an in-flight guest snapshot and refreshes open rows', async ({ page }) => {
  const state = await fixture(page, 1);
  await page.goto('/');
  await open(page);
  state.delay = 500;
  await page.evaluate(() => { window.CRONOX_CART.fetchCart().catch(() => {}); });
  await expect.poll(() => state.reads).toBeGreaterThanOrEqual(3);
  state.signedIn = true;
  state.cart = cartWith(3); // Server's authenticated/merged response.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: { id: 1 } })));
  await expect(page.locator('.cart-line')).toHaveCount(3);
  await expect(page.locator('.cart-count').first()).toHaveText('3');
  expect(await page.evaluate(() => window.CRONOX_CART.state.status)).toBe('populated');
});

test('login refreshes the server merged cart and logout keeps the transferred guest cart', async ({ page }) => {
  const state = await fixture(page, 1);
  await page.goto('/');
  await open(page);
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await page.locator('#cart-close-btn').click();
  await page.locator('#profileBtn').click();
  await page.locator('#authLoginEmail').fill('fixture@example.test');
  await page.locator('#authLoginPassword').fill('fixture-password');
  await page.locator('#authLoginForm button[type=submit]').click();
  await expect.poll(() => state.signedIn).toBe(true);
  await open(page);
  await expect(page.locator('.cart-line')).toHaveCount(3);
  await page.reload();
  await open(page);
  await expect(page.locator('.cart-line')).toHaveCount(3);
  await page.locator('#cart-close-btn').click();
  await page.locator('#profileBtn').click();
  await page.locator('[data-user-action=logout]').click();
  await expect.poll(() => state.signedIn).toBe(false);
  await page.waitForLoadState('domcontentloaded');
  await open(page);
  await expect(page.locator('.cart-line')).toHaveCount(3);
});

test('malformed responses are errors and a failed add never claims success', async ({ page }) => {
  const state = await fixture(page, 1);
  state.malformed = true;
  await page.goto('/');
  await page.locator('#cart-icon-btn').click();
  await expect(page.locator('#cart-drawer .cart-status')).toContainText('No se pudo cargar');
  state.malformed = false;
  await page.locator('#cart-drawer .cart-status button').click();
  await expect(page.locator('.cart-line')).toHaveCount(1);
  state.failWrite = true;
  await page.locator('.cart-upsell__add').first().click();
  await page.locator('#qaAdd').click();
  await expect(page.locator('#qaCartStatus')).toContainText('No se pudo añadir');
  await expect(page.locator('#qaAdd')).toHaveText('Reintentar');
  await expect(page.locator('.cart-count').first()).toHaveText('1');
  state.failWrite = false;
  await page.locator('#qaAdd').click();
  await expect(page.locator('#qaCartStatus')).toContainText('Artículo añadido');
  await page.locator('.qa-close').click();
  await expect(page.locator('.cart-line')).toHaveCount(2);
});

test('an external cart update is not overwritten by an older read', async ({ page }) => {
  const state = await fixture(page, 1);
  await page.goto('/');
  await open(page);
  state.delay = 700;
  await page.evaluate(() => { window.CRONOX_CART.fetchCart().catch(() => {}); });
  await expect.poll(() => state.reads).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => {
    const cart = window.CRONOX_CART.state.data;
    const updated = { ...cart, items: cart.items.map(i => ({ ...i, qty: 2 })), itemsCount: 2, subtotalCents: 7000 };
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: updated }));
  });
  await page.waitForTimeout(850);
  await expect(page.locator('.cart-qty__input')).toHaveValue('2');
  await expect(page.locator('.cart-count').first()).toHaveText('2');
});

for (const width of [320, 768, 1366]) {
  test(`standalone long names and multiple sizes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    const state = await fixture(page, 4);
    state.signedIn = true;
    await page.goto('/cart');
    await expect(page.locator('#cartItems .cart-item')).toHaveCount(4);
    await expect(page.locator('#cartItems')).toContainText('XL');
    expect(await page.locator('#cartMain').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator('#btnCheckout').scrollIntoViewIfNeeded();
    await expect(page.locator('#btnCheckout')).toBeEnabled();
    await page.locator('#btnCheckout').click();
    await expect(page).toHaveURL(/\/checkout$/);
  });
}

for (const zoom of [1.25, 1.5, 2]) {
  test(`desktop zoom ${zoom * 100}% layout equivalent`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: Math.floor(1366 / zoom), height: Math.floor(600 / zoom) }, deviceScaleFactor: zoom });
    const page = await context.newPage();
    await fixture(page, 3);
    await page.goto('http://127.0.0.1:4173/');
    await open(page);
    await expect(page.locator('.cart-line').first()).toBeInViewport();
    await expect(page.locator('#cart-close-btn')).toBeInViewport();
    await expect(page.locator('#cart-checkout-btn')).toBeInViewport();
    expect(await page.locator('.cart-drawer__panel').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`zoom-${zoom}.png`) });
    await context.close();
  });
}
