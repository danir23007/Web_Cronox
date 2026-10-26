const { test, expect } = require('@playwright/test');
const path = require('node:path');

const screenshot = (width, state) => path.join('test-results', 'newsletter-states', test.info().project.name, `${state}-${width}.png`);
const accepted = { status: 'registration_required' };
const sharp = require('../../cronox-backend/node_modules/sharp');
async function centeredInk(page) {
  const overlay = page.locator('.ascii-overlay');
  await expect(page.locator('.newsletter-modal-close')).toBeInViewport();
  await page.evaluate(() => {
    document.querySelector('.popup-image').style.visibility = 'hidden';
    document.querySelector('.newsletter-modal-close').style.visibility = 'hidden';
    document.querySelector('.ascii-overlay').style.background = '#000';
  });
  const buffer = await overlay.screenshot();
  await page.evaluate(() => {
    document.querySelector('.popup-image').style.visibility = '';
    document.querySelector('.newsletter-modal-close').style.visibility = '';
    document.querySelector('.ascii-overlay').style.background = '';
  });
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left=info.width, right=-1, top=info.height, bottom=-1;
  for(let y=0;y<info.height;y++) for(let x=0;x<info.width;x++) {
    if(data[(y*info.width+x)*info.channels]>80) {left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  expect(right).toBeGreaterThan(left);
  expect(Math.abs((left+right+1)/2-info.width/2)).toBeLessThanOrEqual(2);
  expect(Math.abs((top+bottom+1)/2-info.height/2)).toBeLessThanOrEqual(2);
  expect(Math.min(left,top,info.width-right-1,info.height-bottom-1)).toBeGreaterThanOrEqual(9);
}


for (const width of [320, 390, 768, 1366]) {
  test(`popup registration step, connection failure and retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
    let attempts = 0;
    let releaseFirstResponse;
    const firstResponse = new Promise(resolve => { releaseFirstResponse = resolve; });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/newsletter/start-registration') {
        attempts++;
        expect(route.request().headers()['x-csrf-token']).toBe('newsletter-fixture');
        expect(route.request().postDataJSON()).toEqual({ email: 'controlled@example.test' });
        if (attempts === 1) await firstResponse;
        return route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { code: 'NEWSLETTER_UNAVAILABLE' } : accepted });
      }
      if (path === '/api/auth/csrf') return route.fulfill({ json: { csrfToken: 'newsletter-fixture' } });
      if (path === '/api/me' || path === '/api/auth/refresh' || path === '/api/favorites') return route.fulfill({ status: 401, json: {} });
      if (path === '/api/cart') return route.fulfill({ json: { items: [], itemsCount: 0 } });
      if (path === '/api/products') return route.fulfill({ json: { items: [], meta: {} } });
      return route.fulfill({ json: {} });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
    await expect(page.locator('.newsletter-modal-overlay')).toHaveClass(/--visible/, { timeout: 15000 });
    await centeredInk(page);
    await page.screenshot({ path: screenshot(width, 'signup') });
    await page.locator('.newsletter-modal-input').fill('controlled@example.test');
    await page.locator('.newsletter-modal-button').click();
    await expect(page.locator('.newsletter-modal-button')).toBeDisabled();
    releaseFirstResponse();
    await expect(page.locator('.newsletter-modal-feedback')).toContainText('No hemos podido completar');
    await expect(page.locator('.newsletter-modal-input')).toHaveValue('controlled@example.test');
    await expect(page.locator('.newsletter-modal-button')).toHaveText('REINTENTAR');
    await centeredInk(page);
    await page.screenshot({ path: screenshot(width, 'error') });
    expect(attempts).toBe(1);
    await expect(page.locator('.newsletter-modal-button')).toBeEnabled();
    await page.locator('.newsletter-modal-button').click();
    await expect(page.locator('.newsletter-modal-title')).toHaveText('Completa tu suscripción');
    await expect(page.locator('.newsletter-modal-result-copy')).toHaveText('Completa tu cuenta para suscribirte a la newsletter.');
    await expect(page.locator('.newsletter-modal-result-mark')).toHaveCount(0);
    await expect(page.locator('.newsletter-modal-form')).toBeHidden();
    await expect(page.locator('#authRegisterForm')).toBeVisible();
    await expect(page.locator('#authRegisterEmail')).toBeHidden();
    await expect(page.locator('#authRegisterEmail')).toHaveValue('controlled@example.test');
    await page.screenshot({ path: screenshot(width, 'new') });
    await page.setViewportSize({ width, height: 620 });
    await expect(page.locator('#authRegisterFirstName')).toBeInViewport();
    await expect(page.locator('#authRegisterForm button[type=submit]')).toBeInViewport();
    expect(attempts).toBe(2);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`existing eligible account receives its own confirmation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
    let attempts = 0;
    await page.route('**/api/**', route => {
      const routePath = new URL(route.request().url()).pathname;
      if (routePath === '/api/newsletter/start-registration') {
        attempts++;
        return route.fulfill({ status: 200, json: { status: 'authentication_required' } });
      }
      if (routePath === '/api/auth/csrf') return route.fulfill({ json: { csrfToken: 'newsletter-fixture' } });
      if (routePath === '/api/me' || routePath === '/api/auth/refresh' || routePath === '/api/favorites') return route.fulfill({ status: 401, json: {} });
      if (routePath === '/api/cart') return route.fulfill({ json: { items: [], itemsCount: 0 } });
      if (routePath === '/api/products') return route.fulfill({ json: { items: [], meta: {} } });
      return route.fulfill({ json: {} });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
    await expect(page.locator('.newsletter-modal-overlay')).toHaveClass(/--visible/, { timeout: 15000 });
    await centeredInk(page);
    await page.locator('.newsletter-modal-input').fill('controlled@example.test');
    await page.locator('.newsletter-modal-button').click();
    await expect(page.locator('#authLoginForm')).toBeVisible();
    await expect(page.locator('#authContextNotice')).toContainText('para completar la suscripción');
    await expect(page.locator('#authLoginEmail')).toHaveValue('controlled@example.test');
    await expect(page.locator('.newsletter-modal-result-mark')).toHaveCount(0);
    await expect(page.locator('.newsletter-modal-form')).toBeHidden();
    expect(attempts).toBe(1);
    await page.screenshot({ path: screenshot(width, 'existing') });
    await page.locator('#authCloseBtn').click();
    await expect(page.locator('.newsletter-modal-overlay')).not.toHaveClass(/--visible/);
  });
  test(`newsletter-only subscriber receives registration guidance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
    let attempts = 0;
    await page.route('**/api/**', route => {
      const routePath = new URL(route.request().url()).pathname;
      if (routePath === '/api/newsletter/start-registration') {
        attempts++;
        return route.fulfill({ status: 200, json: accepted });
      }
      if (routePath === '/api/auth/csrf') return route.fulfill({ json: { csrfToken: 'newsletter-fixture' } });
      if (routePath === '/api/me' || routePath === '/api/auth/refresh' || routePath === '/api/favorites') return route.fulfill({ status: 401, json: {} });
      if (routePath === '/api/cart') return route.fulfill({ json: { items: [], itemsCount: 0 } });
      if (routePath === '/api/products') return route.fulfill({ json: { items: [], meta: {} } });
      return route.fulfill({ json: {} });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
    await expect(page.locator('.newsletter-modal-overlay')).toHaveClass(/--visible/, { timeout: 15000 });
    await centeredInk(page);
    await page.locator('.newsletter-modal-input').fill('controlled@example.test');
    await page.locator('.newsletter-modal-button').click();
    await expect(page.locator('#authRegisterForm')).toBeVisible();
    await expect(page.locator('#authContextNotice')).toContainText('Completa tu cuenta para suscribirte');
    await expect(page.locator('.newsletter-modal-result-mark')).toHaveCount(0);
    await expect(page.locator('.newsletter-modal-form')).toBeHidden();
    expect(attempts).toBe(1);
    await page.screenshot({ path: screenshot(width, 'newsletter-only') });
    await page.locator('#authCloseBtn').click();
    await expect(page.locator('.newsletter-modal-overlay')).not.toHaveClass(/--visible/);
  });
}

test('footer signup uses the same popup, preserves email on failure and retries', async ({ page }) => {
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  let attempts = 0;
  await page.route('**/api/**', route => {
    const routePath = new URL(route.request().url()).pathname;
    if (routePath === '/api/newsletter/start-registration') {
      attempts++;
      expect(route.request().postDataJSON()).toEqual({ email: 'footer@example.test' });
      return route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { code: 'NEWSLETTER_UNAVAILABLE' } : accepted });
    }
    if (routePath === '/api/auth/csrf') return route.fulfill({ json: { csrfToken: 'newsletter-fixture' } });
    if (routePath === '/api/me' || routePath === '/api/auth/refresh' || routePath === '/api/favorites') return route.fulfill({ status: 401, json: {} });
    if (routePath === '/api/cart') return route.fulfill({ json: { items: [], itemsCount: 0 } });
    if (routePath === '/api/products') return route.fulfill({ json: { items: [], meta: {} } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
  await page.locator('.footer-newsletter-form input').fill('footer@example.test');
  await page.locator('.footer-newsletter-form button').click();
  await expect(page.locator('.newsletter-modal-feedback')).toContainText('No hemos podido completar');
  await expect(page.locator('.newsletter-modal-input')).toHaveValue('footer@example.test');
  expect(attempts).toBe(1);
  await page.locator('.newsletter-modal-button').click();
  await expect(page.locator('#authRegisterForm')).toBeVisible();
  await expect(page.locator('#authRegisterEmail')).toHaveValue('footer@example.test');
  await expect(page.locator('#authRegisterEmail')).toBeHidden();
  expect(attempts).toBe(2);
  await page.locator('#authCloseBtn').click();
  await expect(page.locator('.newsletter-modal-overlay')).not.toHaveClass(/--visible/);
  await expect(page.locator('.footer-newsletter-form button')).toBeFocused();
});
