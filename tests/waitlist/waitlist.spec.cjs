const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function fixture(page, allSoldOut = false) {
  const state = { signedIn: false, role: 'USER', requests: new Map(), writes: [], fail: false, delay: 0 };
  const product = { id: 1, slug: 'test-tee', name: 'Camiseta CRONOX de nombre largo <especial>', price: 3500, currency: 'EUR',
    imageUrl: '/assets/logo_banner.png', images: [{ url: '/assets/logo_banner.png', isPrimary: true }],
    variants: [{ id: 101, size: 'M', stock: 0, isActive: true }, { id: 102, size: 'L', stock: allSoldOut ? 0 : 4, isActive: true }],
  };
  const user = { id: 1, email: 'fixture@example.test', role: 'USER' };
  await page.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    sessionStorage.setItem('cronox_newsletter_seen', '1');
    document.cookie = 'cronox_cookie_consent=' + encodeURIComponent(JSON.stringify({ necessary: true, preferences: false, analytics: false, marketing: false, consentVersion: '2', timestamp: new Date().toISOString() })) + '; path=/';
  });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let data = {};
    if (url.pathname === '/api/auth/csrf') data = { csrfToken: 'local-waitlist-fixture' };
    else if (url.pathname === '/api/me') data = state.signedIn ? { ...user, role: state.role } : null;
    else if (['/api/auth/login','/api/auth/register'].includes(url.pathname)) { state.signedIn = true; data = { user }; }
    else if (url.pathname === '/api/products') data = { items: [product], meta: { total: 1 } };
    else if (url.pathname.startsWith('/api/products/')) data = product;
    else if (url.pathname.startsWith('/api/cart')) data = { id: 1, items: [], itemsCount: 0, subtotal: 0 };
    else if (url.pathname.startsWith('/api/favorites')) data = [];
    else if (url.pathname.startsWith('/api/waitlist/')) {
      const id = url.pathname.split('/').pop();
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      if (state.fail) return route.fulfill({ status: 503, json: { message: 'No se pudo guardar el aviso.' } });
      if (!state.signedIn) return route.fulfill({ status: 401, json: {} });
      if (req.method() === 'POST') { state.writes.push(id); state.requests.set(id, { id: `r-${id}`, status: 'WAITING' }); }
      if (req.method() === 'DELETE') state.requests.delete(id);
      data = { subscription: state.requests.get(id) || null };
    }
    return route.fulfill({ json: data });
  });
  return { state, product, errors };
}

for (const width of [320, 390, 768, 1366]) {
  test(`PDP ${width}px: sold-out size, login return, explicit confirmation, persistence and cancellation`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1366 ? 700 : 844 });
    const { state, errors } = await fixture(page, true);
    await page.goto('/producto/test-tee?waitlist=102');
    const root = page.locator('#productWaitlist'), button = root.locator('button');
    await expect(root).toBeVisible(); await expect(page.locator('#pAdd')).toBeDisabled();
    await expect(root.locator('select')).toHaveValue('102');
    await expect(button).toHaveText('Iniciar sesión o registrarme');
    await button.click();
    await expect(page.locator('#authLoginForm')).toBeVisible();
    // Existing modal moves focus after its opening transition (60ms).
    await expect(page.locator('#authLoginForm input[type=email]')).toBeFocused();
    await page.locator('#authLoginForm input[type=email]').fill('fixture@example.test');
    await page.locator('#authLoginForm input[type=password]').fill('fake-test-password');
    await page.locator('#authLoginForm button[type=submit]').click();
    await expect(button).toHaveText('Avísame cuando vuelva');
    expect(state.writes).toEqual([]);
    await expect(root.locator('.restock-choice')).toContainText('Talla L');
    await button.click(); await expect(button).toHaveText('Cancelar aviso');
    expect(state.writes).toEqual(['102']);
    await page.reload(); await expect(button).toHaveText('Cancelar aviso');
    await root.scrollIntoViewIfNeeded();
    const box = await root.boundingBox(); expect(box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`waitlist-${width}.png`), fullPage: true });
    await button.click(); await expect(root.locator('.restock-status')).toHaveText('Aviso cancelado.');
    expect(state.requests.size).toBe(0); expect(errors).toEqual([]);
  });
}

test('one exhausted size remains discoverable; slow/error requests never show false success', async ({ page }) => {
  const { state, errors } = await fixture(page); state.signedIn = true;
  await page.goto('/producto/test-tee');
  const root = page.locator('#productWaitlist'), button = root.locator('button');
  await expect(page.locator('#pSizeGroup [data-size="M"]')).toBeDisabled();
  await expect(page.locator('#pAdd')).toBeEnabled();
  await expect(button).toHaveText('Avísame cuando vuelva');
  state.delay = 600; state.fail = true;
  await button.click(); await expect(button).toBeDisabled();
  await expect(root.locator('.restock-status')).toHaveText('No se pudo guardar el aviso.');
  expect(state.requests.size).toBe(0); await expect(button).toHaveText('Volver a comprobar');
  state.fail = false; state.delay = 0; await button.click();
  await expect(button).toHaveText('Avísame cuando vuelva');
  await button.click(); await expect(button).toHaveText('Cancelar aviso');
  await root.locator('select').selectOption('102');
  await expect(root.locator('.restock-status')).toContainText('Esta talla está disponible');
  await expect(button).toBeDisabled(); expect(errors).toEqual([]);
});

test('quick add links sold-out customers to PDP, and email URL preselects a purchasable size', async ({ page }) => {
  const { errors } = await fixture(page);
  await page.goto('/');
  await page.locator('.fav-add').first().click();
  await expect(page.locator('#qaLink')).toContainText('Activa un aviso');
  await page.locator('#qaLink').click(); await expect(page.locator('#productWaitlist')).toBeVisible();
  await page.goto('/producto/test-tee?size=L');
  await expect(page.locator('#pSizeGroup [data-size="L"]')).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('registration keeps the intended sold-out size and does not silently subscribe', async ({ page }) => {
  const { state, errors } = await fixture(page, true);
  await page.goto('/producto/test-tee?waitlist=102');
  const button = page.locator('#productWaitlist button');
  await expect(button).toHaveText('Iniciar sesión o registrarme'); await button.click();
  await expect(page.locator('#authLoginForm input[type=email]')).toBeFocused();
  await page.locator('[data-auth-switch="register"]').click();
  await page.locator('#authRegisterFirstName').fill('Cliente');
  await page.locator('#authRegisterLastName').fill('Prueba');
  await page.locator('#authRegisterEmail').fill('fixture@example.test');
  await page.locator('#authRegisterPassword').fill('fake-test-password');
  await page.locator('#authRegisterForm button[type=submit]').click();
  await expect(button).toHaveText('Avísame cuando vuelva');
  expect(state.writes).toEqual([]); await expect(page.locator('#restockSize')).toHaveValue('102');
  await button.click(); await expect(button).toHaveText('Cancelar aviso');
  expect(state.writes).toEqual(['102']); expect(errors).toEqual([]);
});

test('actual authorized admin navigation loads Waitlist and its optimized principal image', async ({ page }) => {
  const { state, errors } = await fixture(page); state.signedIn = true; state.role = 'ADMIN';
  await page.route('**/api/admin/waitlist?*', route => route.fulfill({ json: { rows: [{ id: 101, productId: 1, name: 'Test tee', size: 'M', stock: 0, available: false, demand: 1,
    productPeople: 1, waiting: 1, queued: 0, processing: 0, accepted: 0, failed: 0, uncertain: 0, cancelled: 0,
    image: { url: '/should-not-download-original.png', variants: { small: { url: '/assets/logo_banner.png', width: 600, height: 600 } } }, latestRequest: '2026-09-24T10:00:00Z' }],
    page: 1, pageSize: 25, total: 1, workerEnabled: false, senderReady: false, storeOpen: true } }));
  const images = []; page.on('request', req => { if (req.resourceType() === 'image') images.push(req.url()); });
  await page.goto('/admin.html');
  await page.locator('[data-nav-target="section-waitlist"]').click();
  await expect(page.locator('#section-waitlist h3')).toHaveText('Test tee · M');
  await expect(page.locator('#section-waitlist img')).toHaveAttribute('src', /logo_banner/);
  expect(images.some(url => url.includes('should-not-download'))).toBe(false);
  // Existing menu buttons do not persist sections; verify the supported deep link.
  await page.goto('/admin.html#section-waitlist');
  await page.reload(); await expect(page.locator('#section-waitlist h3')).toHaveText('Test tee · M');
  expect(errors).toEqual([]);
});

for (const width of [375, 1366]) {
  test(`admin ${width}px: demand/statuses, search, pagination and error recovery`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/assets/*.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    let failed = false; const queries = [];
    await page.route('**/api/admin/waitlist?*', route => {
      const params = new URL(route.request().url()).searchParams; queries.push(params.toString());
      if (failed) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { rows: [{ id: 101, productId: 1, name: 'Test <script> producto', size: 'M', stock: 0, available: false, demand: 2,
        productPeople: 2, waiting: 1, queued: 1, processing: 0, accepted: 5, failed: 1, uncertain: 1, cancelled: 2, latestRequest: '2026-09-24T10:00:00Z' }],
        page: Number(params.get('page')), pageSize: 25, total: 26, workerEnabled: false, senderReady: false } });
    });
    await page.goto('/admin.html');
    await page.evaluate(() => { window.CRONOX_API = { API_BASE: '' }; document.querySelector('#adminAuthCheck').hidden = true; document.querySelector('#adminShell').hidden = false; document.querySelector('#section-waitlist').hidden = false; document.querySelector('#section-menu').hidden = true; });
    await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../../cronox-front/assets/admin-waitlist.js'), 'utf8') });
    await page.evaluate(() => window.CRONOX_WAITLIST_ADMIN.load());
    const root = page.locator('#section-waitlist');
    await expect(root.locator('h3')).toHaveText('Test <script> producto · M');
    await expect(root).toContainText('2 personas distintas');
    await page.locator('#waitlistNext').click(); await expect(page.locator('#waitlistPage')).toContainText('Página 2');
    await page.locator('#waitlistSearch').fill('test'); await page.locator('#waitlistStatus').selectOption('QUEUED');
    await page.locator('#waitlistFilters button').click();
    await expect(page.locator('#waitlistPage')).toContainText('Página 1');
    expect(queries.at(-1)).toContain('status=QUEUED');
    await root.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`admin-waitlist-${width}.png`), fullPage: true });
    failed = true; await page.locator('#waitlistRefresh').click(); await expect(page.locator('#waitlistMessage')).toContainText('No se pudo cargar');
    failed = false; await page.locator('#waitlistRefresh').click(); await expect(root.locator('h3')).toBeVisible();
  });
}
