async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  for (const width of [1366, 390]) for (const hasPassword of [false, true]) {
    let requests = 0, fail = true;
    await page.unrouteAll({ behavior: 'wait' });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let data = {};
      if (url.pathname === '/api/me') data = { id: 777, email: 'profile@example.test', firstName: 'Cliente', lastName: 'Local', memberCode: 'LOCAL777', circleLevel: 1, role: 'USER', hasPassword, createdAt: '2026-10-04T10:00:00Z' };
      if (url.pathname === '/api/auth/csrf') data = { csrfToken: 'local-ui-fixture' };
      if (url.pathname.endsWith('/orders') || url.pathname.endsWith('/favorites')) data = [];
      if (url.pathname === '/api/me/address') data = null;
      if (url.pathname === '/api/cart') data = { items: [], subtotalCents: 0, totalCents: 0 };
      if (url.pathname === '/api/auth/change-password') {
        requests++;
        const body = route.request().postDataJSON();
        assert(body.newPassword === 'abcdefg', 'password was changed silently');
        assert(hasPassword ? body.currentPassword === 'existing-local' : !('currentPassword' in body), 'current password state mismatch');
        assert(route.request().headers()['x-csrf-token'] === 'local-ui-fixture', 'missing CSRF protection');
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({ status: fail ? 400 : 200, json: fail ? { message: 'Error local recuperable' } : { ok: true, hasPassword: true } });
      }
      return route.fulfill({ json: data });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://127.0.0.1:4173/profile.html');
    if (await page.getByRole('button', { name: 'RECHAZAR', exact: true }).isVisible()) await page.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
    await page.getByRole('button', { name: 'Configuración de la cuenta', exact: true }).click();
    const action = page.getByRole('button', { name: hasPassword ? 'Cambiar contraseña' : 'Establecer contraseña', exact: true });
    await action.click();
    assert(await page.locator('#currentPassword').isVisible() === hasPassword, 'current password visibility');
    if (hasPassword) await page.locator('#currentPassword').fill('existing-local');
    await page.locator('#newPassword').fill('abcdef');
    await page.locator('#confirmPassword').fill('abcdef');
    await page.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
    assert(requests === 0, 'six characters were sent');
    assert((await page.locator('#passwordMessage').textContent()).includes('7 caracteres'), 'minimum length message missing');
    await page.locator('#newPassword').fill('abcdefg');
    await page.locator('#confirmPassword').fill('abcdefg');
    const label = page.locator('label').filter({ has: page.locator('#newPassword') });
    await label.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
    assert(await page.locator('#newPassword').getAttribute('type') === 'text', 'eye did not reveal typed new password');
    await label.getByRole('button', { name: 'Ocultar contraseña', exact: true }).click();
    assert(await page.locator('#newPassword').getAttribute('type') === 'password', 'eye did not conceal password');
    await page.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('passwordMessage').textContent === 'Error local recuperable');
    assert(await page.locator('#newPassword').inputValue() === 'abcdefg', 'recoverable error discarded input');
    assert(await page.locator('#confirmPassword').inputValue() === 'abcdefg', 'recoverable error discarded confirmation');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
    await page.screenshot({ path: `output/playwright/profile-password-${width}-${hasPassword ? 'change' : 'setup'}.png`, fullPage: true });
    fail = false;
    await page.locator('#passwordForm').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await page.waitForFunction(() => document.getElementById('passwordMessage').textContent === 'Contraseña guardada correctamente.');
    assert(requests === 2, 'duplicate submission escaped the in-flight guard');
    assert((await page.locator('#passwordStatus').textContent()) === 'Contraseña establecida', 'state did not update');
    assert(await page.locator('#newPassword').inputValue() === '', 'successful save retained password');
    assert(!(await page.locator('#passwordForm').isVisible()), 'successful form remains open');
  }
  console.log('Desktop/mobile setup/change, visibility, validation, error retention, CSRF, duplicate submission and state verified. All API and email data synthetic/local.');
}
