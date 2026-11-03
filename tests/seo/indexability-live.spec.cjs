const { test, expect } = require('@playwright/test');

test('published pages render anonymously; production requests remain read-only', async ({ page }, info) => {
  const findings = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'GET') return route.abort();
    if (url.pathname.startsWith('/api/') && !/^\/api\/(products|categories|gallery|footer|key-screen|media-framing)(\/|$)/.test(url.pathname)) return route.fulfill({ status: 401, json: {} });
    return route.continue();
  });
  const redirect = await page.request.get('/producto/shielded-coal', { maxRedirects: 0 });
  expect(redirect.status()).toBe(301);
  expect(new URL(redirect.headers().location, 'https://cronox.es').href).toBe('https://cronox.es/producto/armored-coal');
  for (const pathname of ['/devoluciones', '/envios', '/galeria', '/sobre-cronox', '/producto/armored-coal']) {
    const response = await page.goto(pathname);
    expect(response.status()).toBe(200);
    if (pathname === '/galeria') {
      await expect(page.locator('[data-gallery-root]')).toHaveAttribute('data-gallery-state', 'ready');
      const photos = page.locator('.gallery-carousel__group').first().locator('img');
      await expect(photos).toHaveCount(5);
      for (const photo of await photos.all()) {
        await expect(photo).not.toHaveAttribute('alt', '');
        await expect.poll(() => photo.evaluate(n => n.complete && n.naturalWidth > 0)).toBe(true);
      }
    }
    if (pathname.startsWith('/producto/')) {
      await expect(page.locator('#pName')).toHaveText('ARMORED COAL');
      await expect(page.locator('#pAdd')).toBeEnabled();
      await expect.poll(() => page.locator('#pImage').evaluate(n => n.complete && n.naturalWidth > 0)).toBe(true);
    }
    findings.push({ pathname, status: response.status(), title: await page.title(), canonical: await page.locator('link[rel=canonical]').getAttribute('href'), bodyVisible: await page.locator('body').isVisible() });
  }
  await page.goto('/');
  await expect(page.locator('footer a[href="/galeria"]')).toHaveCount(1);
  for (const pathname of ['/envios', '/devoluciones']) await expect(page.locator(`a[href="${pathname}"]`).first()).toBeAttached();
  await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await expect(page.locator('a[href="/sobre-cronox"]')).toBeVisible();
  expect(errors).toEqual([]);
  await info.attach('public-render-audit', { body: JSON.stringify({ findings, errors }, null, 2), contentType: 'application/json' });
});
