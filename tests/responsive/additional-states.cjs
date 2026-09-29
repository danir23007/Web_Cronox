const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { safety, layout, login, navigate, theme, screenshot, report, out, base } = require('./local-review.cjs');
async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'es-ES' }); await safety(context);
    const page = await context.newPage(); await login(page);
    await navigate(page, 'section-users');
    const userUrl = await page.locator('#usersBody a[href*="admin-user.html"]').first().getAttribute('href');
    for (const mode of ['light', 'dark']) {
      await theme(page, mode);
      for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: width === 320 ? 400 : 800 });
        for (const section of ['section-products','section-product-categories','section-waitlist','section-users','section-activity','section-23','section-34','section-key-screen','section-newsletter','section-footer']) {
          await navigate(page, section);
          await page.locator('#' + section + ' details').evaluateAll(nodes => nodes.forEach(el => el.open = true));
          if (section === 'section-product-categories') await page.locator('#categoryFilterToggle').click();
          await layout(page, 'expanded-' + section, '#' + section);
          if (section === 'section-product-categories') await page.keyboard.press('Escape');
        }
        // Real user detail, including editor and manual-purchase draft. Never submit.
        await page.goto(new URL(userUrl, base).href);
        await expect(page.locator('#summaryEmail')).not.toHaveText('—');
        for (const tab of await page.locator('[data-tab]').all()) {
          await tab.click(); await layout(page, 'user-' + await tab.getAttribute('data-tab'), '.admin-main');
        }
        await page.locator('[data-tab="profile"]').click();
        const edit = page.locator('#editUser');
        await expect(edit).toBeVisible();
        await edit.click(); await layout(page, 'user-edit', '.admin-main'); await page.locator('#cancelUserEdit').click();
        await page.locator('[data-tab="orders"]').click();
        await page.locator('#toggleManualPurchase').click();
        await expect(page.locator('#manualPurchaseForm')).toBeVisible();
        await layout(page, 'manual-purchase-draft', '.admin-main');
        await page.locator('#toggleManualPurchase').click();
        await screenshot(page, `user-detail-${mode}-${width}`);
        await page.goto(base + '/admin.html'); await expect(page.locator('.finance-chart svg')).toBeVisible();
      }
    }
    // Enlarged browser text, rather than shrinking the viewport alone.
    await page.setViewportSize({ width: 390, height: 600 });
    await page.addStyleTag({ content: 'html {font-size:200% !important} .cronox-admin {font-size:28px !important}' });
    for (const section of ['section-dashboard','section-money','section-products','section-key-screen','section-newsletter','section-footer']) { await navigate(page, section); await layout(page, 'text-zoom-' + section, '#' + section); }
    await navigate(page, 'section-products'); await page.locator('#createProductBtn').click();
    await expect(page.locator('#productName')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(page.locator('#productSubmitBtn')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.locator('#productName')).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.locator('#productModal')).toBeHidden(); await expect(page.locator('#createProductBtn')).toBeFocused();
    report.interactions.push('expanded filters, category filter, key/newsletter/footer controls, user detail tabs, 200% text and modal focus');
  } finally { await browser.close(); }
}
run().catch(error => { report.failure = error.stack; console.error(error.message); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(out, 'additional-states.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ layouts: report.layouts.length, failure: !!report.failure }));
});
