// Run with playwright-cli -s=typography-states run-code --filename this-file.
// Start tests/cart/server.cjs first. Every API response is synthetic; external
// requests are blocked, including Stripe, so no payment or real write can occur.
async (page) => {
  const origin = 'http://127.0.0.1:4173';
  const results = [], requests = [], errors = [];
  const state = { signedIn: false, level: 1, renderer: 'original' };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const name = 'Alejandra Isabel de los Ángeles Fernández Montenegro';
  const user = { id: 777, email: 'typography@example.test', firstName: 'Alejandra Isabel de los Ángeles', lastName: 'Fernández Montenegro',
    memberCode: 'CRX-000777', circleLevel: 5, role: 'USER', hasPassword: true, createdAt: '2020-01-01T23:30:00Z' };
  const products = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, slug: `type-product-${i + 1}`,
    name: i ? `Camiseta CRONOX-23 colección número ${i + 1} (10%)` : 'Camiseta CRONOX-001 edición especial con un nombre de producto extraordinariamente largo',
    description: 'Prenda de algodón, edición limitada. Descripción con tildes, ñ y tallas variadas.',
    price: i ? 3500 : 999999, compareAtPrice: i ? 4900 : 1199999, currency: 'EUR', imageUrl: '/assets/logo_banner.png',
    category: { id: 1, slug: 'camisetas', name: 'Camisetas' }, images: [{ url: '/assets/logo_banner.png', isPrimary: true }],
    variants: [{ id: 101 + i, size: 'M', stock: 50, stockQty: 50, isActive: true }, { id: 201 + i, size: 'XL', stock: 3, stockQty: 3, isActive: true }] }));
  const cart = { id: 1, items: products.slice(0, 3).map(product => ({ id: product.id, variantId: product.variants[0].id,
    qty: 1, priceAtAdd: product.price, variant: { ...product.variants[0], product } })), itemsCount: 3, subtotal: 1069999 };
  const qr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAAAklEQVR4AewaftIAAAW4SURBVO3BUY4jVxIEQY8E73/l2PkVtPUAkaKqutPN0j+QtNIgaa1B0lqDpLUGSWsNktYaJK01SFprkLTWIGmtQdJag6S1BklrDZLWGiStNUhaa5C01iBprUHSWoOktQZJaw2S1hokrTVIWmuQtNYgaa1B0lqDpLUGSWsNktYaJK01SFrrxc2S8Bu15V1J+ERbTpJwpS1PlYTfqC13GSStNUhaa5C01iBprUHSWoOktV48WFueKglPlYSnSsKVtnyiLU+VhCcaJK01SFprkLTWIGmtQdJag6S1BklrvfjBkvAtbfmmJFxpy0kSPtGWb0nCSVvukoRvactPNEhaa5C01iBprUHSWoOktQZJaw2S1nqhdZJwpS2faMtJEq60Rf+tQdJag6S1BklrDZLWGiStNUhaa5C01gs9ThJO2nKShHcl4aQtJ0k4aYueY5C01iBprUHSWoOktQZJaw2S1nrxg7XlN2rLJ9ryriScJOGnaov+apC01iBprUHSWoOktQZJaw2S1hokrfXiwZKgv0vCSVtOknClLSdJOGnLSRKutOUTSdA/M0haa5C01iBprUHSWoOktQZJaw2S1npxs7bon2nLtyThpC13aYv+XYOktQZJaw2S1hokrTVIWmuQtNYgaa0XN0vClbacJOGp2nLSlncl4VvacpKEk7Z8SxKeqi0/0SBprUHSWoOktQZJaw2S1hokrZX+wUMl4RNteVcSTtryUyXhSls+kYR3teWpkvAtbbnLIGmtQdJag6S1BklrDZLWGiStNUha64XekoSTtpwk4UpbTpLwGyXhLm35RFt+okHSWoOktQZJaw2S1hokrTVIWmuQtNaLmyXhSltOknCShG9py13acpKEk7a8KwknbTlJwpW23CUJJ235RBKutOUug6S1BklrDZLWGiStNUhaa5C01iBprRf6v9pykoRPtOVdSbhLW+6ShE+05UpbvqktTzRIWmuQtNYgaa1B0lqDpLUGSWu9eLAknLTlJAknbbmShJO2nCThXUk4acsnkvBESThpy1Ml4aQtTzRIWmuQtNYgaa1B0lqDpLUGSWsNktZK/+BGSbjSlpMknLTlJAlX2nKShJO2/ERJuEtbPpGEk7ZcScJd2nKXQdJag6S1BklrDZLWGiStNUhaa5C01gu9pS0nSThpy12S8K62fEsSTtpy0paTJFxpyyeScNKWJxokrTVIWmuQtNYgaa1B0lqDpLUGSWu9+MWScNKWdyXhpC0nSfiWtryrLSdJuEsS7pKEk7acJOFKW+4ySFprkLTWIGmtQdJag6S1BklrpX+g/1wSrrTlp0rCu9ryTUm40paTJJy05ScaJK01SFprkLTWIGmtQdJag6S1BklrvbhZEn6jtpy05UoSTtpykoR3teWpknDSlnclYaNB0lqDpLUGSWsNktYaJK01SFprkLTWiwdry1Ml4RNJeFcSPtGWdyXhLm35lracJOETSbjSlrsMktYaJK01SFprkLTWIGmtQdJag6S1XvxgSfiWtujv2vKJJFxJwl2ScNKWkySctOWJBklrDZLWGiStNUhaa5C01iBprRd6nLZ8UxJ+o7Z8SxJO2nKShCttucsgaa1B0lqDpLUGSWsNktYaJK01SFrrhX6cJJy05aQtV5LwibY8VRL0V4OktQZJaw2S1hokrTVIWmuQtNYgaa0XP1hbfqq2XEnCSVs+kYR3teUkCe9qy0kS7tKWT7TliQZJaw2S1hokrTVIWmuQtNYgaa1B0lovHiwJv1USrrTlJAknbXlXW06ScNKWb2nLT5WEK225yyBprUHSWoOktQZJaw2S1hokrZX+gaSVBklrDZLWGiStNUhaa5C01iBprUHSWoOktQZJaw2S1hokrTVIWmuQtNYgaa1B0lqDpLUGSWsNktYaJK01SFprkLTWIGmtQdJag6S1BklrDZLWGiStNUhaa5C01iBprf8B8YyHC96PrU0AAAAASUVORK5CYII=';
  await page.unrouteAll({ behavior: 'wait' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    sessionStorage.setItem('cronox_newsletter_seen', '1');
    document.cookie = 'cronox_cookie_consent=' + encodeURIComponent(JSON.stringify({ necessary: true, preferences: false,
      analytics: false, marketing: false, consentVersion: '2', timestamp: new Date().toISOString() })) + '; path=/';
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname;
    requests.push({ path, method: request.method() });
    let data = {};
    if (path === '/api/auth/csrf') data = { csrfToken: 'local-typography-fixture' };
    else if (path === '/api/me') data = state.signedIn ? user : null;
    else if (path === '/api/products') data = { items: products, meta: { total: products.length } };
    else if (path.startsWith('/api/products/')) data = products.find(product => path.endsWith(product.slug)) || products[0];
    else if (path === '/api/categories') data = { items: [{ id: 1, name: 'Camisetas', slug: 'camisetas', isActive: true }], meta: { total: 1 } };
    else if (path.startsWith('/api/categories/')) data = { category: products[0].category, products: { items: products, meta: { total: products.length } } };
    else if (path === '/api/cart') data = cart;
    else if (path === '/api/favorites') data = products.slice(0, 2);
    else if (path === '/api/me/address') data = null;
    else if (path === '/api/me/addresses') data = [];
    else if (path === '/api/checkout/summary') {
      const shipping = { id: 1, code: 'STANDARD', label: 'Envío estándar a domicilio', priceCents: 490, amountCents: 0 };
      data = { cart, currency: 'EUR', shippingMethods: [shipping], selectedShippingMethod: shipping,
        totals: { subtotalCents: cart.subtotal, discountCents: 100000, shippingCents: 0, totalCents: cart.subtotal - 100000 } };
    } else if (path === '/api/me/orders') data = [{ id: 99001, createdAt: '2026-10-19T10:00:00Z', status: 'SHIPPED',
      total: '9.999,99', currency: 'EUR', shippingCarrier: 'Correos', trackingNumber: 'TEST-NOT-REAL', trackingState: 'En tránsito al domicilio del destinatario',
      trackingUrl: 'https://www.correos.es/' }];
    else if (path.endsWith('/tracking')) data = { events: [{ occurredLocalAt: '19/10/2026 12:00', description: 'En tránsito. Información ficticia.', source: 'Prueba local' }] };
    else if (path === '/api/accreditations/active') data = { id: state.renderer, renderer: `${state.renderer}-v1`, config: { version: 1, artworkUrl: '/assets/logo_banner.png' } };
    else if (path === '/api/membership/me/accreditation') data = { circleLevel: state.level, name, createdAt: user.createdAt,
      visibleId: '11111111-2222-4333-8444-555555555555', registrationNumber: 777, memberCode: user.memberCode, qrDataUrl: qr };
    else if (path === '/api/membership/me/qr') return route.fulfill({ contentType: 'image/png', body: Buffer.from(qr.split(',')[1], 'base64') });
    else if (path === '/api/membership/me/stats') data = { circleLevel: state.level, createdAt: user.createdAt, ordersCount: 18, itemsNetCount: 23, productosDiferentes: 7 };
    else if (path.includes('circle-upgrade')) data = { circleLevel: state.level, hasPending: false, canRequest: false };
    else if (path === '/api/auth/login') return route.fulfill({ status: 401, json: { message: 'El correo o la contraseña no son correctos.' } });
    else if (request.method() !== 'GET' && !['/api/auth/visit', '/api/live-stats/presence'].includes(path)) return route.fulfill({ status: 400, json: { message: 'Operación de prueba bloqueada; no se ha guardado nada.' } });
    return route.fulfill({ json: data });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const wait = async () => {
    await page.waitForFunction(() => {
      const loader = document.getElementById('preloader');
      return !loader || (document.body.classList.contains('is-loaded') && Number(getComputedStyle(loader).opacity) === 0);
    });
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  };
  const audit = async (label, screenshot = false) => {
    await wait();
    const result = await page.evaluate(label => {
      const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'
        && !element.closest('[hidden],[aria-hidden="true"]') && !element.closest('svg');
      const candidates = [...document.querySelectorAll('body *')].filter(element => visible(element) && !element.closest('.ascii-overlay')
        && ([...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()) || element.matches('input,textarea,select')));
      const numericCircle = element => element.matches('[data-circle-numeral],[data-crx-roman],[data-meta-circle],[data-meta-circle-marker],[data-acc-stat="circle"]');
      const wrong = candidates.filter(element => !numericCircle(element) && !getComputedStyle(element).fontFamily.startsWith('"Cormorant Garamond"')).map(element => ({
        tag: element.tagName, id: element.id, class: element.className, text: element.textContent.trim().slice(0, 60), font: getComputedStyle(element).fontFamily }));
      const clippedControls = [...document.querySelectorAll('button,select')].filter(element => visible(element) && element.textContent.trim()
        && (element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2)).map(element => ({ id: element.id,
          class: element.className, text: element.textContent.trim().slice(0, 60), width: element.clientWidth, scrollWidth: element.scrollWidth,
          height: element.clientHeight, scrollHeight: element.scrollHeight }));
      const clippedProductText = [];
      for (const element of document.querySelectorAll('.product-name,.product-price,.stock-status')) {
        if (!visible(element)) continue;
        const range = document.createRange(); range.selectNodeContents(element);
        for (let ancestor = element; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect();
          const clipsX = ['hidden', 'clip'].includes(style.overflowX), clipsY = ['hidden', 'clip'].includes(style.overflowY);
          if (!clipsX && !clipsY) continue;
          if ([...range.getClientRects()].some(rect => clipsX && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
            || clipsY && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1))) {
            clippedProductText.push({ class: element.className, text: element.textContent, ancestor: ancestor.className });
          }
        }
      }
      const productCards = [...document.querySelectorAll('.product-card')].filter(visible).map(card => {
        const bounds = card.getBoundingClientRect(), media = card.querySelector('.product-media')?.getBoundingClientRect();
        const price = card.querySelector('.product-price');
        return { top: Math.round(bounds.top), height: bounds.height, mediaRatio: media ? media.width / media.height : null,
          price: price?.textContent, priceBottom: price?.getBoundingClientRect().bottom, cardBottom: bounds.bottom };
      });
      const rows = new Map();
      for (const card of productCards) rows.set(card.top, [...(rows.get(card.top) || []), card.height]);
      const unevenProductRows = [...rows].filter(([, heights]) => Math.max(...heights) - Math.min(...heights) > 1);
      return { label, width: innerWidth, checked: candidates.length, wrong, clippedControls, clippedProductText, productCards, unevenProductRows,
        documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        fontLoaded: [...document.fonts].some(face => face.family === 'Cormorant Garamond' && face.status === 'loaded'),
        fontCheck: document.fonts.check('400 16px "Cormorant Garamond"', 'Español 9.999,99 €') };
    }, label);
    results.push(result);
    if (screenshot) {
      await page.screenshot({ path: `output/playwright/typography/states-${label}-${result.width}.png`, fullPage: true });
      if (label === 'shop') {
        // External hero media is intentionally blocked. Also capture the real
        // shop viewport after scrolling, with the header's normal page colors.
        await page.evaluate(() => window.scrollTo(0, document.querySelector('.products-grid').getBoundingClientRect().top + scrollY - 90));
        await page.waitForFunction(() => {
          const header = document.getElementById('topbar');
          const logo = header.querySelector('.topbar__logo-img');
          return !header.classList.contains('topbar--transparent') && getComputedStyle(header).color === 'rgb(255, 255, 255)'
            && (!logo || getComputedStyle(logo).filter === 'none');
        });
        await page.screenshot({ path: `output/playwright/typography/states-shop-products-${result.width}.png` });
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
  };
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1366, 768], [1920, 1080], [2560, 1440]]) {
    const capture = width === 390 || width === 1366;
    await page.setViewportSize({ width, height });
    state.signedIn = false;
    await page.goto(`${origin}/index.html`);
    await page.waitForFunction(() => typeof window.CRONOX_openAuthModal === 'function');
    await page.locator('.product-card').first().waitFor();
    await audit('shop', capture);
    if (width <= 480) for (const trigger of await page.locator('.footer-acc-trigger').all()) {
      await trigger.click();
      await page.waitForFunction(() => {
        const panel = document.querySelector('.footer-acc-item.is-open .footer-acc-panel');
        if (!panel) return false;
        const links = [...panel.querySelectorAll('a')];
        const bottom = Math.max(...links.map(link => link.getBoundingClientRect().bottom));
        return bottom <= panel.getBoundingClientRect().bottom + 1
          && document.querySelector('.footer-newsletter-block').getBoundingClientRect().top > bottom + 12;
      });
    }
    await audit('footer-open');
    await page.locator('.site-footer').screenshot({ path: `output/playwright/typography/states-footer-${width}.png` });
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('#btnMenu').click();
    await audit('menu', capture);
    await page.keyboard.press('Escape');
    await page.locator('#btnSearch').click();
    await page.locator('#searchInput').fill('Camiseta');
    await page.locator('#searchForm').evaluate(form => form.requestSubmit());
    await audit('search');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.CRONOX_openAuthModal('login'));
    await page.locator('#authLoginForm button[type=submit]').click();
    await audit('auth-validation', capture);
    await page.locator('#authCloseBtn').click();
    await page.locator('#cart-icon-btn').click();
    await page.locator('.cart-line').first().waitFor();
    await page.waitForFunction(() => {
      const box = document.querySelector('.cart-drawer__panel').getBoundingClientRect();
      return box.right <= innerWidth + 1 && box.left >= -1;
    });
    await audit('mini-cart', capture);
    await page.goto(`${origin}/cart.html`);
    await page.locator('.cart-item,.cart-line').first().waitFor();
    await audit('cart', capture);
    await page.goto(`${origin}/checkout.html`);
    await page.locator('#checkout-guest-email').waitFor();
    await page.locator('#checkout-guest-email').fill('correo-invalido');
    await page.locator('#checkout-guest-email').blur();
    await audit('checkout', capture);
    state.signedIn = true;
    await page.goto(`${origin}/profile.html`);
    await page.locator('[data-profile-tab="orders"]').click();
    await page.locator('#ordersBody tr').first().waitFor();
    await page.locator('#ordersBody details summary').first().click();
    await audit('orders', capture);
    await page.locator('[data-profile-tab="account"]').click();
    await audit('profile', capture);
    state.renderer = 'original';
    await page.locator('[data-profile-tab="accreditation"]').click();
    await page.locator('.crx-accreditation-book').waitFor();
    await audit('accreditation-original', capture);
    state.renderer = 'metacrilatos';
    for (const level of [1, 2, 3, 4, 5]) {
      state.level = level;
      await page.locator('[data-profile-tab="orders"]').click();
      await page.locator('[data-profile-tab="accreditation"]').click();
      await page.locator(`.crx-metacrilatos[data-crx-level="${level}"]`).waitFor();
      await audit(`accreditation-${level}`, capture && (level === 1 || level === 5));
      await page.locator('[data-crx-flip]').click();
      await page.waitForFunction(() => document.querySelector('[data-crx-flip]').textContent === 'Ver anverso');
      await audit(`accreditation-${level}-back`, capture && (level === 1 || level === 5));
    }
  }
  const failures = results.filter(result => !result.fontLoaded || !result.fontCheck || result.wrong.length || result.documentOverflow || result.clippedControls.length || result.clippedProductText.length || result.unevenProductRows.length);
  console.log(JSON.stringify({ cases: results.length, failures, results, errors, simulatedRequests: requests }, null, 2));
  assert(!errors.length, `Page errors: ${errors.join('; ')}`);
  assert(!failures.length, `${failures.length} typography/layout audits failed; inspect reported results and screenshots`);
  return { cases: results.length, passed: true, allApiIntercepted: true, realWrites: 0, results,
    simulatedMutationEndpoints: [...new Set(requests.filter(request => request.method !== 'GET').map(request => request.path))] };
}
