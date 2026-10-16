const { test, expect } = require('@playwright/test');
const QRCode = require('../../cronox-backend/node_modules/qrcode');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const artwork = readFileSync(path.resolve(__dirname, '../../cronox-front/assets/logo_banner.png'));
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test('integrates the authorized card, cleans up on navigation, and preserves the original renderer', async ({ page }) => {
  const qrDataUrl = await QRCode.toDataURL('CRX:1:0123456789abcdef0123456789abcdef', {
    width: 592, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#49212c', light: '#e9d8c4' },
  });
  let active = 'metacrilatos';
  let name = 'Daniel Rivas';
  let circleLevel = 3;
  let credentialRequests = 0;
  const writes = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.fulfill({ contentType: 'image/png', body: artwork }));
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(pathname);
    if (pathname === '/api/accreditations/active') return json(route, active === 'metacrilatos'
      ? { id: active, renderer: 'metacrilatos-v1', config: { version: 1 } }
      : { id: active, renderer: 'original-v1', config: { version: 1, artworkUrl: '/assets/logo_banner.png' } });
    if (pathname === '/api/membership/me/accreditation') {
      credentialRequests++;
      return json(route, { circleLevel, name, createdAt: '2020-01-01T23:30:00Z',
        visibleId: '11111111-2222-4333-8444-555555555555', qrDataUrl });
    }
    if (pathname === '/api/me') return json(route, { id: 7, firstName: 'Wrong cached name', lastName: 'Never use',
      memberCode: 'CRX-000007', circleLevel: 1, createdAt: '2026-01-01T00:00:00Z' });
    if (pathname === '/api/membership/me/qr') return route.fulfill({ contentType: 'image/png', body: Buffer.from(qrDataUrl.split(',')[1], 'base64') });
    if (pathname === '/api/membership/me/stats') return json(route, { circleLevel, createdAt: '2020-01-01T23:30:00Z' });
    if (pathname.includes('circle-upgrade')) return json(route, { circleLevel, hasPending: false, canRequest: false });
    if (pathname === '/api/me/address') return json(route, null);
    if (pathname === '/api/cart') return json(route, { items: [], itemsCount: 0, subtotal: 0 });
    if (pathname === '/api/me/orders' || pathname === '/api/favorites') return json(route, []);
    if (pathname === '/api/products') return json(route, { items: [] });
    return json(route, {});
  });
  await page.goto('/profile.html');
  const tab = page.locator('[data-profile-tab="accreditation"]');
  await tab.click();
  const card = page.locator('.crx-metacrilatos');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-crx-name]')).toHaveText('Daniel Rivas');
  await expect(card.locator('[data-crx-date]')).toHaveText('02/01/2020');
  await expect(card.locator('[data-crx-id]')).toContainText('11111111-2222-4333-8444-555555555555');
  await expect(card.locator('[data-crx-roman]').first()).toHaveText('III');
  await expect(page.locator('.accreditation-stage')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-profile-tab="orders"]').click();
  await expect(card).toHaveCount(0);
  name = ''; circleLevel = 4;
  await tab.click();
  await expect(card.locator('[data-crx-name]')).toHaveText('');
  await expect(card.locator('[data-crx-roman]').first()).toHaveText('IV');
  await expect(card.locator('[data-crx-date]')).toHaveText('02/01/2020');
  expect(credentialRequests).toBe(2);
  await page.locator('[data-profile-tab="orders"]').click();
  active = 'original';
  await tab.click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.crx-accreditation-book')).toBeVisible();
  await expect(page.locator('.accreditation-book-art')).toHaveAttribute('src', '/assets/logo_banner.png');
  await expect(page.locator('#cronox-member-qr')).toBeVisible();
  expect(writes.filter(url => /accreditation/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});
