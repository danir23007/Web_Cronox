const { test, expect } = require('@playwright/test');

const slots = ['featured', ...Array.from({ length: 12 }, (_, index) => `slot-${String(index + 1).padStart(2, '0')}`)]
  .map((key, index) => ({ key, placeholderColor: index % 2 ? 'white' : 'grey', imageSrc: null }));
const carouselItems = [1, 2, 3].map(position => ({
  key: `carousel-${position}`, position, imageSrc: '/assets/logo_banner.png', alt: `Foto ${position}`,
}));

async function fixture(page, { mode = 'CAROUSEL', empty = false, delay = 800 } = {}) {
  const errors = [];
  const consoleErrors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('request', request => { if (request.url().includes('/api/gallery')) requests.push(request.url()); });
  await page.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    sessionStorage.setItem('cronox_newsletter_seen', '1');
    document.cookie = 'cronox_cookie_consent=' + encodeURIComponent(JSON.stringify({ necessary: true, preferences: false, analytics: false, marketing: false, consentVersion: '2', timestamp: new Date().toISOString() })) + '; path=/';
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.fulfill({ status: 204, body: '' });
    if (url.pathname === '/api/gallery') {
      await new Promise(resolve => setTimeout(resolve, delay));
      return route.fulfill({ json: { mode, slots, carouselItems: empty ? [] : carouselItems } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname === '/api/cart' ? { items: [], itemsCount: 0, subtotalCents: 0 } : {} });
    return route.continue();
  });
  return { errors, consoleErrors, requests };
}

for (const width of [390, 1366]) {
  for (const mode of ['CAROUSEL', 'MOSAIC']) {
    test(`${mode} first visible frame and reload at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
      const state = await fixture(page, { mode });
      for (const reload of [false, true]) {
        if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
        else await page.goto('/gallery.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(120);
        const root = page.locator('#galleryGrid');
        const before = await root.evaluate(el => ({ tiles: el.querySelectorAll('.gallery__tile').length, state: el.dataset.galleryState, mode: el.dataset.galleryMode }));
        expect(before.tiles).toBe(0);
        if (!reload && mode === 'CAROUSEL' && width === 390) {
          await page.screenshot({ path: `test-results/gallery-loading-mobile-${test.info().project.name}.png` });
        }
        if (!reload && mode === 'CAROUSEL' && width === 1366) {
          await page.screenshot({ path: `test-results/gallery-loading-${test.info().project.name}.png` });
        }
        await expect(root.getByRole('status')).toContainText('Cargando');
        await expect(root).toHaveAttribute('data-gallery-state', 'loading');
        await expect(root).toHaveAttribute('data-gallery-mode', mode, { timeout: 10000 });
        await expect(root.locator(mode === 'CAROUSEL' ? '.gallery-carousel__slide' : '.gallery__tile').first()).toBeVisible();
        if (!reload && mode === 'CAROUSEL' && width === 390) {
          await page.screenshot({ path: `test-results/gallery-carousel-mobile-${test.info().project.name}.png` });
        }
        if (!reload && mode === 'CAROUSEL' && width === 1366) {
          await page.screenshot({ path: `test-results/gallery-carousel-${test.info().project.name}.png` });
        }
        await expect(root.getByRole('status')).toHaveCount(0);
      }
      expect(state.errors).toEqual([]);
      expect(state.consoleErrors).toEqual([]);
      expect(state.requests.length).toBe(2);
    });
  }
}

for (const width of [390, 1366]) {
  for (const mode of ['CAROUSEL', 'MOSAIC']) {
    test(`homepage ${mode} keeps filters separate and shows the saved mode at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 768 });
      const state = await fixture(page, { mode });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const section = page.locator('[data-gallery-homepage-section]');
      const root = section.locator('[data-gallery-root]');
      await expect(section).toBeVisible();
      await expect(root.getByRole('status')).toContainText('Cargando');
      expect(await root.locator('.gallery__tile').count()).toBe(0);
      await expect(root).toHaveAttribute('data-gallery-mode', mode, { timeout: 10000 });
      await expect(section.locator('.gallery-homepage__heading')).toBeVisible({ visible: mode === 'MOSAIC' });
      await page.locator('#btnMenu').click();
      await expect(page.locator('#filtersPanel .black-menu__link')).toHaveCount(5);
      await expect(page.locator('#filtersPanel a[href="/galeria"]')).toHaveCount(0);
      await expect(page.locator('#filtersPanel a[href*="categorySlug="]')).toHaveCount(5);
      expect(state.errors).toEqual([]);
      expect(state.consoleErrors).toEqual([]);
    });
  }
}

test('carousel retains pointer navigation and lightbox', async ({ page }) => {
  const state = await fixture(page, { delay: 200 });
  await page.goto('/gallery.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#galleryGrid')).toHaveAttribute('data-gallery-mode', 'CAROUSEL');
  const slide = page.locator('#galleryGrid .gallery-carousel__slide').first();
  await expect(slide).toBeVisible();
  await slide.click({ force: true });
  await expect(page.locator('#galleryLightbox')).toBeVisible();
  await page.locator('#galleryLightboxNext').click();
  await page.locator('#galleryLightboxClose').click();
  await expect(page.locator('#galleryLightbox')).toBeHidden();
  expect(state.errors).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
});

for (const mode of ['MOSAIC', 'CAROUSEL']) {
  test(`gallery without photos resolves to its empty mosaic when requested mode is ${mode}`, async ({ page }) => {
    const state = await fixture(page, { mode, empty: true });
    await page.goto('/gallery.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#galleryGrid .gallery__tile')).toHaveCount(0);
    await expect(page.locator('#galleryGrid')).toHaveAttribute('data-gallery-state', 'loading');
    await expect(page.locator('#galleryGrid')).toHaveAttribute('data-gallery-mode', 'MOSAIC', { timeout: 10000 });
    await expect(page.locator('#galleryGrid .gallery__tile')).toHaveCount(13);
    expect(state.errors).toEqual([]);
    expect(state.consoleErrors).toEqual([]);
  });
}

test('an unavailable gallery shows an error and can retry without inventing a mode', async ({ page }) => {
  let attempts = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (url.pathname === '/api/gallery') {
      attempts++;
      return attempts === 1
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: { mode: 'CAROUSEL', slots, carouselItems } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname === '/api/cart' ? { items: [] } : {} });
    return route.continue();
  });
  await page.goto('/gallery.html');
  await expect(page.locator('#galleryGrid')).toHaveAttribute('data-gallery-state', 'error');
  await expect(page.locator('#galleryGrid .gallery__tile')).toHaveCount(0);
  await page.locator('#galleryGrid button').filter({ hasText: 'Reintentar' }).click();
  expect(attempts).toBe(2);
  await expect(page.locator('#galleryGrid')).toHaveAttribute('data-gallery-mode', 'CAROUSEL');
  expect(errors).toEqual([]);
});
