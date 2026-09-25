const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
// Opt-in benchmark against the pre-change commit; ordinary regression tests do
// not depend on HEAD remaining unchanged after this work is eventually committed.
const baseline = process.env.BADGE_COMPARE_HEAD || process.env.BADGE_BASELINE_ONLY
  ? execFileSync('git', ['show', 'HEAD:cronox-front/assets/app.js'], { encoding: 'utf8' }) : null;

async function setup(page, { original = false, meDelay = 100, favoritesDelay = 70 } = {}) {
  const state = { user: { id: 101, name: 'Prueba', role: 'USER' }, ids: [11, 12, 13], requests: [], favoritesDelay, failFavorites: false, failMutation: false };
  if (original) await page.route('**/assets/app.js?*', route => route.fulfill({ contentType: 'application/javascript', body: baseline }));
  await page.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    window.__badgeAt = null;
    window.__badgeValues = [];
    const inspect = () => {
      const el = document.querySelector('.favorites-count, .fav-count');
      if (el && !el.hidden && el.style.display !== 'none' && el.textContent.trim()) {
        if (window.__badgeAt === null) window.__badgeAt = performance.now();
        if (window.__badgeValues.at(-1) !== el.textContent) window.__badgeValues.push(el.textContent);
      }
    };
    new MutationObserver(inspect).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    state.requests.push(`${method} ${path}`);
    const user = state.user, ids = [...state.ids];
    if (path === '/api/auth/csrf') return route.fulfill({ json: { csrfToken: 'local-favorites-fixture' } });
    if (path === '/api/auth/refresh') return route.fulfill({ status: user ? 200 : 401, json: user || {} });
    if (path === '/api/me') {
      await new Promise(resolve => setTimeout(resolve, meDelay));
      return route.fulfill({ status: user ? 200 : 401, json: user || {} });
    }
    if (path === '/api/favorites' && method === 'GET') {
      const failed = state.failFavorites;
      await new Promise(resolve => setTimeout(resolve, state.favoritesDelay));
      return route.fulfill({ status: failed ? 503 : user ? 200 : 401, json: failed ? {} : user ? ids.map(productId => ({ productId, product: { id: productId, name: `Prueba ${productId}`, slug: `test-${productId}`, price: 4000, images: [] } })) : {} });
    }
    if (path === '/api/favorites' && method === 'POST') {
      if (state.failMutation) return route.fulfill({ status: 500, json: {} });
      state.ids.push(Number(route.request().postDataJSON().productId));
      return route.fulfill({ json: { ok: true } });
    }
    if (path.startsWith('/api/favorites/') && method === 'DELETE') {
      state.ids = state.ids.filter(id => id !== Number(path.split('/').at(-1)));
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: path === '/api/key-screen' ? { enabled: false } : path === '/api/cart' ? { items: [], itemsCount: 0, subtotal: 0 } : path === '/api/products' ? { items: [], meta: { total: 0 } } : [] });
  });
  return state;
}

const badge = page => page.locator('.favorites-count, .fav-count').first();
async function changeUser(page, user) {
  await page.evaluate(user => {
    window.CRONOX_USER = user;
    window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: user }));
  }, user);
}
async function toggle(page, id) {
  await page.evaluate(async id => {
    const button = document.createElement('button');
    button.dataset.productId = String(id);
    await window.CRONOX_FAVORITES.toggleFromButton(button);
  }, id);
}

test('shares pending requests, reuses current state and keeps mutation counts correct', async ({ page }) => {
  const state = await setup(page, { meDelay: 20, favoritesDelay: 180 });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const manager = window.CRONOX_FAVORITES;
    const a = manager.loadFromServer(), b = manager.loadFromServer();
    await Promise.all([a, b]);
    return { shared: a === b, count: manager.ids.size };
  });
  expect(result).toEqual({ shared: true, count: 3 });
  expect(state.requests.filter(r => r === 'GET /api/favorites')).toHaveLength(1);
  await page.evaluate(() => window.initFavoritesFromBackend());
  expect(state.requests.filter(r => r === 'GET /api/favorites')).toHaveLength(1);
  await toggle(page, 14);
  await expect(badge(page)).toHaveText('4');
  await toggle(page, 14);
  await expect(badge(page)).toHaveText('3');
  state.failMutation = true;
  await toggle(page, 15);
  await expect(badge(page)).toHaveText('3');
  for (const id of [11, 12, 13]) await toggle(page, id);
  await expect(badge(page)).toBeHidden();
  await expect(badge(page)).toHaveText('');
});

test('late previous-account response cannot show its count after login/logout', async ({ page }) => {
  const state = await setup(page, { meDelay: 20, favoritesDelay: 500 });
  await page.goto('/');
  await page.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
  await expect(badge(page)).toBeHidden();
  state.user = { id: 202, role: 'USER' }; state.ids = [90];
  await changeUser(page, state.user);
  await expect(badge(page)).toHaveText('1');
  expect(await page.evaluate(() => window.__badgeValues)).toEqual(['1']);
  await page.evaluate(() => { void window.CRONOX_FAVORITES.loadFromServer({ force: true }); });
  state.user = null;
  await changeUser(page, null);
  await page.waitForTimeout(550); // wait out the deliberately delayed OLD response
  await expect(badge(page)).toBeHidden();
  // The existing session layer may navigate home on logout, resetting this log.
  expect(await page.evaluate(() => window.__badgeValues.every(value => value === '1'))).toBe(true);
});

test('errors and anonymous/zero responses never paint a misleading zero', async ({ page }) => {
  const state = await setup(page);
  state.failFavorites = true;
  await page.goto('/');
  await page.waitForFunction(() => window.CRONOX_FAVORITES && !window.CRONOX_FAVORITES.isLoading);
  await expect(badge(page)).toBeHidden();
  expect(await page.evaluate(() => window.__badgeValues)).toEqual([]);
  state.failFavorites = false; state.ids = [];
  await page.evaluate(() => window.CRONOX_FAVORITES.loadFromServer());
  await expect(badge(page)).toBeHidden();
  state.user = null;
  await page.reload();
  await page.waitForFunction(() => window.CRONOX_AUTH_STATE === 'anonymous');
  await expect(badge(page)).toBeHidden();
  expect(await page.evaluate(() => window.__badgeValues)).toEqual([]);
});

test('a late refresh does not overwrite a newer favorite mutation', async ({ page }) => {
  const state = await setup(page, { meDelay: 20 });
  await page.goto('/');
  await expect(badge(page)).toHaveText('3');
  state.favoritesDelay = 450;
  // A server-derived update arriving during an existing fetch wins over it.
  await page.evaluate(() => { void window.CRONOX_FAVORITES.loadFromServer({ force: true }); });
  await page.evaluate(() => window.CRONOX_FAVORITES.setIdsFromServer([11, 12, 13, 14]));
  await page.waitForTimeout(500);
  await expect(badge(page)).toHaveText('4');
});

test('Favorites page reuses full records instead of requesting a second list', async ({ page }) => {
  const state = await setup(page, { meDelay: 20 });
  await page.goto('/favorites.html');
  await expect(badge(page)).toHaveText('3');
  await expect(page.locator('#favorites-grid .product-card')).toHaveCount(3);
  expect(state.requests.filter(r => r === 'GET /api/favorites')).toHaveLength(1);
  expect(state.requests.filter(r => r === 'GET /api/favorites/products')).toHaveLength(0);
  state.user = null;
  await changeUser(page, null);
  await expect(badge(page)).toBeHidden();
  state.user = { id: 202, role: 'USER' }; state.ids = [90];
  await changeUser(page, state.user);
  await expect(badge(page)).toHaveText('1');
  await expect(page.locator('#favorites-grid .product-card')).toHaveCount(1);
});

test('restored pages revalidate instead of painting the previous count', async ({ page }) => {
  const state = await setup(page, { meDelay: 20 });
  await page.goto('/');
  await expect(badge(page)).toHaveText('3');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(badge(page)).toBeHidden();
  state.ids = [90];
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(badge(page)).toHaveText('1');
  state.ids = [90, 91];
  await page.goto('/faqs.html');
  await expect(badge(page)).toHaveText('2');
  expect(await page.evaluate(() => window.__badgeValues)).toEqual(['2']);
});

for (const width of [1366, 390]) {
  for (const slow of [false, true]) {
    test(`timing ${width}px ${slow ? 'slow' : 'normal'}`, async ({ browser }, info) => {
      const results = [];
      for (const original of process.env.BADGE_BASELINE_ONLY ? [true] : process.env.BADGE_COMPARE_HEAD ? [true, false] : [false]) {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        const page = await context.newPage();
        const state = await setup(page, { original, meDelay: slow ? 600 : 100, favoritesDelay: slow ? 200 : 70 });
        const loads = [];
        for (const path of ['/', '/faqs.html']) {
          state.requests.length = 0;
          await page.goto(path);
          await expect(page.locator('.favorites-count, .fav-count').first()).toHaveText('3');
          loads.push({ path, ms: Math.round(await page.evaluate(() => window.__badgeAt)), requestsAtBadge: [...state.requests] });
          if (!original) {
            expect(state.requests.filter(r => r === 'GET /api/favorites')).toHaveLength(1);
            expect(state.requests.filter(r => r === 'GET /api/me')).toHaveLength(1);
            if (slow) expect(loads.at(-1).ms).toBeLessThan(600);
          }
        }
        results.push({ original, loads });
        await context.close();
      }
      console.log(JSON.stringify({ browser: info.project.name, width, slow, results }));
      await info.attach('timings.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
      if (results.length === 2) {
        for (let i = 0; i < 2; i++) expect(results[1].loads[i].ms).toBeLessThan(results[0].loads[i].ms);
      }
    });
  }
}
