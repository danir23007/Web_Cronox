// Run with playwright-cli run-code --filename. Public local reads, no data writes.
async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const results = [];
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  const ready = async () => {
    await page.evaluate(async () => {
      await window.CRONOX_STORE_CATEGORIES?.ready;
      await window.CRONOX_catalogReady;
    });
    await page.locator('#preloader').waitFor({ state: 'detached' });
  };
  const dismissCookies = async () => {
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://localhost:3000/index.html'); await ready(); await dismissCookies();
    const categories = await page.evaluate(() => window.CRONOX_API.getAllCategories());
    const choices = [categories.find(c => c.slug === 'camisetas'), categories.find(c => c.group === 'DROP'), { name: 'Todos', slug: '' }];
    for (const choice of choices) {
      assert(choice, 'Local category fixture exists');
      await page.goto('http://localhost:3000/index.html'); await ready();
      const homeUrl = page.url();
      await page.locator('#btnMenu').click();
      assert(page.url() === homeUrl && await page.locator('#hero').isVisible(), 'Opening menu preserves home');
      await page.locator('#storeCategoryFilters').getByRole('link', { name: choice.name, exact: true }).click();
      await page.waitForURL('**/tienda*'); await ready();
      assert(!await page.locator('#hero').isVisible(), 'Filtered view removes hero');
      const expected = await page.evaluate(async slug => slug
        ? (await window.CRONOX_API.getCategoryProducts(slug, { page: 1, limit: 100 })).products
        : await window.CRONOX_API.getProducts({ limit: 48 }), choice.slug);
      assert(JSON.stringify(await page.locator('#productsGrid .product-name').allTextContents()) === JSON.stringify(expected.map(p => p.name)), 'Exact API category membership and order');
      const layout = await page.evaluate(() => ({
        header: document.querySelector('#topbar').getBoundingClientRect().bottom,
        first: document.querySelector('#productsGrid .product-card')?.getBoundingClientRect().top,
        heroHeight: document.querySelector('#hero').getBoundingClientRect().height,
      }));
      assert(layout.heroHeight === 0 && layout.first >= layout.header && layout.first < 900, 'Products visible below header without hero gap');
      await page.screenshot({ path: `output/playwright/home-filter-${width}-${choice.slug ? choice.slug.replace(/[^a-z0-9]/g, '-') : 'todos'}.png` });
      results.push({ width, choice: choice.name, count: expected.length, ...layout });
    }
    await page.locator('.topbar__logo').click(); await ready();
    assert(new URL(page.url()).pathname === '/' && await page.locator('#hero').isVisible(), 'Home logo restores normal cover');
  }
  for (const size of [{ width: 2560, height: 1440 }, { width: 2560, height: 1280 }, { width: 1920, height: 1200 }, { width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.goto('http://localhost:3000/producto/black-core-tee');
    await page.locator('#pName').filter({ hasText: 'CORE TEE' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#relatedGrid .product-card').length > 0);
    await dismissCookies();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll('.pdp__media img, #pThumbs img')]
        .filter(image => image.src).map(image => image.decode().catch(() => {})));
    });
    const measure = () => page.evaluate(() => {
      const rect = s => document.querySelector(s).getBoundingClientRect().toJSON();
      const photo = rect('.pdp__media'), thumbs = rect('#pThumbs'), heading = rect('.store-headline'), products = rect('#relatedGrid');
      const firstCard = rect('#relatedGrid .product-card');
      return { photo, thumbs, heading, productsTop: products.top, cardWidth: firstCard.width, cardHeight: firstCard.height,
        titleFont: getComputedStyle(document.querySelector('.store-headline')).font,
        gapToProducts: products.top - heading.bottom, gapFromPhotos: heading.top - thumbs.bottom };
    });
    const after = await measure();
    // Replay the previous spacing only to compare geometry in the same browser.
    const prior = await page.addStyleTag({ content: '@media(min-width:900px){.page-product .pdp__grid{min-height:0;align-items:normal;}.page-product .pdp-related{margin-top:0;padding-top:12px;}.page-product .pdp-related>.store-headline{margin-top:0;}}' });
    const before = await measure();
    await prior.evaluate(node => node.remove());
    assert(JSON.stringify(after.photo) === JSON.stringify(before.photo) && JSON.stringify(after.thumbs) === JSON.stringify(before.thumbs), 'Photo dimensions and placement preserved');
    assert(Math.abs(after.gapToProducts - before.gapToProducts) < .1, 'Title/product spacing preserved');
    assert(after.cardWidth === before.cardWidth && after.cardHeight === before.cardHeight && after.titleFont === before.titleFont, 'Cards and typography preserved');
    if (size.width >= 900) {
      assert(after.gapFromPhotos > before.gapFromPhotos && after.gapFromPhotos >= 36, 'Whole recommended block moves downward with gallery clearance');
      assert(after.productsTop > size.height, 'Recommended products remain below the initial desktop screen');
    }
    else assert(JSON.stringify(after) === JSON.stringify(before), 'Mobile layout unchanged');
    if (size.height >= 1200 && size.width >= 1920) {
      assert(after.heading.bottom <= size.height && size.height - after.heading.bottom <= 12.1, 'Complete title near lower edge of reference desktop');
    }
    await page.screenshot({ path: `output/playwright/recommended-layout-${size.width}x${size.height}.png` });
    results.push({ ...size, gapBefore: before.gapFromPhotos, gapAfter: after.gapFromPhotos, titleBottom: after.heading.bottom, productsTop: after.productsTop, productGap: after.gapToProducts });
  }
  return { source: 'real local catalog; baseline CSS replay only for layout comparison', results };
}
