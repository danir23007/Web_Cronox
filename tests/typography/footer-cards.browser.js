// playwright-cli run-code --filename tests/typography/footer-cards.browser.js
// tests/cart/server.cjs serves static files; all APIs and products are fixtures.
async page => {
  const origin = 'http://127.0.0.1:4173';
  const stage = new URL(page.url()).searchParams.get('review') || 'before';
  const widths = [320, 390, 768, 1101, 1366, 1920, 2560];
  const products = ['CORE TEE', 'Camiseta washed edición limitada', 'Camiseta CRONOX con un nombre largo de varias líneas', 'SCARRED TEE', 'ASHEN SHELL', 'CORE TEE GREY'].map((name, i) => ({
    id: i + 1, slug: `visual-product-${i + 1}`, name, price: 3495,
    description: 'Prenda de algodón de prueba local.', category: { id: 1, name: 'Camisetas', slug: 'camisetas' },
    imageUrl: '/assets/products/camiseta_washed_' + (i % 2 ? 'gris' : 'negra') + '.png',
    images: [{ url: '/assets/products/camiseta_washed_' + (i % 2 ? 'gris' : 'negra') + '.png', isPrimary: true }],
    variants: [{ id: 101 + i, size: 'M', stock: i === 3 ? 0 : 50, stockQty: i === 3 ? 0 : 50, isActive: true }],
  }));
  const context = await page.context().browser().newContext({ deviceScaleFactor: 1 });
  const result = [], errors = [], navigationCancellations = [];
  await context.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    sessionStorage.setItem('cronoxNewsletterShown', 'true');
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const p = url.pathname;
    let data = {};
    if (p === '/api/products') data = { items: products, meta: { total: products.length } };
    else if (p.startsWith('/api/products/')) data = products.find(x => p.endsWith(x.slug)) || products[0];
    else if (p === '/api/categories') data = { items: [products[0].category] };
    else if (p === '/api/cart') data = { items: [], itemsCount: 0 };
    else if (p === '/api/favorites') data = products;
    else if (p === '/api/me') data = { id: 777, email: 'visual@example.test', role: 'USER', newsletterSubscribed: true };
    else if (p.startsWith('/api/auth/refresh')) return route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } });
    else if (p === '/api/auth/csrf') data = { csrfToken: 'visual-fixture' };
    return route.fulfill({ json: data });
  });
  const tab = await context.newPage();
  let replacingDocument = false;
  tab.on('request', r => { if (r.isNavigationRequest() && r.frame() === tab.mainFrame()) replacingDocument = true; });
  tab.on('framenavigated', frame => { if (frame === tab.mainFrame()) replacingDocument = false; });
  tab.on('pageerror', e => {
    // WebKit document-replacement cancellation: microsoft/playwright#43120.
    if (replacingDocument && e.stack?.startsWith('Fetch API cannot load ' + origin + '/api/') && e.message.endsWith(' due to access control checks.')) navigationCancellations.push(e.message);
    else errors.push(e.message);
  });
  const measure = () => tab.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const lines = el => {
      const range = document.createRange(); range.selectNodeContents(el);
      return [...new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)))].length;
    };
    const footer = document.querySelector('.site-footer');
    const paragraphs = [...document.querySelectorAll('.footer-newsletter-text,.footer-newsletter-legal')].map(el => ({ text: el.textContent.trim(), lines: lines(el), box: box(el), fontSize: getComputedStyle(el).fontSize }));
    const marks = [...document.querySelectorAll('.footer-primary-mark,.footer-secondary-logo,.footer-cx-logo')].map(el => ({ name: el.className, ...box(el) }));
    const cards = [...document.querySelectorAll('.product-card')].map(card => {
      const title = card.querySelector('.product-name'), price = card.querySelector('.product-price');
      const range = document.createRange(); range.selectNodeContents(title); const t = range.getBoundingClientRect();
      range.selectNodeContents(price); const p = range.getBoundingClientRect();
      return { title: title.textContent, price: price.textContent, lines: lines(title), textGap: p.top - t.bottom, boxGap: price.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
        titleClipped: title.scrollWidth > title.clientWidth + 1, priceClipped: price.scrollWidth > price.clientWidth + 1,
        textInsideInfo: p.bottom <= card.querySelector('.product-card__info').getBoundingClientRect().bottom + 1,
        info: box(card.querySelector('.product-card__info')), media: box(card.querySelector('.product-media')), favorite: Boolean(card.querySelector('.fav-toggle,.favorite-toggle')), quickAdd: Boolean(card.querySelector('.fav-add')) };
    });
    const instagram = document.querySelector('[data-footer-social=instagramUrl]');
    return { width: innerWidth, scale: visualViewport.scale, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      footer: footer && box(footer), brand: footer && box(footer.querySelector('.footer-brand-block')), paragraphs, marks, instagram: instagram && box(instagram), instagramCount: document.querySelectorAll('[data-footer-social=instagramUrl]').length,
      headings: [...document.querySelectorAll('.footer-title')].map(box), legalLinks: [...document.querySelectorAll('.footer-newsletter-legal a')].map(a => a.getAttribute('href')), cards };
  });
  try {
    for (const width of widths) {
      await tab.setViewportSize({ width, height: 960 });
      await tab.goto(origin + '/tienda');
      const reject = tab.getByRole('button', { name: 'RECHAZAR', exact: true });
      if (await reject.isVisible()) await reject.click();
      await tab.locator('#productsGrid .product-card').first().waitFor();
      await tab.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].filter(i => i.complete).map(i => i.decode().catch(() => {}))); });
      await tab.locator('.site-footer').scrollIntoViewIfNeeded();
      await tab.screenshot({ path: `output/playwright/footer-cards/${stage}-footer-viewport-${width}.png` });
      await tab.locator('.site-footer').screenshot({ path: `output/playwright/footer-cards/${stage}-footer-${width}.png` });
      const stats = await measure();
      // A full-page clip avoids the sticky topbar covering the first image row
      // when the grid is taller than the viewport.
      const captureCards = async label => {
        await tab.evaluate(() => window.scrollTo(0, 0));
        const clip = await tab.locator('#productsGrid').boundingBox();
        await tab.screenshot({ path: `output/playwright/footer-cards/${label}-cards-${width}.png`, fullPage: true, clip });
      };
      await captureCards(stage);
      if (stage === 'after') {
        // Reproduce exactly the single original card rule for an unobstructed
        // comparison. The working tree and all other styles stay untouched.
        const originalSpacing = await tab.addStyleTag({ content: '[data-cronox-surface="customer"] .product-card__info > :is(.product-price,.product-card__price-row){margin-top:auto}' });
        await captureCards('before');
        await originalSpacing.evaluate(el => el.remove());
      }
      if (width <= 480) {
        const panels = [];
        for (const button of await tab.locator('.footer-acc-trigger').all()) {
          await button.click(); await tab.waitForTimeout(350);
          const id = await button.getAttribute('aria-controls');
          panels.push(await tab.locator('#' + id).evaluate(el => ({ expanded: el.getAttribute('aria-hidden') === 'false', visibleHeight: el.clientHeight, naturalHeight: el.scrollHeight })));
        }
        stats.accordions = panels;
        await tab.locator('.site-footer').screenshot({ path: `output/playwright/footer-cards/${stage}-footer-open-${width}.png` });
        for (const button of await tab.locator('.footer-acc-trigger[aria-expanded="true"]').all()) await button.click();
        await tab.waitForTimeout(350);
        stats.closedAccordions = await tab.locator('.footer-acc-panel').evaluateAll(panels => panels.every(el => el.clientHeight === 0 && el.getAttribute('aria-hidden') === 'true'));
      }
      result.push({ page: 'catalogue', ...stats });
      if ([390, 1366, 1920, 2560].includes(width)) {
        await tab.goto(origin + '/producto/visual-product-1');
        await tab.locator('#relatedGrid .product-card').first().waitFor();
        await tab.evaluate(() => document.fonts.ready);
        await tab.locator('#relatedGrid').screenshot({ path: `output/playwright/footer-cards/${stage}-recommendations-${width}.png` });
        result.push({ page: 'recommendations', ...await measure() });
        await tab.goto(origin + '/favoritos');
        await tab.locator('.product-card').first().waitFor();
        await tab.evaluate(() => document.fonts.ready);
        result.push({ page: 'favorites', ...await measure() });
      }
    }
    const extra = [];
    if (stage === 'after') {
      products[1].price = 2995;
      for (const width of [390, 1366]) {
        await tab.setViewportSize({ width, height: 960 });
        await tab.goto(origin + '/tienda');
        await tab.locator('#productsGrid .product-card').first().waitFor();
        await tab.evaluate(() => document.fonts.ready);
        const sale = await measure();
        if (!sale.cards.some(card => card.price.includes('29,95'))) throw new Error('Reduced-price fixture did not reach the real card renderer');
        await tab.evaluate(() => window.scrollTo(0, 0));
        await tab.screenshot({ path: `output/playwright/footer-cards/after-cards-sale-${width}.png`, fullPage: true, clip: await tab.locator('#productsGrid').boundingBox() });
        await tab.locator('.product-card .fav-add').first().click();
        await tab.locator('.qa-overlay[aria-hidden="false"]').waitFor();
        await tab.locator('.qa-close').click();
        await tab.locator('#cart-icon-btn').click();
        await tab.locator('.cart-upsell__item').first().waitFor();
        const upsell = await tab.locator('.cart-upsell__item').evaluateAll(items => items.map(item => {
          const name = item.querySelector('.cart-upsell__name').getBoundingClientRect();
          const price = item.querySelector('.cart-upsell__price').getBoundingClientRect();
          return { gap: price.top - name.bottom, priceWidth: price.width, overflow: item.scrollWidth > item.clientWidth + 1 };
        }));
        await tab.locator('#cart-close-btn').click();
        await tab.goto(origin + '/sobre-cronox.html');
        await tab.evaluate(() => document.fonts.ready);
        extra.push({ width, saleCards: sale.cards, quickAddOpened: true, upsell, aboutFooter: await measure() });
      }
    }
    if (stage === 'after') {
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
      for (const view of result) {
        const label = `${view.page} at ${view.width}px`;
        check(!view.horizontalOverflow && view.scale === 1, `${label}: overflow or changed zoom`);
        check(view.cards.every(card => card.boxGap === 0 && !card.titleClipped && !card.priceClipped && card.textInsideInfo && card.favorite && card.quickAdd), `${label}: card layout or controls`);
        if (view.page !== 'catalogue') continue;
        check(view.instagramCount === 1 && view.instagram.width === 44 && view.instagram.height === 44, `${label}: Instagram target`);
        check(view.legalLinks.join(',') === '/terminos,/privacidad', `${label}: legal links`);
        const centers = view.marks.map(mark => mark.x + mark.width / 2);
        check(Math.max(...centers) - Math.min(...centers) < 1 && view.marks.every((mark, i) => i === 0 || view.marks[i - 1].bottom < mark.y), `${label}: logo column`);
        if (view.width >= 1101) {
          check(view.paragraphs.every(paragraph => paragraph.lines === 1), `${label}: newsletter wrapping`);
          // Copyright now occupies its own final row; brand alignment belongs
          // to the commercial row, independently of that final text inset.
          check(Math.abs(view.instagram.y + 22 - (view.brand.y + view.brand.height / 2)) < 1, `${label}: Instagram centering`);
        }
        if (view.width <= 480) check(view.closedAccordions && view.accordions.every(panel => panel.expanded && panel.visibleHeight >= panel.naturalHeight), `${label}: accordion clipping`);
      }
      for (const view of extra) {
        check(view.saleCards.some(card => card.price.includes('29,95')) && view.saleCards.every(card => card.boxGap === 0), `Reduced-price cards at ${view.width}px`);
        check(view.upsell.length > 0 && view.upsell.every(item => !item.overflow && item.gap === 8), `Cart recommendations at ${view.width}px`);
        check(!view.aboutFooter.horizontalOverflow && view.aboutFooter.legalLinks.join(',') === '/terminos,/privacidad', `About footer at ${view.width}px`);
      }
    }
    return { stage, errors, navigationCancellations, result, extra };
  } finally { await context.close(); }
}
