// Real local public routes. Read-only catalog/cart checks; no purchase or cart writes.
async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  await page.addLocatorHandler(page.locator('#authOverlay.is-open'), async overlay => {
    await overlay.locator('#authCloseBtn').click();
  });
  const routes = ['/', '/tienda', '/tienda?search=core', '/producto/ashen-shell', '/galeria',
    '/favoritos', '/cuenta', '/checkout', '/faqs', '/envios', '/devoluciones',
    '/desarrolla', '/eventos', '/privacidad', '/cookies', '/terminos', '/aviso-legal', '/sobre-cronox'];
  const results = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    let reference;
    for (const route of routes) {
      await page.goto(`http://localhost:3000${route}`);
      await page.waitForSelector('#btnMenu');
      await page.waitForFunction(() => !document.body.classList.contains('is-loading'));
      await page.evaluate(async () => { await window.CRONOX_STORE_CATEGORIES?.ready; await window.CRONOX_catalogReady; });
      const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
      if (await reject.isVisible()) await reject.click();
      const opener = page.locator('#btnMenu');
      const close = page.locator('#filtersPanel .filters-close');
      const inspect = async () => {
        const details = await page.locator('#filtersPanel').evaluate(panel => {
          const logo = panel.querySelector('.black-menu__brand');
          const close = panel.querySelector('.filters-close');
          const rect = panel.getBoundingClientRect(), logoRect = logo.getBoundingClientRect(), closeRect = close.getBoundingClientRect();
          const hit = document.elementFromPoint(closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2);
          return { top: rect.top, left: rect.left, width: rect.width, height: rect.height,
            logoLoaded: logo.complete && logo.naturalWidth > 0, logoSource: logo.getAttribute('src'),
            logoTop: logoRect.top, closeTop: closeRect.top, closeRight: closeRect.right,
            closeClickable: hit === close || close.contains(hit), inert: panel.inert,
            content: [...panel.querySelectorAll('.black-menu__link')].map(link => link.textContent),
            discover: panel.querySelector('.black-menu__discover').textContent,
            background: getComputedStyle(panel).backgroundColor, position: getComputedStyle(panel).position };
        });
        assert(details.logoLoaded && details.logoSource === '/favicon.png?v=4', `Loaded root logo: ${route}/${width}`);
        assert(details.closeClickable && !details.inert, `X clickable: ${route}/${width}`);
        assert(Math.abs(details.top) < 1 && Math.abs(details.left) < 1 && details.position === 'fixed', `Viewport anchoring: ${route}/${width}`);
        assert(details.logoTop >= 0 && details.closeTop >= 0 && details.closeRight <= width, 'Logo and X in viewport');
        if (!reference) reference = details;
        for (const property of ['width', 'height', 'content', 'discover', 'background', 'logoTop', 'closeTop', 'closeRight']) {
          const same = typeof details[property] === 'number'
            ? Math.abs(details[property] - reference[property]) < 1
            : JSON.stringify(details[property]) === JSON.stringify(reference[property]);
          assert(same, `Same ${property}: ${route}/${width}`);
        }
        assert(await page.locator('#filtersPanel').count() === 1, 'No duplicated menu');
      };
      await opener.click();
      await page.waitForFunction(() => Math.abs(document.querySelector('#filtersPanel').getBoundingClientRect().left) < 1);
      await page.locator('.black-menu__brand').evaluate(logo => logo.decode());
      await inspect();
      await close.click();
      await page.waitForSelector('#filtersPanel', { state: 'hidden' });
      assert(await opener.getAttribute('aria-expanded') === 'false', 'Opener state restored');
      await opener.click();
      await close.click();
      await page.waitForSelector('#filtersPanel', { state: 'hidden' });
      // Opening the menu at the footer must preserve the original scroll position.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const scroll = await page.evaluate(() => window.scrollY);
      await opener.click();
      await page.waitForFunction(() => Math.abs(document.querySelector('#filtersPanel').getBoundingClientRect().left) < 1);
      await inspect();
      if (['/producto/ashen-shell', '/galeria', '/checkout', '/faqs'].includes(route)) {
        await page.screenshot({ path: `output/playwright/shared-menu-${route.split('/')[1]}-${width}.png` });
      }
      await close.click();
      await page.waitForSelector('#filtersPanel', { state: 'hidden' });
      assert(Math.abs(await page.evaluate(() => window.scrollY) - scroll) <= 1, `Scroll restored: ${route}/${width}`);
      assert(await page.evaluate(() => !document.documentElement.classList.contains('has-scroll-lock')), 'Background unlocked');
      const cartIcon = page.locator('#cart-icon-btn');
      if (await page.locator('#cart-drawer').count()) {
        await cartIcon.click();
        await page.waitForFunction(() => document.querySelector('#cart-drawer').classList.contains('is-visible'));
        assert(await page.locator('#cart-drawer [data-open-filters], #cart-drawer .black-menu').count() === 0, 'No navigation inside cart drawer');
        assert(await page.locator('#filtersPanel').count() === 1, 'Background page keeps its navigation');
        assert(await page.evaluate(() => document.documentElement.classList.contains('has-scroll-lock')), 'Cart keeps scroll lock');
        assert(await page.locator('#cart-overlay').isVisible(), 'Cart retains its backdrop');
        await page.locator('#cart-close-btn').click();
        assert(await page.evaluate(() => !document.documentElement.classList.contains('has-scroll-lock')), 'Last panel releases lock');
        assert(Math.abs(await page.evaluate(() => window.scrollY) - scroll) <= 1, 'Cart/menu preserve footer scroll');
        await opener.click();
        await page.waitForFunction(() => Math.abs(document.querySelector('#filtersPanel').getBoundingClientRect().left) < 1);
        await inspect();
        await close.click();
        await page.waitForSelector('#filtersPanel', { state: 'hidden' });
      }
      results.push({ width, route, openCloseReopen: 'PASS', logoAndGeometry: 'PASS', footerScroll: scroll, cart: await page.locator('#cart-drawer').count() ? 'PASS' : 'No drawer on checkout' });
    }
  }
  assert(errors.length === 0, 'JavaScript errors: ' + errors.join('; '));
  return { results, pageErrors: errors };
}
