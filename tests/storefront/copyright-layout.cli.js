async page => {
  // Run against the isolated --storefront-browser fixture; never customer data.
  const origin = 'http://127.0.0.1:43128';
  const phase = new URL(page.url()).searchParams.get('review') || 'before';
  const requestedWidth = Number(new URL(page.url()).searchParams.get('width'));
  const report = [];
  for (const old of page.context().browser().contexts()) if (old !== page.context()) await old.close();
  const geometry = () => {
    const footer = document.querySelector('body > footer, .checkout-footer');
    const copyright = footer?.querySelector('.footer-copy, p, .container, span') || footer;
    const range = document.createRange();
    if (copyright) range.selectNodeContents(copyright);
    const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, height: r.height }; };
    const content = document.querySelector('body > main, [data-footer-content]');
    return {
      viewport: { width: innerWidth, height: innerHeight }, scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      footer: footer && rect(footer), copyright: copyright && rect(range), content: content && rect(content),
      position: footer && getComputedStyle(footer).position,
      footerCount: document.querySelectorAll('body > footer, .checkout-footer').length,
      commercialFooter: !!document.querySelector('body > .site-footer'),
    };
  };
  for (const width of requestedWidth ? [requestedWidth] : [1366, 390, 768]) {
    const context = await page.context().browser().newContext({ viewport: { width, height: 850 }, isMobile: width < 500, hasTouch: width < 500 });
    await context.addInitScript(() => sessionStorage.setItem('cronoxNewsletterShown', 'true'));
    const email = `copyright-${width}-${Date.now()}@newsletter.test`;
    if (!(await context.request.post(origin + '/__review/seed', { data: { email, kind: 'existing' } })).ok()) throw Error('Fixture setup failed');
    const tab = await context.newPage();
    let orders = [];
    let ordersGate;
    await tab.route('**/api/me/orders', async route => {
      if (ordersGate) await ordersGate;
      await route.fulfill({ json: orders });
    });
    await tab.route('**/api/accreditations/active', route => route.fulfill({ json: { id: 'metacrilatos', renderer: 'metacrilatos-v1', config: { version: 1 } } }));
    await tab.goto(origin);
    const reject = tab.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    await tab.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    await tab.locator('#authLoginEmail').fill(email);
    await tab.locator('#authLoginPassword').fill('FixturePassword1!');
    await tab.locator('#authLoginForm button[type=submit]').click();
    await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
    const settle = async () => {
      await tab.evaluate(() => document.fonts.ready);
      await tab.waitForFunction(() => !document.querySelector('#preloader') || getComputedStyle(document.querySelector('#preloader')).display === 'none' || getComputedStyle(document.querySelector('#preloader')).opacity === '0');
      await tab.waitForTimeout(350);
    };
    const record = async (name, screenshot = false) => {
      await settle();
      const result = await tab.evaluate(geometry);
      if (!result.content) throw Error(name + ': missing page content (check the fixture route)');
      report.push({ width, name, ...result });
      if (phase === 'after') {
        if (result.scrollWidth > result.clientWidth + 1) throw Error(name + ': horizontal overflow');
        if (result.footer) {
          if (['fixed', 'absolute', 'sticky'].includes(result.position)) throw Error(name + ': footer out of flow');
          if (Math.abs(result.footer.bottom - result.scrollHeight) > 2) throw Error(name + ': footer not at document end ' + JSON.stringify(result));
          if (result.footer.bottom < result.viewport.height - 1) throw Error(name + ': short page footer too high');
          if (result.copyright.left < 8 || result.copyright.right > result.clientWidth) throw Error(name + ': copyright clipped');
          if (result.content && name !== 'checkout' && result.footer.top < result.content.bottom - 1) throw Error(name + ': footer overlaps main');
        }
      }
      if (screenshot) {
        await tab.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await tab.screenshot({ path: `output/playwright/copyright/${phase}-${name}-${width}.png`, animations: 'disabled' });
        if (name === 'orders-populated' && width === 1366) {
          await tab.evaluate(() => scrollTo(0, 0));
          await tab.screenshot({ path: `output/playwright/copyright/${phase}-${name}-${width}-full.png`, fullPage: true, animations: 'disabled' });
        }
      }
    };
    await tab.goto(origin + '/cuenta');
    await tab.locator('#ordersEmpty').waitFor({ state: 'visible' });
    await record('orders-empty', true);
    for (const section of ['favorites', 'accreditation', 'account', 'orders']) {
      await tab.locator(`[data-profile-tab="${section}"]`).click();
      await record('account-' + section);
    }
    orders = Array.from({ length: 18 }, (_, i) => ({ id: 'LOCAL-' + (i + 1), createdAt: '2026-10-01T12:00:00Z', status: 'PAID', total: 25, currency: 'EUR' }));
    let releaseOrders;
    ordersGate = new Promise(resolve => { releaseOrders = resolve; });
    await tab.reload();
    await record('orders-loading');
    releaseOrders();
    ordersGate = null;
    await tab.locator('#ordersBody tr').first().waitFor();
    await record('orders-populated', true);
    await tab.locator('[data-profile-tab="favorites"]').click();
    await record('account-shrink-after-orders');
    await tab.setViewportSize({ width: 850, height: width });
    await record('account-landscape');
    await tab.setViewportSize({ width, height: 850 });
    await record('account-portrait-return');
    for (const [name, path] of [['favorites', '/favoritos'], ['cart-empty', '/cesta'], ['store', '/tienda'], ['product', '/producto/local-concurrency-tee'], ['about', '/sobre-cronox'], ['faq', '/faqs'], ['shipping', '/envios'], ['returns', '/devoluciones'], ['develop', '/desarrolla'], ['events', '/eventos'], ['privacy', '/privacidad'], ['cookies', '/cookies'], ['terms', '/terminos'], ['legal', '/aviso-legal']]) {
      await tab.goto(origin + path);
      await record(name, ['cookies', 'store'].includes(name));
      if (name === 'faq') {
        const answer = tab.locator('details summary').first();
        if (await answer.count()) { await answer.click(); await record('faq-open'); }
      }
    }
    const products = await (await context.request.get(origin + '/api/products')).json();
    const product = (products.items || products.data || products)[0];
    await tab.evaluate(id => window.CRONOX_API.addFavorite(id), product.id);
    await tab.goto(origin + '/favoritos');
    await tab.locator('.product-card').first().waitFor();
    await record('favorites-populated');
    await tab.goto(origin + '/cesta');
    await tab.waitForFunction(() => window.CRONOX_CART?.state?.status === 'empty');
    await tab.evaluate(id => window.CRONOX_CART.addCartItem({ variantId: id, qty: 1 }), product.variants[0].id);
    await tab.reload();
    await tab.locator('.cart-item:not(.empty)').first().waitFor();
    await record('cart-populated');
    await tab.goto(origin + '/checkout');
    await record('checkout');
    await context.close();
  }
  return { phase, scenarios: report.length, report };
}
