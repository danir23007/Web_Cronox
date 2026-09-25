const { test, expect } = require('@playwright/test');
for (const width of [1366, 390]) {
  test(`server metadata survives rendering and variant selection at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const violations = [];
    await page.addInitScript(() => {
      window.__CRONOX_API_BASE__ = location.origin;
      window.__seoViolations = [];
      document.addEventListener('securitypolicyviolation', e => window.__seoViolations.push(e.violatedDirective));
    });
    await page.goto('/');
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(page).toHaveTitle('Cronox — Ropa y tienda oficial');
    expect(await page.locator('script[type="application/ld+json"]').count()).toBe(1);
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', 'Cronox');
    expect(await page.locator('a[href*="@tu_cuenta"]').count()).toBe(0);
    await page.goto('/producto/seo-test-shirt?size=M');
    await expect(page.locator('.size-btn.is-active')).toHaveAttribute('data-size', 'M');
    await expect(page.locator('#pAdd')).toBeDisabled();
    await expect(page.locator('#pPrice')).toContainText('45,00');
    await expect(page).toHaveTitle('Camiseta de prueba SEO | Cronox');
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://cronox.es/producto/seo-test-shirt');
    const group = JSON.parse(await page.locator('#cronox-seo').textContent());
    expect(group.hasVariant[1].offers.price).toBe('45.00');
    expect(group.hasVariant[1].offers.availability).toBe('https://schema.org/OutOfStock');
    // Dismiss consent only in the local synthetic server, never in production.
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    await page.locator('.size-btn[data-size=S]').click();
    await expect(page.locator('#pPrice')).toContainText('40,00');
    await expect(page.locator('#pAdd')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    violations.push(...await page.evaluate(() => window.__seoViolations));
    expect(violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`product-${width}.png`), fullPage: true });
    const missing = await page.goto('/producto/no-existe');
    expect(missing.status()).toBe(404);
    await expect(page.locator('#pName')).toHaveText('Producto no disponible');
    expect(await page.locator('#cronox-seo').count()).toBe(0);
  });
}
test('initial HTML remains useful without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4177/');
  await expect(page.locator('#productsGrid a')).toBeVisible();
  await expect(page.locator('#preloader')).toBeHidden();
  await page.locator('#productsGrid a').click();
  await expect(page.locator('#pName')).toHaveText('Camiseta de prueba SEO');
  await expect(page.locator('#pDesc')).toContainText('algodón');
  await context.close();
});

test('direct product survives omission from the first catalogue page', async ({ page }) => {
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  await page.route('**/api/products', route => route.fulfill({ json: { items: [], meta: { total: 0 } } }));
  await page.goto('/producto/seo-test-shirt?size=S');
  await expect(page.locator('.size-btn.is-active')).toHaveAttribute('data-size', 'S');
  await expect(page.locator('#pName')).toHaveText('Camiseta de prueba SEO');
  await expect(page.locator('#pAdd')).toBeEnabled();
});
