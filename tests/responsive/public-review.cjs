// Real local public pages; no cart, favourite, address or payment mutations.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { safety, layout, login, screenshot, report, out, base } = require('./local-review.cjs');
async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'es-ES' }); await safety(context);
    const page = await context.newPage(); await login(page);
    await page.goto(base + '/profile.html');
    await page.locator('[data-consent-action="reject"]').first().click();
    await expect(page.locator('#preloader')).toBeHidden({ timeout: 15000 });
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of ['account', 'accreditation']) {
        await page.locator(`[data-profile-tab="${tab}"]`).click();
        if (tab === 'accreditation') {
          await expect.poll(() => page.locator('.accreditation-book-art').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
          await page.locator('.accreditation-book-art').evaluate(img => img.decode());
          await page.waitForTimeout(200); // Allow decoded lazy artwork to paint before evidence capture.
        }
        await screenshot(page, `account-clean-${tab}-${width}`);
      }
    }
    await page.goto(base + '/');
    const product = page.locator('a[href*="/producto/"]').first();
    await expect(product).toBeVisible(); const productUrl = await product.getAttribute('href');
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + '/'); await expect(page.locator('a[href*="/producto/"]').first()).toBeVisible();
      await layout(page, 'public-home');
      await page.goto(new URL(productUrl, base).href); await expect(page.locator('h1')).toBeVisible();
      await layout(page, 'public-product');
      await page.goto(base + '/checkout'); await expect(page.locator('#checkoutMain')).toBeVisible();
      await layout(page, 'public-checkout-empty');
    }
    report.interactions.push('real local home/product/empty checkout, clean account screenshots; no purchase or data writes');
  } finally { await browser.close(); }
}
run().catch(error => { report.failure = error.stack; console.error(error.message); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(out, 'public-review.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ layouts: report.layouts.length, failure: !!report.failure }));
});
