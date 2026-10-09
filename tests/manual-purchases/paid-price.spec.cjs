const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.resolve(__dirname, '../../cronox-front/admin-user.html'), 'utf8')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/g, script => /admin-theme\.js|admin-shell\.js|admin-user-shell\.js/.test(script) ? script : '')
  .replace('</body>', '<script src="assets/admin-user.js?v=6"></script></body>');
for (const width of [1440, 768, 390, 320]) {
  test(`paid price form and review at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (url.pathname === '/admin-user.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname.startsWith('/api/')) throw new Error('Unexpected live API request');
      return route.continue();
    });
    await page.addInitScript(() => {
      localStorage.setItem('cronox.admin.theme', 'dark');
      window.CRONOX_ADMIN_AUTH = { isAdmin: () => true };
      window.CRONOX_API = {
        formatPrice: value => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value),
        getMe: async () => ({ id: 99, role: 'SUPERADMIN' }), admin: {
          getInPersonPurchaseOptions: async () => ({ products: [{ name: 'Camiseta CRONOX con nombre largo', price: 4000, variants: [{ id: 5, size: 'M', sku: 'SCARRED-TEE-RED-M-LONG-SKU', stockQty: 5 }] }] }),
        },
      };
    });
    await page.goto('/admin-user.html?id=7&uid=local-test-user');
    await page.locator('button[data-tab=orders]').click();
    await page.getByRole('button', { name: 'Nueva compra' }).click();
    await page.locator('[data-manual-variant]').selectOption('5');
    await expect(page.locator('[data-manual-price]')).toHaveValue('40.00');
    await page.getByLabel('Precio pagado por unidad').fill('25,50');
    await page.locator('[data-manual-quantity]').fill('2');
    await page.getByRole('button', { name: 'Revisar compra' }).click();
    await expect(page.locator('#manualPurchaseReview')).toContainText('25,50');
    await expect(page.locator('#manualPurchaseReview')).toContainText('51,00');
    const overflow = await page.locator('#manualPurchaseSection').evaluate(section => {
      const bounds = section.getBoundingClientRect();
      return [...section.querySelectorAll('input, select, button, textarea')].some(field => {
        const box = field.getBoundingClientRect();
        return box.width && (box.right > bounds.right + 1 || box.left < bounds.left - 1);
      });
    });
    expect(overflow).toBe(false);
    fs.mkdirSync('output/playwright', { recursive: true });
    await page.screenshot({ path: `output/playwright/manual-purchase-${width}.png`, fullPage: true });
    await page.getByLabel('Precio pagado por unidad').fill('');
    await expect(page.locator('#manualPurchaseConfirmActions')).toBeHidden();
    await page.getByRole('button', { name: 'Revisar compra' }).click();
    await expect(page.locator('#manualPurchaseConfirmActions')).toBeHidden();
  });
}
