const { test, expect } = require('@playwright/test');
const sharp = require('../../cronox-backend/node_modules/sharp');
const variants = {};
const files = {};
test.beforeAll(async () => {
  for (const [role, width] of [['small', 450], ['card', 975], ['pdp', 2550], ['preview', 720], ['grid', 1500], ['large', 2250]]) {
    const height = width * 4 / 3;
    files[role] = await sharp({ create: { width, height, channels: 3, background: '#456789' } }).webp().toBuffer();
    variants[role] = { url: `/fixture/${role}.webp`, width, height };
  }
});
test('browser selects small cards and gallery previews, retaining large zoom sources', async ({ page }) => {
  const requested = [];
  await page.route('**/fixture/*.webp', route => {
    const role = new URL(route.request().url()).pathname.split('/').pop().split('.')[0];
    requested.push(role);
    return route.fulfill({ contentType: 'image/webp', body: files[role] });
  });
  await page.route('**/image-probe', route => route.fulfill({ contentType: 'text/html', body: '<body><img id="card" style="width:183px;height:244px"><img id="gallery" style="width:297px;height:396px"></body>' }));
  await page.goto('/image-probe');
  await page.evaluate(() => { window.CRONOX_SECURITY = { productImageUrl: value => value }; });
  await page.addScriptTag({ url: '/assets/responsive-images.js' });
  await page.evaluate(variants => {
    window.CRONOX_IMAGES.apply(document.querySelector('#card'), { url: '/fixture/pdp.webp', variants }, 'card');
    window.CRONOX_IMAGES.apply(document.querySelector('#gallery'), { url: '/fixture/large.webp', variants }, 'galleryGrid', { sizes: '297px' });
  }, variants);
  await expect.poll(() => page.locator('#card').evaluate(e => e.complete && e.currentSrc)).toContain('/small.webp');
  await expect.poll(() => page.locator('#gallery').evaluate(e => e.complete && e.currentSrc)).toContain('/preview.webp');
  expect(requested.sort()).toEqual(['preview', 'small']);
  await page.evaluate(variants => {
    window.CRONOX_IMAGES.apply(document.querySelector('#gallery'), { url: '/fixture/large.webp', variants }, 'galleryLarge', { loading: 'eager' });
  }, variants);
  await expect.poll(() => page.locator('#gallery').evaluate(e => e.complete && e.currentSrc)).toContain('/large.webp');
});

test('cold homepage keeps cookies, first-touch menu and near-viewport gallery loading', async ({ page }) => {
  const requests = [];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  const product = { id: 1, name: 'Producto de prueba', slug: 'prueba', price: 3500, currency: 'EUR', imageUrl: '/fixture/pdp.webp', images: [{ url: '/fixture/pdp.webp', variants, isPrimary: true }], variants: [{ id: 11, size: 'M', stockQty: 3, isActive: true }] };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (url.pathname.startsWith('/fixture/')) return route.fulfill({ contentType: 'image/webp', body: files[url.pathname.split('/').pop().split('.')[0]] });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/gallery') {
      requests.push('gallery');
      await new Promise(r => setTimeout(r, 600));
      return route.fulfill({ json: { mode: 'CAROUSEL', slots: [], carouselItems: [1, 2, 3].map(position => ({ key: `carousel-${position}`, position, imageSrc: '/fixture/large.webp', variants, alt: 'Foto de prueba' })) } });
    }
    if (url.pathname === '/api/products') return route.fulfill({ json: { items: Array.from({ length: 12 }, (_, i) => ({ ...product, id: i + 1, slug: `prueba-${i}` })), meta: { total: 12, pageCount: 1 } } });
    if (url.pathname === '/api/cart') return route.fulfill({ json: { items: [], itemsCount: 0, subtotal: 0 } });
    if (url.pathname === '/api/newsletter/config') return route.fulfill({ json: { enabled: false } });
    if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { csrfToken: 'test-only' } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await expect(page.locator('#preloader')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'RECHAZAR', exact: true })).toBeVisible();
  await expect(page.locator('#productsGrid .product-card')).toHaveCount(12);
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
  await page.locator('#btnMenu').click();
  await expect(page.locator('#btnMenu')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await page.locator('[data-gallery-homepage-section]').scrollIntoViewIfNeeded();
  const slide = page.locator('.gallery-carousel__slide').first();
  await expect(slide).toBeVisible();
  await slide.click({ force: true });
  await expect(page.locator('#galleryLightbox')).toBeVisible();
  await expect.poll(() => page.locator('#galleryLightbox img').first().evaluate(e => e.currentSrc)).toContain('/large.webp');
  await page.locator('#galleryLightboxClose').click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'RECHAZAR', exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});
