// Actual rendered text bounds, isolated APIs, no account or newsletter writes.
// Optional window.__footerBaseline accepts a previous measurement for unchanged
// end-block geometry checks. Also verifies resizing without page navigation.
async page => {
  const origin = 'http://127.0.0.1:4173';
  const baseline = await page.evaluate(() => window.__footerBaseline || null);
  const results = [];
  for (const path of ['/index.html', '/sobre-cronox.html']) {
    const context = await page.context().browser().newContext();
    await context.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/assets/runtime-config.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.__CRONOX_API_BASE__=location.origin;' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname.includes('/products') ? { items: [], meta: { total: 0, pageCount: 1 } } : {} });
      return route.continue();
    });
    const tab = await context.newPage();
    try {
      for (const width of [1366, 1440, 1920, 2560, 320, 375, 390, 430]) {
        await tab.setViewportSize({ width, height: 900 });
        if (tab.url() === 'about:blank') await tab.goto(origin + path);
        await tab.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
        await tab.locator('.site-footer').scrollIntoViewIfNeeded();
        const reject = tab.getByRole('button', { name: 'RECHAZAR', exact: true });
        if (await reject.isVisible()) await reject.click();
        const dismiss = tab.locator('.newsletter-modal-overlay--visible').getByRole('button', { name: /cerrar/i });
        if (await dismiss.isVisible()) await dismiss.click();
        await tab.locator('.site-footer').evaluate(async f => { await Promise.all([...f.querySelectorAll('img')].map(i => i.decode().catch(() => {}))); });
        const data = await tab.locator('.site-footer').evaluate(f => {
          const top = f.getBoundingClientRect().top;
          const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y - top, width: r.width, height: r.height, right: r.right }; };
          const bounds = e => {
            const ranges = [...e.querySelectorAll('h4,a')].flatMap(n => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()]; });
            return { left: Math.min(...ranges.map(r => r.left)), right: Math.max(...ranges.map(r => r.right)) };
          };
          const columns = [...f.querySelectorAll('.footer-acc-panel')].map(e => ({ box: box(e), ink: bounds(e), font: getComputedStyle(e.querySelector('h4')).font }));
          const brand = box(f.querySelector('.footer-brand-block')), social = box(f.querySelector('.footer-social')), newsletter = box(f.querySelector('.footer-newsletter-block'));
          const edge = Math.max(brand.right, social.right);
          const gaps = [columns[0].ink.left - edge, columns[1].ink.left - columns[0].ink.right, columns[2].ink.left - columns[1].ink.right, newsletter.x - columns[2].ink.right];
          const fixed = [...f.querySelectorAll('.footer-bottom,.footer-brand-block,.footer-brand-block *,.footer-newsletter-block,.footer-newsletter-block *,.footer-copy')].map(e => ({ tag: e.tagName, cls: e.className, box: box(e) }));
          return { height: f.getBoundingClientRect().height, brand, social, newsletter, columns, gaps, fixed, all: [...f.querySelectorAll('*')].map(e => ({ tag: e.tagName, box: box(e) })), overflow: document.documentElement.scrollWidth > innerWidth, instagram: f.querySelector('[data-footer-social]').href };
        });
        if (data.overflow) throw Error(`Horizontal overflow at ${path} ${width}`);
        if (width > 1100 && (data.gaps.some(g => g < 0) || Math.max(...data.gaps) - Math.min(...data.gaps) > 1)) throw Error(`Unequal desktop text gaps at ${path} ${width}`);
        if (width <= 430) {
          const triggers = tab.locator('.footer-acc-trigger');
          for (let i = 0; i < 3; i++) {
            await triggers.nth(i).click();
            if (await triggers.nth(i).getAttribute('aria-expanded') !== 'true') throw Error('Accordion failed');
            await triggers.nth(i).click();
          }
          data.accordions = true;
        }
        const previous = baseline?.find(b => b.path === path && b.width === width);
        if (previous && (data.height !== previous.height || JSON.stringify(data.fixed) !== JSON.stringify(previous.fixed) || (width <= 430 && JSON.stringify(data.all) !== JSON.stringify(previous.all)))) throw Error(`Fixed/mobile geometry changed at ${path} ${width}`);
        await tab.locator('.site-footer').screenshot({ path: `output/playwright/footer-spacing/current-${path.includes('sobre') ? 'about' : 'store'}-${width}.png` });
        results.push({ path, width, ...data });
      }
    } finally { await context.close(); }
  }
  return { passed: true, results };
}
