async page => {
  const origin = 'http://127.0.0.1:43128';
  const report = [];
  for (const old of page.context().browser().contexts()) if (old !== page.context()) await old.close();
  const check = (value, message) => { if (!value) throw new Error(message); };
  for (const width of [1366, 390]) {
    const context = await page.context().browser().newContext({ viewport: { width, height: 850 }, isMobile: width < 500, hasTouch: width < 500 });
    await context.addInitScript(() => sessionStorage.setItem('cronoxNewsletterShown', 'true'));
    const email = `browser-${width}-${Date.now()}@newsletter.test`;
    check((await context.request.post(origin + '/__review/seed', { data: { email, kind: 'existing' } })).ok(), 'fixture setup');
    const tab = await context.newPage();
    await tab.goto(origin);
    const reject = tab.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    await tab.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    await tab.locator('#authLoginEmail').fill(email);
    await tab.locator('#authLoginPassword').fill('FixturePassword1!');
    await tab.locator('#authLoginForm button[type=submit]').click();
    await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated' && window.CRONOX_FAVORITES?.ready && ['empty', 'populated'].includes(window.CRONOX_CART?.state.status));
    console.log('authenticated ' + width);
    const state = async () => (await context.request.get(origin + '/__review/store-state?email=' + email)).json();
    const products = await (await context.request.get(origin + '/api/products')).json();
    const product = (products.items || products.data || products)[0];
    const variantId = product.variants[0].id;
    // Exercise real controls; hold the first response to make both clicks overlap.
    let release, entered;
    const held = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    await tab.route('**/api/favorites', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch(); entered(); await held; await route.fulfill({ response });
    });
    const favorite = tab.locator('.favorite-toggle[data-product-id]').first();
    await favorite.click(); await started;
    await favorite.click(); release();
    await tab.waitForFunction(() => !window.CRONOX_FAVORITES.pendingProducts.size);
    check((await state()).favorites.length === 0, 'double-click must preserve final remove intent');
    await tab.unroute('**/api/favorites');
    await favorite.click();
    await tab.waitForFunction(() => window.CRONOX_FAVORITES.ids.size === 1 && !window.CRONOX_FAVORITES.pendingProducts.size);
    console.log('completed scenario ' + report.length);
    report.push({ width, scenario: 'slow-favorite-double-click', passed: true });

    const peer = await context.newPage(); await peer.goto(origin);
    await peer.waitForFunction(() => window.CRONOX_FAVORITES?.ready && window.CRONOX_FAVORITES.ids.size === 1);
    await peer.locator('.favorite-toggle[data-product-id]').first().click();
    await tab.waitForFunction(() => window.CRONOX_FAVORITES.ids.size === 0);
    await favorite.click();
    await peer.waitForFunction(() => window.CRONOX_FAVORITES.ids.size === 1);
    check((await state()).favorites.length === 1, 'cross-tab favorite persisted');
    console.log('completed scenario ' + report.length);
    report.push({ width, scenario: 'favorite-two-tabs', passed: true });

    // Both tabs intentionally add; each has a distinct operation key.
    await Promise.all([tab, peer].map(p => p.evaluate(id => window.CRONOX_CART.addCartItem({ variantId: id, qty: 1 }), variantId)));
    await tab.waitForFunction(() => window.CRONOX_CART.state.data?.itemsCount === 2);
    await peer.waitForFunction(() => window.CRONOX_CART.state.data?.itemsCount === 2);
    check((await state()).cart.items[0].qty === 2, 'two intentional additions');
    console.log('completed scenario ' + report.length);
    report.push({ width, scenario: 'cart-two-tabs', passed: true });

    // The server commits but the response is lost. Retry through the same UI manager.
    await tab.route('**/api/cart/items', async route => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
    const failed = await tab.evaluate(async id => { try { await window.CRONOX_CART.addCartItem({ variantId: id, qty: 1 }); return false; } catch { return true; } }, variantId);
    check(failed, 'lost response must not be reported as success');
    check((await state()).cart.items[0].qty === 3, 'server committed once');
    await tab.reload();
    await tab.waitForFunction(() => ['empty', 'populated'].includes(window.CRONOX_CART?.state.status));
    await tab.evaluate(id => window.CRONOX_CART.addCartItem({ variantId: id, qty: 1 }), variantId);
    check((await state()).cart.items[0].qty === 3, 'retry after reload duplicated quantity');
    await tab.evaluate(id => window.CRONOX_CART.addCartItem({ variantId: id, qty: 1 }), variantId);
    check((await state()).cart.items[0].qty === 4, 'next intentional add was suppressed');
    console.log('completed scenario ' + report.length);
    report.push({ width, scenario: 'lost-response-reload-retry-then-new-intent', passed: true });

    // Slow stale read must not overwrite the subsequent state from the other tab.
    let unblock, readEntered;
    const blockedRead = new Promise(resolve => { unblock = resolve; });
    const reading = new Promise(resolve => { readEntered = resolve; });
    await tab.route('**/api/cart', async route => { const response = await route.fetch(); readEntered(); await blockedRead; await route.fulfill({ response }); }, { times: 1 });
    const oldRead = tab.evaluate(() => window.CRONOX_CART.fetchCart());
    await reading;
    await peer.evaluate(id => window.CRONOX_CART.addCartItem({ variantId: id, qty: 1 }), variantId);
    unblock(); await oldRead;
    await tab.waitForFunction(() => window.CRONOX_CART.state.data?.itemsCount === 5);
    check((await state()).cart.items[0].qty === 5, 'stale read reverted cart');
    console.log('completed scenario ' + report.length);
    report.push({ width, scenario: 'out-of-order-cart-read', passed: true });

    let rateRequests = 0;
    await tab.route('**/api/favorites', route => { rateRequests++; return route.fulfill({ status: 429, headers: { 'Retry-After': '30', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Espera 30 segundos.' }) }); });
    await tab.evaluate(() => window.CRONOX_FAVORITES.loadFromServer({ force: true }));
    await tab.evaluate(() => window.CRONOX_FAVORITES.loadFromServer({ force: true }));
    check(rateRequests === 1, 'Retry-After ignored');
    check(await tab.evaluate(() => window.CRONOX_AUTH_STATE === 'authenticated' && window.CRONOX_FAVORITES.ids.size === 1 && window.CRONOX_CART.state.data.itemsCount === 5), '429 cleared customer state');
    await tab.unroute('**/api/favorites');
    await tab.evaluate(() => window.CRONOX_CART.openCartDrawer());
    await tab.locator('#preloader').waitFor({ state: 'hidden' });
    await tab.screenshot({ animations: 'disabled', path: `output/playwright/concurrency-${width}.png` });
    console.log('completed scenario ' + report.length);
    report.push({ width, scenario: '429-retains-session-cart-favorites-and-cooldown', passed: true });
    await tab.route('**/api/cart/items', async route => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
    await tab.evaluate(async id => { try { await window.CRONOX_CART.addCartItem({ variantId: id, qty: 1 }); } catch {} }, variantId);
    await tab.evaluate(() => window.CRONOX_CART.clearCartItems());
    await tab.evaluate(id => window.CRONOX_CART.addCartItem({ variantId: id, qty: 1 }), variantId);
    check((await state()).cart.items[0].qty === 1, 'explicit clear reused an abandoned addition');
    report.push({ width, scenario: 'explicit-clear-ends-old-intent', passed: true });
    await context.close();
  }
  return { browserConcurrency: report };
}
