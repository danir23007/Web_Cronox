const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, expect } = require('@playwright/test');

const base = 'http://127.0.0.1:4173';
const output = path.resolve('test-results/password-visibility');
fs.mkdirSync(output, { recursive: true });

async function checkField(page, selector, label) {
  const input = page.locator(selector);
  await expect(input).toHaveCount(1);
  const button = input.locator('xpath=..').locator('.password-eye');
  await expect(button).toHaveCount(1);
  await expect(button).toBeHidden();
  assert.equal(await input.getAttribute('type'), 'password', label);

  await input.focus();
  await input.pressSequentially('Clave123');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-label', 'Mostrar contraseña');
  const box = await input.evaluate(el => {
    const eye = el.nextElementSibling;
    const field = el.getBoundingClientRect(), control = eye.getBoundingClientRect();
    return { gap: field.right - control.right, height: control.height,
      width: control.width, padding: parseFloat(getComputedStyle(el).paddingRight),
      inside: control.left >= field.left && control.top >= field.top && control.bottom <= field.bottom };
  });
  assert(box.gap >= 0 && box.gap <= 2 && box.inside, `${label}: eye outside input`);
  assert(box.height >= 44 && box.width >= 44 && box.padding >= box.width + 8, `${label}: touch target or text padding`);

  await input.focus();
  await input.evaluate(el => el.setSelectionRange(3, 3));
  await button.click();
  assert.equal(await input.getAttribute('type'), 'text', label);
  await expect(button).toHaveAttribute('aria-label', 'Ocultar contraseña');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => input.evaluate(el => el.selectionStart)).toBe(3);
  assert.equal(await input.evaluate(el => document.activeElement === el), true, `${label}: focus moved`);
  assert.equal(await input.inputValue(), 'Clave123', `${label}: value changed`);

  await button.focus();
  await page.keyboard.press('Enter');
  assert.equal(await input.getAttribute('type'), 'password', `${label}: keyboard hide`);
  assert.equal(await button.evaluate(el => document.activeElement === el), true, `${label}: button focus moved`);
  await page.keyboard.press('Space');
  assert.equal(await input.getAttribute('type'), 'text', `${label}: keyboard show`);
  await input.fill('');
  await expect(button).toBeHidden();
  assert.equal(await input.getAttribute('type'), 'password', `${label}: clear did not conceal`);

  // Browser/password-manager autofill can set value without an input event.
  await input.evaluate(el => { el.value = 'filled-silently'; });
  await expect(button).toBeVisible({ timeout: 1500 });
  await button.click();
  await input.evaluate(el => { el.value = ''; });
  await expect(button).toBeHidden({ timeout: 1500 });
  assert.equal(await input.getAttribute('type'), 'password', `${label}: silent clear did not conceal`);
  return button;
}

async function runEngine(engine, name) {
  const browser = await engine.launch();
  let checks = 0;
  try {
    for (const width of [320, 390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, locale: 'es-ES', hasTouch: width < 500 });
      await context.route('**/api/**', route => route.fulfill({ status: 401, json: { message: 'Test only' } }));
      await context.addInitScript(() => {
        document.cookie = 'cronox_cookie_consent=' + encodeURIComponent(JSON.stringify({ necessary:true, preferences:false, analytics:false, marketing:false, consentVersion:'2', timestamp:new Date().toISOString() })) + '; path=/';
        sessionStorage.setItem('cronox_newsletter_seen', '1');
      });
      const page = await context.newPage();

      await page.goto(base + '/admin-login.html');
      await expect(page.locator('#adminLoginForm')).toBeVisible();
      await page.evaluate(() => { window.eyeSubmits = 0; document.querySelector('#adminLoginForm').addEventListener('submit', e => { window.eyeSubmits++; e.preventDefault(); }, true); });
      for (const theme of ['light', 'dark']) {
        await page.locator('html').evaluate((el, mode) => el.dataset.adminTheme = mode, theme);
        await checkField(page, '#adminLoginPassword', `${name}/${width}/admin/${theme}`);
        checks++;
        if (name === 'chromium' && theme === 'light') {
          await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
          await page.evaluate(() => navigator.clipboard.writeText('Pasted123'));
          await page.locator('#adminLoginPassword').focus();
          await page.keyboard.press('ControlOrMeta+V');
          await expect(page.locator('#adminLoginPassword')).toHaveValue('Pasted123');
          await expect(page.locator('#adminLoginPassword + .password-eye')).toBeVisible();
          await page.locator('#adminLoginPassword').fill('');
        }
      }
      assert.equal(await page.evaluate(() => window.eyeSubmits), 0, 'eye submitted admin login');
      if (width === 320) {
        await page.locator('#adminLoginPassword').fill('Ejemplo123');
        await page.screenshot({ path: path.join(output, `${name}-admin-mobile.png`) });
        await page.locator('#adminLoginPassword').fill('');
      }

      await page.goto(base + '/reset-password.html?token=local-test-token');
      for (const selector of ['[name="password"]', '[name="passwordConfirm"]']) {
        await checkField(page, selector, `${name}/${width}/reset/${selector}`);
        checks++;
      }
      await page.locator('[name="password"]').fill('first');
      await page.locator('[name="passwordConfirm"]').fill('second');
      await page.locator('[name="password"] + .password-eye').click();
      assert.equal(await page.locator('[name="password"]').getAttribute('type'), 'text');
      assert.equal(await page.locator('[name="passwordConfirm"]').getAttribute('type'), 'password');
      await page.locator('#resetForm').evaluate(form => form.reset());
      await expect(page.locator('#resetForm .password-eye:visible')).toHaveCount(0);
      assert.equal(await page.locator('[name="password"]').getAttribute('type'), 'password');

      await page.goto(base + '/');
      await expect(page.locator('#authOverlay')).toHaveCount(1);
      await page.locator('#profileBtn').click();
      await expect(page.locator('#authOverlay')).toBeVisible();
      await page.waitForTimeout(500); // Let the auth modal's own initial-focus animation finish.
      await checkField(page, '#authLoginPassword', `${name}/${width}/public/login`); checks++;
      await page.locator('[data-auth-switch="register"]').click();
      await checkField(page, '#authRegisterPassword', `${name}/${width}/public/register`); checks++;
      if (width === 320) await page.screenshot({ path: path.join(output, `${name}-public-mobile.png`) });

      // The auth modal is loaded dynamically. Future password fields use the same single installer.
      await page.locator('#authRegisterForm').evaluate(form => {
        const input = document.createElement('input'); input.type = 'password'; input.id = 'dynamicPassword';
        form.append(input);
      });
      await checkField(page, '#dynamicPassword', `${name}/${width}/dynamic`);
      await expect(page.locator('#dynamicPassword').locator('xpath=..').locator('.password-eye')).toHaveCount(1);
      checks++;
      await context.close();
    }
  } finally { await browser.close(); }
  return checks;
}

(async () => {
  const results = {};
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) results[name] = await runEngine(engine, name);
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
