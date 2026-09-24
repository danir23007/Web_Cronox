const { test, expect } = require('@playwright/test');

async function expectDarkFrame(page) {
  const viewport = page.viewportSize();
  const screenshot = (await page.screenshot()).toString('base64');
  const pixels = await page.evaluate(async ({ screenshot, y }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${screenshot}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.drawImage(image, 5, y, 1, 1, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, { screenshot, y: Math.floor(viewport.height / 2) });
  expect(pixels[0] + pixels[1] + pixels[2]).toBeLessThan(240);
}

test('cold home to Favorites keeps the first parsed frame styled', async ({ page }) => {
  const styles = [];
  await page.addInitScript(() => {
    window.__cronoxEarlyFrames = [];
    const inspect = () => {
      const logo = document.querySelector('.topbar__logo-img');
      if (logo) {
        const icons = [...document.querySelectorAll('.topbar svg')];
        window.__cronoxEarlyFrames.push({
          logo: logo.getBoundingClientRect().width,
          icon: Math.max(0, ...icons.map(icon => icon.getBoundingClientRect().width)),
        });
      }
      if (window.__cronoxEarlyFrames.length < 300) requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
  await page.route('**/assets/store.css?*', async route => {
    styles.push(new URL(route.request().url()).search);
    if (route.request().url().includes('v=100')) await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue();
  });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto('/');
  const navigation = page.waitForURL('**/favoritos', { waitUntil: 'commit' });
  await page.locator('a[href="/favoritos"]').first().click({ noWaitAfter: true });
  await navigation;
  await page.waitForFunction(() => document.querySelector('link[href*="store.css"]'));
  await page.waitForTimeout(150);
  await expectDarkFrame(page);
  await page.locator('.topbar__logo-img').waitFor({ state: 'attached' });
  const first = await page.evaluate(() => {
    const logo = document.querySelector('.topbar__logo-img').getBoundingClientRect();
    return { background: getComputedStyle(document.body).backgroundColor,
      logo: { x: logo.x, y: logo.y, width: logo.width, height: logo.height },
      icons: [...document.querySelectorAll('.topbar svg')].map(icon => ({ width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height })),
      oversized: [...document.querySelectorAll('svg')].filter(el => el.getBoundingClientRect().width > 100).length };
  });
  expect(first.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(first.logo.width).toBeLessThan(200);
  expect(first.icons.every(icon => icon.width <= 32 && icon.height <= 32)).toBe(true);
  expect(first.oversized).toBe(0);
  const frames = await page.evaluate(() => window.__cronoxEarlyFrames);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every(frame => frame.logo < 200 && frame.icon <= 32)).toBe(true);
  expect(styles).toEqual(['?v=100', '?v=100']);
  await expect(page.locator('#favorites')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
  await page.goForward();
  await expect(page.locator('#favorites')).toBeVisible();
});

for (const [route, script, destination] of [
  ['/', 'category-page.js', '.topbar__logo-img'],
  ['/checkout', 'runtime-config.js', '.checkout-brand img'],
]) {
  test(`delayed ${script} does not produce a white document`, async ({ page }) => {
    await page.route(`**/assets/${script}*`, async request => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await request.continue();
    });
    await page.route('**/api/**', request => request.fulfill({ json: {} }));
    await page.goto(route, { waitUntil: 'commit' });
    await page.waitForTimeout(100);
    await expectDarkFrame(page);
    await page.locator(destination).waitFor({ state: 'attached' });
  });
}

test('warm stylesheet cache and Back/Forward retain the normal Favorites presentation', async ({ page }) => {
  await page.route('**/api/**', request => request.fulfill({ json: {} }));
  await page.goto('/');
  await page.goto('/favoritos');
  await page.goBack();
  await page.goForward();
  await expect(page.locator('#favorites')).toBeVisible();
  await expectDarkFrame(page);
  const dimensions = await page.evaluate(() => ({
    logo: document.querySelector('.topbar__logo-img').getBoundingClientRect().width,
    icons: [...document.querySelectorAll('.topbar svg')].map(icon => icon.getBoundingClientRect().width),
  }));
  expect(dimensions.logo).toBeLessThan(200);
  expect(dimensions.icons.every(value => value <= 32)).toBe(true);
});

for (const [route, stylesheet, color] of [['/key-screen.html', 'key-screen.css', 'rgb(5, 5, 5)'], ['/launch.html', 'launch.css', 'rgb(8, 8, 8)']]) {
  test(`${route} has a dark background with a delayed stylesheet`, async ({ page }) => {
    await page.route(`**/assets/${stylesheet}*`, async request => {
      await new Promise(resolve => setTimeout(resolve, 400));
      await request.continue();
    });
    await page.route('**/api/**', request => request.fulfill({ json: {} }));
    await page.goto(route, { waitUntil: 'commit' });
    await page.waitForFunction(expected => getComputedStyle(document.documentElement).backgroundColor === expected, color);
    await page.locator('main').waitFor({ state: 'attached' });
  });
}

for (const width of [390, 1366]) {
  for (const route of ['/tienda', '/tienda?categorySlug=camisetas#store', '/tienda?search=camiseta#store', '/favoritos', '/cesta', '/checkout', '/producto/test-tee', '/galeria', '/profile.html']) {
    test(`direct ${route} at ${width}px keeps a dark first frame with bounded header`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      await page.route('**/assets/store.css?*', async request => {
        await new Promise(resolve => setTimeout(resolve, 250));
        await request.continue();
      });
      await page.route('**/api/**', request => request.fulfill({ json: {} }));
      await page.goto(route, { waitUntil: 'commit' });
      await page.waitForFunction(() => document.querySelector('link[href*="store.css"]'));
      await page.waitForTimeout(80);
      if (!route.startsWith('/tienda')) await expectDarkFrame(page);
      const logoSelector = route === '/checkout' ? '.checkout-brand img' : '.topbar__logo-img';
      await page.locator(logoSelector).waitFor({ state: 'attached' });
      const header = await page.evaluate(() => ({
        logoWidth: document.querySelector('.topbar__logo-img, .checkout-brand img').getBoundingClientRect().width,
        iconWidths: [...document.querySelectorAll('.topbar svg, .checkout-brandbar svg')].map(icon => icon.getBoundingClientRect().width),
      }));
      expect(header.logoWidth).toBeLessThan(200);
      expect(header.iconWidths.every(value => value <= 32)).toBe(true);
    });
  }
}

test('stylesheet failure leaves a usable dark Favorites fallback, not giant icons', async ({ page }) => {
  await page.route('**/assets/store.css?*', request => request.abort());
  await page.route('**/api/**', request => request.fulfill({ json: {} }));
  await page.goto('/favoritos');
  await expect(page.locator('#favorites')).toBeVisible();
  const fallback = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    logoWidth: document.querySelector('.topbar__logo-img').getBoundingClientRect().width,
    iconWidths: [...document.querySelectorAll('.topbar svg')].map(icon => icon.getBoundingClientRect().width),
  }));
  expect(fallback.background).toBe('rgb(0, 0, 0)');
  expect(fallback.logoWidth).toBeLessThan(200);
  expect(fallback.iconWidths.every(value => value <= 32)).toBe(true);
});

test('missing product photo uses a neutral card and PDP image rather than the brand logo', async ({ page }) => {
  const product = { id: 1, slug: 'test-tee', name: 'Test Tee', price: 3500, variants: [{ id: 101, size: 'M', stock: 2, isActive: true }], images: [] };
  await page.route('**/api/**', request => {
    const pathname = new URL(request.request().url()).pathname;
    const data = pathname === '/api/products' ? { items: [product], meta: { total: 1 } } :
      pathname === '/api/products/test-tee' ? product :
      pathname === '/api/cart' ? { items: [], itemsCount: 0, subtotal: 0 } :
      pathname === '/api/me' ? null : [];
    return request.fulfill({ json: data });
  });
  await page.goto('/tienda#store');
  const cardImage = page.locator('.product-card .product-img').first();
  await expect(cardImage).toHaveAttribute('src', /product-image-unavailable\.svg/);
  await expect.poll(() => cardImage.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await page.locator('.product-card').first().click();
  await expect(page).toHaveURL(/\/producto\/test-tee/);
  await expect(page.locator('#pImage')).toHaveAttribute('src', /product-image-unavailable\.svg/);
  await page.goBack();
  await expect(page.locator('.product-card').first()).toBeVisible();
});

test('a failed product photo falls back to the neutral image', async ({ page }) => {
  const product = { id: 1, slug: 'test-tee', name: 'Test Tee', price: 3500, imageUrl: '/missing-product.jpg', images: [{ url: '/missing-product.jpg' }], variants: [{ id: 101, size: 'M', stock: 2, isActive: true }] };
  await page.route('**/api/**', request => {
    const pathname = new URL(request.request().url()).pathname;
    const data = pathname === '/api/products' ? { items: [product], meta: { total: 1 } } :
      pathname === '/api/products/test-tee' ? product :
      pathname === '/api/cart' ? { items: [], itemsCount: 0, subtotal: 0 } :
      pathname === '/api/me' ? null : [];
    return request.fulfill({ json: data });
  });
  await page.goto('/tienda#store');
  await expect(page.locator('.product-card .product-img').first()).toHaveAttribute('src', /product-image-unavailable\.svg/);
  await page.goto('/producto/test-tee');
  await expect(page.locator('#pImage')).toHaveAttribute('src', /product-image-unavailable\.svg/);
  await expect.poll(() => page.locator('#pImage').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
});

test('Favorites keeps a product with no photo and shows the neutral image', async ({ page }) => {
  const product = { id: 1, slug: 'test-tee', name: 'Test Tee', price: 3500, images: [], variants: [{ id: 101, size: 'M', stock: 2, isActive: true }] };
  await page.route('**/api/**', request => {
    const pathname = new URL(request.request().url()).pathname;
    const data = pathname === '/api/products' ? { items: [product], meta: { total: 1 } } :
      pathname === '/api/favorites/products' ? [{ product }] :
      pathname === '/api/cart' ? { items: [], itemsCount: 0, subtotal: 0 } :
      pathname === '/api/me' ? { id: 1, role: 'USER' } : [];
    return request.fulfill({ json: data });
  });
  await page.goto('/favoritos');
  await expect(page.locator('#favorites-grid .product-card')).toHaveCount(1);
  await expect(page.locator('#favorites-grid .product-img')).toHaveAttribute('src', /product-image-unavailable\.svg/);
});
