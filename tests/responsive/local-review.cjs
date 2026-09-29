// Real isolated backend for authentication/content; fixtures are explicitly labelled.
// No catalogue/order/email mutation is allowed by this browser harness.
const { chromium, webkit, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');
const base = 'http://localhost:3000';
const out = path.resolve(process.env.RESPONSIVE_OUTPUT || 'test-results/responsive');
const widths = [320, 360, 390, 430, 600, 768, 900, 1024, 1280, 1440];
const report = { layouts: [], interactions: [], errors: [], blockedWrites: [], fixtures: [], engines: {} };
fs.mkdirSync(out, { recursive: true });
const pause = page => page.waitForTimeout(120);
async function safety(context) {
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) {
      if (url.origin === base && ['/api/auth/login', '/api/auth/logout', '/api/auth/csrf', '/api/auth/activity', '/api/auth/refresh'].includes(url.pathname)) return route.continue();
      // Existing local mail folders are already present; skip lazy initialization writes.
      if (url.origin === base && url.pathname.endsWith('/initialize')) return route.fulfill({ json: { ok: true } });
      report.blockedWrites.push({ path: url.pathname, method: request.method() });
      return route.abort();
    }
    return route.continue();
  });
}
async function layout(page, name, selector = 'body') {
  await pause(page);
  const result = await page.locator(selector).evaluate((root, name) => {
    const box = root.getBoundingClientRect();
    return { name, width: innerWidth, height: innerHeight, theme: document.documentElement.dataset.adminTheme || 'public',
      pageWidth: document.documentElement.scrollWidth, rootWidth: box.width,
      scrollX, rootLeft: box.left, bodyLeft: document.body.getBoundingClientRect().left,
      overflow: [...document.querySelectorAll('body *')].filter(el => {
        const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && !el.closest('.admin-table-scroll');
      }).slice(0, 15).map(el => ({ tag: el.tagName, class: el.getAttribute('class'), right: el.getBoundingClientRect().right })),
      clippedControls: [...root.querySelectorAll('input,select,textarea,button,summary')].filter(el => {
        if (el.closest('.admin-sidebar,.admin-table-scroll,.product-gallery-thumbnails,.gallery-carousel__track,[hidden],[aria-hidden="true"]')) return false;
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        if (!rect.width || !rect.height || style.visibility === 'hidden' || style.opacity === '0') return false;
        return rect.right > innerWidth + 1 || rect.left < -1;
      }).map(el => el.id || el.className),
    };
  }, name);
  report.layouts.push(result);
  if (result.pageWidth > result.width + 1) await screenshot(page, 'overflow-' + name);
  expect(result.pageWidth, name).toBeLessThanOrEqual(result.width + 1);
  expect(result.clippedControls, name).toEqual([]);
}
async function login(page) {
  const env = loadLocalEnvironment(); // Validates loopback DB and disabled integrations.
  await page.goto(base + '/admin.html');
  await page.locator('#adminLoginEmail').fill(env.LOCAL_ADMIN_EMAIL);
  await page.locator('#adminLoginPassword').fill(env.LOCAL_ADMIN_PASSWORD);
  const response = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await page.locator('#adminLoginSubmit').click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('.finance-chart svg')).toBeVisible();
  await page.reload(); await expect(page.locator('.finance-chart svg')).toBeVisible();
  report.interactions.push('normal local login and reload');
}
async function navigate(page, section) {
  await page.evaluate(section => window.CRONOX_ADMIN_NAV.navigate(section), section);
  await expect(page.locator('#' + section)).toBeVisible(); await pause(page);
}
async function theme(page, value) {
  if (await page.locator('html').getAttribute('data-admin-theme') !== value) await page.getByRole('switch', { name: 'Modo oscuro' }).click();
}
async function screenshot(page, name) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(out, name + '.png'), fullPage: false }); }
async function account(page, engine) {
  await page.goto(base + '/profile.html');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const nav = page.locator('.profile-tabs'); await expect(nav).toBeVisible();
    const dimensions = await nav.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    const tabs = page.locator('[data-profile-tab]:visible');
    for (let i = 0; i < await tabs.count(); i++) {
      const tab = tabs.nth(i), destination = await tab.getAttribute('data-profile-tab');
      await expect(tab).toBeVisible();
      expect(await tab.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      if (destination === 'logout') continue;
      await tab.click();
      await expect(page.locator(`[data-profile-section="${destination}"]`)).toHaveClass(/is-active/);
      await expect(page.locator('.profile-section.is-active')).toHaveCount(1);
      await layout(page, 'account-' + destination, '.profile-page');
      if (destination === 'accreditation' && [320, 768, 1440].includes(width)) await screenshot(page, `${engine}-accreditation-${width}`);
    }
    if ([320, 768, 1440].includes(width)) await screenshot(page, `${engine}-account-${width}`);
  }
  await page.setViewportSize({ width: 740, height: 360 });
  await layout(page, 'account-landscape', '.profile-page');
  expect(await page.locator('html').getAttribute('data-admin-theme')).toBeNull();
  await page.locator('[data-profile-tab="logout"]').click();
  await expect.poll(async () => (await page.request.get(base + '/api/me')).status()).toBe(401);
  report.interactions.push(engine + ': account options, selected section, logout, independent public theme');
}
async function drawer(page) {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.locator('#sidebarToggle').click();
  await expect(page.locator('.sidebar-close')).toBeFocused();
  expect(await page.locator('.admin-main').evaluate(el => el.inert)).toBe(true);
  await page.keyboard.press('Shift+Tab'); await expect(page.locator('#logoutBtn')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('.sidebar-close')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#sidebarToggle')).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await page.locator('#sidebarToggle').click();
  await page.locator('#sidebarBackdrop').click({ position: { x: 380, y: 200 } });
  await expect(page.locator('#sidebarToggle')).toBeFocused();
  await page.locator('#sidebarToggle').click(); await page.setViewportSize({ width: 1024, height: 600 });
  await expect(page.locator('#sidebarBackdrop')).toBeHidden();
  expect(await page.locator('.admin-main').evaluate(el => el.inert)).toBe(false);
  report.interactions.push('drawer focus loop, Escape, backdrop, breakpoint and scroll restoration');
}
async function calendarAndForms(page) {
  for (const mode of ['light', 'dark']) {
    await theme(page, mode);
    for (const viewport of [{ width: 320, height: 568 }, { width: 740, height: 320 }, { width: 900, height: 650 }]) {
      await page.setViewportSize(viewport); await navigate(page, 'section-dashboard');
      await page.locator('#section-dashboard .finance-range-button').click();
      await expect(page.locator('.finance-picker:visible')).toBeVisible();
      await page.locator('.finance-picker:visible [data-preset="Hoy"]').click();
      await expect(page.locator('.finance-picker:visible [data-preset="Hoy"]')).toBeFocused();
      await page.locator('.finance-picker:visible [data-month="-1"]').click();
      await expect(page.locator('.finance-picker:visible [data-month="-1"]')).toBeFocused();
      await page.locator('.finance-picker:visible [data-day]').nth(8).focus();
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
      await expect(page.locator('.finance-picker:visible [data-day]:focus')).toHaveAttribute('aria-pressed', 'true');
      await layout(page, 'calendar', '.finance-picker:visible');
      await page.locator('.finance-picker:visible [data-apply]').scrollIntoViewIfNeeded();
      await expect(page.locator('.finance-picker:visible [data-apply]')).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(page.locator('#section-dashboard .finance-range-button')).toBeFocused();
      await page.locator('.finance-chart').tap({ position: { x: 120, y: 60 } });
      await expect(page.locator('.finance-tooltip:visible')).toContainText('Facturación');
      await page.locator('.finance-chart').focus(); await page.keyboard.press('ArrowRight');
      await expect(page.locator('.finance-tooltip:visible')).toContainText('Facturación');
      for (const edit of [false, true]) {
        await navigate(page, 'section-products');
        await page.locator(edit ? '[data-edit-product]' : '#createProductBtn').first().click();
        await expect(page.locator('#productModal')).toBeVisible();
        if (!edit) { await page.locator('#productCreationCategories summary').click(); await expect(page.locator('#productCreationCategoryOptions input').first()).toBeVisible(); }
        await layout(page, edit ? 'product-edit' : 'product-create', '#productModal');
        await page.locator('#productSubmitBtn').scrollIntoViewIfNeeded(); await expect(page.locator('#productSubmitBtn')).toBeInViewport();
        expect(await page.locator('#productModal .modal-box').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await page.locator('#productCancelBtn').click();
      }
      await navigate(page, 'section-codes'); await page.locator('#createCodeBtn').click();
      await layout(page, 'code-dialog', '#codeModal');
      await page.locator('#codeSubmitBtn').scrollIntoViewIfNeeded(); await expect(page.locator('#codeSubmitBtn')).toBeInViewport();
      await page.locator('#codeCancelBtn').click();
    }
  }
  report.interactions.push('calendar short heights, keyboard values, category list and product/code forms without writes');
}
async function mailAndStock(page) {
  for (const width of [320, 768, 900, 1440]) {
    await page.setViewportSize({ width, height: 740 }); await navigate(page, 'section-inventory');
    await page.locator('[data-toggle-inventory]').first().click();
    await layout(page, 'inventory-expanded', '#section-inventory');
    await navigate(page, 'section-mails');
    await page.locator('[data-mail-action="account"][data-key="INFO"]').click();
    await page.locator('[data-mail-action="circle"]').first().click();
    await page.locator('[data-mail-action="edit"]').first().click();
    await page.locator('.mail-advanced').evaluate(el => el.open = true);
    await layout(page, 'mail-editor-expanded', '#section-mails');
    await screenshot(page, 'mail-editor-' + width);
  }
  report.interactions.push('expanded inventory and mail editor, existing local templates; initialization POST stubbed');
}
async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'es-ES', hasTouch: true }); await safety(context);
    const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await login(page);
    const sections = await page.locator('.admin-section').evaluateAll(nodes => nodes.map(el => el.id));
    for (const mode of process.env.RESPONSIVE_FOCUS ? [] : ['light', 'dark']) {
      await theme(page, mode);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        for (const section of sections) {
          await navigate(page, section); await layout(page, section, '#' + section);
          if ([320, 768, 1440].includes(width) && ['section-dashboard', 'section-money', 'section-products', 'section-inventory'].includes(section)) await screenshot(page, `chromium-${mode}-${section}-${width}`);
        }
      }
    }
    await theme(page, 'dark'); await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-admin-theme', 'dark');
    await drawer(page); await calendarAndForms(page); await mailAndStock(page); await account(page, 'chromium');
    expect(report.errors).toEqual([]); report.engines.chromium = 'passed';
  } finally { await browser.close(); }
  let webkitBrowser;
  try { webkitBrowser = await webkit.launch(); } catch (error) { report.engines.webkit = error.message; return; }
  try {
    const context = await webkitBrowser.newContext({ locale: 'es-ES', hasTouch: true }); await safety(context);
    const page = await context.newPage(); await login(page); await drawer(page); await calendarAndForms(page); await account(page, 'webkit');
    report.engines.webkit = 'passed';
  } finally { await webkitBrowser.close(); }
}
module.exports = { safety, layout, login, navigate, theme, screenshot, report, out, base };
if (require.main === module) run().catch(error => { report.failure = error.stack; console.error(error.message); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(out, 'review.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ layouts: report.layouts.length, engines: report.engines, failure: !!report.failure, output: out }));
});
