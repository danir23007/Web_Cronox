// Run through playwright-cli run-code with the normal local backend running.
async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'), async overlay => {
    await overlay.getByRole('button', { name: /cerrar/i }).click();
  });
  const results = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('http://localhost:3000/tienda');
    await page.evaluate(() => window.CRONOX_catalogReady);
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    await page.locator('#btnMenu').click();
    await page.waitForSelector('#storeCategoryFilters');
    const categories = await page.evaluate(() => window.CRONOX_API.getAllCategories());
    const drop = categories.find(category => category.group === 'DROP');
    assert(drop, 'Drop exists in local catalog');
    const all = await page.evaluate(() => window.CRONOX_API.getProducts({ limit: 48 }));
    const row = slug => page.locator('label.black-menu__category-row').filter({ has: page.locator(`input[value="${slug}"]`) });
    const names = () => page.locator('#productsGrid .product-name').allTextContents();
    const verify = async slug => {
      await row(slug).click();
      await page.evaluate(() => window.CRONOX_catalogReady);
      const expected = slug ? await page.evaluate(async value => (await window.CRONOX_API.getCategoryProducts(value, { page: 1, limit: 100 })).products, slug) : all;
      assert(JSON.stringify(await names()) === JSON.stringify(expected.map(product => product.name)), `Exact catalog and order for ${slug || 'Todos'} at ${width}`);
      const selected = await page.locator('[data-store-category]:checked').evaluateAll(inputs => inputs.map(input => input.value));
      assert(JSON.stringify(selected) === JSON.stringify([slug]), 'Exactly one highlighted radio');
      const params = new URL(page.url()).searchParams.getAll('categorySlug');
      assert(JSON.stringify(params) === JSON.stringify(slug ? [slug] : []), 'Single URL selection');
      return expected.length;
    };
    const counts = {};
    for (const slug of ['pantalones', 'chaquetas', 'camisetas', drop.slug, drop.slug, '']) counts[slug || 'todos'] = await verify(slug);
    await row('camisetas').click();
    await page.evaluate(() => window.CRONOX_catalogReady);
    await row('camisetas').locator('input').focus();
    await page.keyboard.press('Space');
    assert(await row('camisetas').locator('input').isChecked(), 'Active option remains checked using keyboard');
    await page.screenshot({ path: `output/playwright/single-category-${width}.png` });
    // Explicit empty response only for the empty-state check; no database edits.
    await page.route('**/api/categories/pantalones/products?*', async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.products.items = []; body.products.meta.total = 0; body.products.meta.pageCount = 1;
      await route.fulfill({ response, json: body });
    });
    await row('pantalones').click();
    await page.evaluate(() => window.CRONOX_catalogReady);
    assert((await names()).length === 0, 'Empty option shows no cards');
    assert(await page.locator('#productsFallback').isVisible(), 'Empty message visible');
    assert((await page.locator('#productsFallback').textContent()).includes('No hay productos disponibles en esta categoría.'), 'Correct empty category message');
    await page.unroute('**/api/categories/pantalones/products?*');
    await verify('');
    await page.keyboard.press('Escape');
    // Direct entry, normalization and reload must restore only one category.
    await page.goto('http://localhost:3000/tienda?categorySlug=camisetas&categorySlug=chaquetas');
    await page.evaluate(() => window.CRONOX_catalogReady);
    await page.locator('#btnMenu').click();
    await page.waitForSelector('#storeCategoryFilters');
    await verify('chaquetas');
    await page.reload();
    await page.evaluate(() => window.CRONOX_catalogReady);
    await page.locator('#btnMenu').click();
    await page.waitForSelector('#storeCategoryFilters');
    await verify('chaquetas');
    await verify('');
    results.push({ width, counts, sequences: 'PASS', emptyResponse: 'PASS', keyboard: 'PASS', URLAndReload: 'PASS' });
  }
  assert(errors.length === 0, 'JavaScript errors: ' + errors.join('; '));
  return results;
}
