const { test, expect } = require('@playwright/test');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');
const origin = 'http://localhost:4197';

test.beforeEach(async ({ page }) => {
  page.auditErrors = [];
  page.on('pageerror', e => page.auditErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.auditErrors.push(m.text()); });
  await page.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    sessionStorage.setItem('cronox_newsletter_seen', '1');
    document.cookie = 'cronox_cookie_consent=' + encodeURIComponent(JSON.stringify({ necessary: true, preferences: false, analytics: false, marketing: false, consentVersion: '2', timestamp: new Date().toISOString() })) + '; path=/';
  });
  // No checkout/payment/network writes are needed for this regression.
  await page.route('**/*', route => {
    const r = route.request(), u = new URL(r.url());
    if (u.origin !== origin && r.method() !== 'GET') return route.abort();
    if (/\/api\/(checkout|payments|webhooks|orders)(\/|$)/.test(u.pathname) && r.method() !== 'GET') return route.abort();
    return route.continue();
  });
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await info.attach('diagnostics', { body: JSON.stringify({ errors: page.auditErrors, state: await page.evaluate(() => ({ url: location.href, api: window.CRONOX_API?.API_BASE })) }), contentType: 'application/json' });
});

test('direct URL, refresh, discovery, current metadata, search and recommendation links', async ({ page, request }) => {
  for (const method of ['get', 'head']) {
    const response = await request[method]('/producto/shielded-coal?size=M', { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers().location).toBe('/producto/armored-coal?size=M');
    expect((await request[method](response.headers().location, { maxRedirects: 0 })).status()).toBe(200);
  }
  const response = await page.goto('/producto/shielded-coal?size=M');
  expect(response.status()).toBe(200);
  await expect(response.request().redirectedFrom().response().then(r => r.status())).resolves.toBe(301);
  await expect(page).toHaveURL(origin + '/producto/armored-coal?size=M');
  await expect(page.locator('#pName')).toHaveText('ARMORED COAL');
  await expect(page.locator('.size-btn.is-active')).toHaveAttribute('data-size', 'M');
  expect((await page.reload()).status()).toBe(200);
  const real = await (await request.get('/api/products/armored-coal')).json();
  if (real.variants.some(v => v.stockQty > 0)) await expect(page.locator('#pAdd')).toBeEnabled();
  else await expect(page.locator('#pAdd')).toBeDisabled();
  for (const selector of ['link[rel=canonical]', 'meta[property="og:url"]']) {
    await expect(page.locator(selector)).toHaveAttribute(selector.startsWith('link') ? 'href' : 'content', 'https://cronox.es/producto/armored-coal');
  }
  expect(await page.locator('#cronox-seo').textContent()).toContain('/producto/armored-coal');
  expect(await page.locator('a[href*="shielded-coal"]').count()).toBe(0);
  const oldApi = await (await request.get('/api/products/shielded-coal')).json();
  const newApi = await (await request.get('/api/products/armored-coal')).json();
  expect(oldApi).toEqual(newApi);
  expect(newApi).toMatchObject({ id: 4, name: 'ARMORED COAL', slug: 'armored-coal', price: 6500 });
  expect(newApi.variants).toHaveLength(6);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/producto/armored-coal');
  expect(sitemap).not.toContain('shielded-coal');
  await page.goto('/tienda?search=ARMORED');
  await expect(page.locator('#productsGrid a[href="/producto/armored-coal"]').first()).toBeVisible();
  await page.goto('/');
  await expect(page.locator('a[href="/galeria"]')).toHaveText('GALERÍA');
  expect(await page.locator('a[href*="shielded-coal"]').count()).toBe(0);
  // Recommendations only show the first two peers; explicitly put this
  // existing product in that window to exercise the shared link generator.
  await page.route('**/api/products?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.items.sort((a, b) => Number(b.id === 4) - Number(a.id === 4));
    return route.fulfill({ json: body });
  });
  await page.goto('/producto/scarred-tee-black');
  await expect(page.locator('#relatedGrid a[href="/producto/armored-coal"]').first()).toBeVisible();
});

test('same product is linked from real persisted local favorites', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/producto/armored-coal?size=M');
  const token = (await (await page.request.get('/api/auth/csrf')).json()).csrfToken;
  const env = loadLocalEnvironment();
  const login = await page.request.post('/api/auth/login', { headers: { Origin: origin, 'X-CSRF-Token': token }, data: { email: env.LOCAL_ADMIN_EMAIL, password: env.LOCAL_ADMIN_PASSWORD } });
  expect(login.ok()).toBe(true);
  const favorites = await (await page.request.get('/api/favorites')).json();
  const existed = favorites.some(f => f.productId === 4);
  await page.goto('/producto/armored-coal');
  await expect(page.locator('#pFavoriteToggle')).toHaveAttribute('data-product-id', '4');
  try {
    if (!existed) {
      await page.locator('#pFavoriteToggle').click();
      await expect(page.locator('#pFavoriteToggle')).toHaveClass(/is-favorite/);
      await expect.poll(async () => (await (await page.request.get('/api/favorites')).json()).some(f => f.productId === 4)).toBe(true);
    }
    await page.goto('/favoritos');
    await expect(page.locator('#favorites-grid a[href="/producto/armored-coal"]').first()).toBeVisible();
    expect((await page.reload()).status()).toBe(200);
    await expect(page.locator('#favorites-grid')).toContainText('ARMORED COAL');
  } finally {
    if (!existed) {
      const csrf = (await (await page.request.get('/api/auth/csrf')).json()).csrfToken;
      expect((await page.request.delete('/api/favorites/4', { headers: { Origin: origin, 'X-CSRF-Token': csrf } })).ok()).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test('cart UI retains the renamed ID/variant through navigation and reload (explicit stock fixture)', async ({ page, request }) => {
  // Local catalogue stock is zero. Only this browser receives a simulated
  // available variant and in-memory cart; no database stock or cart is changed.
  const product = await (await request.get('/api/products/armored-coal')).json();
  product.variants = product.variants.map(v => ({ ...v, stockQty: 2 }));
  const state = { id: 990001, items: [], itemsCount: 0, subtotal: 0 };
  await page.route('**/api/products**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/products/armored-coal') return route.fulfill({ json: product });
    if (url.pathname === '/api/products') return route.fulfill({ json: { items: [product], meta: { total: 1, pageCount: 1 } } });
    return route.continue();
  });
  await page.route('**/api/cart**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.variantId).toBe(33);
      const variant = product.variants.find(v => v.id === body.variantId);
      state.items = [{ id: 990002, variantId: variant.id, qty: body.qty, priceAtAdd: product.price, variant: { ...variant, product } }];
      state.itemsCount = body.qty;
      state.subtotal = product.price * body.qty;
    }
    return route.fulfill({ json: state });
  });
  await page.goto('/producto/armored-coal?size=M');
  await expect(page.locator('#pAdd')).toBeEnabled();
  await page.locator('#pAdd').click();
  await expect.poll(() => state.itemsCount).toBe(1);
  await page.goto('/cesta');
  await expect(page.locator('#cartItems')).toContainText('ARMORED COAL');
  expect((await page.reload()).status()).toBe(200);
  await expect(page.locator('#cartItems')).toContainText('ARMORED COAL');
  expect(state.items[0].variant.product).toMatchObject({ id: 4, slug: 'armored-coal' });
  expect(await page.locator('a[href*="shielded-coal"]').count()).toBe(0);
});
