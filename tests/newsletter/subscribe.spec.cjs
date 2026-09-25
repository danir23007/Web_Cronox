const { test, expect } = require('@playwright/test');

for (const width of [1366, 390]) {
  test(`popup submission, SMTP failure and retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
    let attempts = 0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/newsletter/subscribe') {
        attempts++;
        expect(route.request().headers()['x-csrf-token']).toBe('newsletter-fixture');
        expect(route.request().postDataJSON()).toEqual({ email: 'controlled@example.test' });
        await new Promise(resolve => setTimeout(resolve, 200));
        return route.fulfill({ status: attempts === 1 ? 503 : 202, json: attempts === 1 ? { code: 'NEWSLETTER_UNAVAILABLE' } : { status: 'accepted', httpStatus: 202 } });
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
    await page.locator('.newsletter-modal-input').fill('controlled@example.test');
    await page.locator('.newsletter-modal-button').click();
    await expect(page.locator('.newsletter-modal-button')).toBeDisabled();
    await expect(page.locator('.newsletter-modal-feedback')).toContainText('No hemos podido completar');
    expect(attempts).toBe(1);
    await expect(page.locator('.newsletter-modal-button')).toBeEnabled();
    await page.locator('.newsletter-modal-button').click();
    await expect(page.locator('.newsletter-modal-feedback')).toContainText('Revisa tu correo');
    expect(attempts).toBe(2);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
