const { test, expect } = require('@playwright/test');

for (const width of [1366, 390]) {
  test(`newsletter access waits for a click and offers replacement at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const token = 'a'.repeat(64);
    let loginRequests = 0;
    let replacementRequests = 0;
    await page.route('**/api/auth/csrf', route => route.fulfill({ json: { csrfToken: 'fixture' } }));
    await page.route('**/api/auth/newsletter-login', route => {
      loginRequests++;
      expect(route.request().postDataJSON()).toEqual({ token });
      expect(route.request().headers()['x-csrf-token']).toBe('fixture');
      return route.fulfill({ status: 401, json: { message: 'expired' } });
    });
    await page.route('**/api/newsletter/request-access', route => {
      replacementRequests++;
      expect(route.request().postDataJSON()).toEqual({ email: 'visitor@example.test' });
      return route.fulfill({ status: 202, json: { status: 'accepted', httpStatus: 202 } });
    });
    await page.goto(`/newsletter-access.html#${token}`);
    await expect(page).toHaveURL(/newsletter-access\.html$/);
    await expect(page.getByRole('button', { name: 'Entrar en Cronox' })).toBeVisible();
    expect(loginRequests).toBe(0);
    await page.getByRole('button', { name: 'Entrar en Cronox' }).click();
    await expect(page.getByRole('status')).toContainText('ya se ha utilizado');
    await page.getByRole('textbox', { name: 'Solicitar otro enlace' }).fill('visitor@example.test');
    await page.getByRole('button', { name: 'Solicitar enlace' }).click();
    await expect(page.getByRole('status')).toContainText('recibirás un enlace');
    expect(loginRequests).toBe(1);
    expect(replacementRequests).toBe(1);
    await page.goto(`/newsletter-access.html#${'b'.repeat(64)}`);
    await expect(page).toHaveURL(/newsletter-access\.html$/);
    await expect(page.getByRole('button', { name: 'Entrar en Cronox' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
