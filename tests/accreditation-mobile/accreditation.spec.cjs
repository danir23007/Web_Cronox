const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const bookPng = readFileSync(path.resolve(__dirname, '../../cronox-front/assets/logo_banner.png'));
const qrPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const json = (route, body) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test.beforeEach(async ({ page }) => {
  let bookAttempts = 0;
  let qrAttempts = 0;

  await page.route('**/storage/v1/object/public/Acreditation/Libro-antiguo.png*', (route) => {
    bookAttempts += 1;
    if (bookAttempts === 1) return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'image/png', body: bookPng });
  });

  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/membership/me/qr') {
      qrAttempts += 1;
      if (qrAttempts === 1) return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'image/png', body: qrPng });
    }
    if (pathname === '/api/me') {
      return json(route, {
        id: 7,
        firstName: 'Alejandra',
        lastName: 'Cronox Mobile',
        email: 'mobile@example.test',
        memberCode: 'CRX-000007',
        circleLevel: 3,
        createdAt: '2026-01-02T01:02:57.851Z',
      });
    }
    if (pathname === '/api/me/orders' || pathname === '/api/favorites') return json(route, []);
    if (pathname === '/api/me/address') return json(route, null);
    if (pathname.includes('accreditation') && pathname.includes('stats')) {
      return json(route, {
        circleLevel: 3,
        createdAt: '2026-01-02T01:02:57.851Z',
        ordersCount: 18,
        itemsNetCount: 23,
      });
    }
    if (pathname.includes('circle-upgrade')) {
      return json(route, { circleLevel: 3, hasPending: false, hasApproved: false, canRequest: true });
    }
    if (pathname === '/api/products') return json(route, []);
    if (pathname === '/api/cart') return json(route, { items: [], itemsCount: 0, subtotal: 0 });
    return json(route, {});
  });
});

async function openAccreditation(page) {
  await page.goto('/profile.html');
  await page.locator('[data-profile-tab="accreditation"]').click();
  await expect(page.locator('[data-profile-section="accreditation"]')).toHaveClass(/is-active/);
  await expect(page.locator('.crx-accreditation-book')).toBeVisible();
  await expect.poll(() => page.locator('.accreditation-book-art').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('#cronox-member-qr')).toHaveJSProperty('naturalWidth', 1);
}

test('keeps the complete book, page content and retried QR inside narrow viewports', async ({ page }, testInfo) => {
  await openAccreditation(page);

  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width };
    };
    const pages = [...document.querySelectorAll('.accreditation-page')].map((page) => {
      const pageRect = page.getBoundingClientRect();
      const descendants = [...page.querySelectorAll('*')]
        .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
        .map((element) => element.getBoundingClientRect());
      return {
        clientHeight: page.clientHeight,
        scrollHeight: page.scrollHeight,
        rect: { left: pageRect.left, right: pageRect.right, top: pageRect.top, bottom: pageRect.bottom },
        contentTop: Math.min(...descendants.map((rect) => rect.top)),
        contentBottom: Math.max(...descendants.map((rect) => rect.bottom)),
      };
    });
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      book: rect('.crx-accreditation-book'),
      art: rect('.accreditation-book-art'),
      qr: rect('#cronox-member-qr'),
      pages,
    };
  });

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.book.left).toBeGreaterThanOrEqual(0);
  expect(layout.book.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.art.left).toBeGreaterThanOrEqual(0);
  expect(layout.art.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.qr.left).toBeGreaterThanOrEqual(layout.book.left);
  expect(layout.qr.right).toBeLessThanOrEqual(layout.book.right);
  expect(layout.qr.width).toBeGreaterThanOrEqual(testInfo.project.name === 'chromium-desktop' ? 105 : 66);
  for (const pageLayout of layout.pages) {
    expect(pageLayout.rect.left).toBeGreaterThanOrEqual(layout.book.left);
    expect(pageLayout.rect.right).toBeLessThanOrEqual(layout.book.right);
    expect(pageLayout.scrollHeight).toBeLessThanOrEqual(pageLayout.clientHeight + 1);
    expect(pageLayout.contentTop).toBeGreaterThanOrEqual(pageLayout.rect.top);
    expect(pageLayout.contentBottom).toBeLessThanOrEqual(pageLayout.rect.bottom + 1);
  }

  await page.locator('[data-profile-tab="orders"]').click();
  await page.locator('[data-profile-tab="accreditation"]').click();
  await expect(page.locator('.accreditation-book-art')).toBeVisible();
  await expect(page.locator('#cronox-member-qr')).toBeVisible();
  await expect(page.locator('#cronox-member-qr')).toHaveJSProperty('naturalWidth', 1);
});
