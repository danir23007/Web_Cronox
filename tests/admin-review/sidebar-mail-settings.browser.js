async (page) => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const origin = 'http://127.0.0.1:4173';
  const boxes = ['Información', 'No reply', 'Pedidos', 'Soporte', 'Equipo personalizado'].map((name, i) => ({
    id: String(i + 1), name, address: ['info@cronox.es', 'no-reply@cronox.es', 'orders@cronox.es', 'support@cronox.es', 'team@example.test'][i],
    fromName: 'CRONOX', active: false, notify: false, unread: 0, status: 'PENDING_CONFIG',
    provider: 'hostinger', smtpPort: 465, sentCopy: 'append', permissions: [], folders: [], canSend: false,
  }));
  let mutations = 0;
  const setup = async (target, width, theme, documentName = 'admin.html') => {
    await target.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith('/api/')) {
        if (route.request().method() !== 'GET') { mutations++; return route.abort(); }
        let json = {};
        if (url.pathname.endsWith('/overview')) json = { boxes, superadmin: true, workerEnabled: false, sendEnabled: false, credentialRefs: [], suggestions: [{ name: 'NOREPLY', address: 'no-reply@cronox.es' }] };
        if (url.pathname.endsWith('/administrators')) json = [];
        return route.fulfill({ json });
      }
      if (url.pathname.endsWith('.html')) {
        const response = await route.fetch();
        return route.fulfill({ response, body: (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') });
      }
      return route.continue();
    });
    await target.setViewportSize({ width, height: 900 });
    await target.goto(origin + '/' + documentName);
    await target.evaluate(theme => {
      document.documentElement.dataset.adminTheme = theme;
      document.querySelector('.admin-shell').hidden = false;
      document.querySelector('#adminAuthCheck')?.remove();
      document.querySelectorAll('.admin-section').forEach(el => { el.hidden = el.id !== 'section-inbox'; });
      window.CRONOX_API = { API_BASE: '', getCsrfHeaders: async () => ({}) };
    }, theme);
    await target.addScriptTag({ url: origin + '/assets/admin-shell.js' });
    await target.evaluate(() => {
      window.menuViolations = [];
      new MutationObserver(() => {
        const open = document.querySelectorAll('.sidebar-group[aria-expanded="true"]');
        if (open.length > 1) window.menuViolations.push(open.length);
        open.forEach(button => {
          if (document.getElementById(button.getAttribute('aria-controls')).hidden) window.menuViolations.push('aria');
        });
      }).observe(document.querySelector('#adminSidebar'), { subtree: true, attributes: true });
      document.querySelectorAll('#adminSidebar [data-nav-target]').forEach(button => button.addEventListener('click', () => {
        window.CRONOX_ADMIN_SHELL.select(button.dataset.navTarget);
        location.hash = button.dataset.navTarget;
      }));
    });
    if (documentName === 'admin.html') {
      await target.addScriptTag({ url: origin + '/assets/admin-inbox.js' });
      await target.evaluate(() => window.CRONOX_INBOX.load());
    }
  };
  const expectOpen = async (target, id) => {
    const actual = await target.locator('.sidebar-group[aria-expanded="true"]').evaluateAll(nodes => nodes.map(el => el.getAttribute('aria-controls')));
    assert(JSON.stringify(actual) === JSON.stringify(id ? [id] : []), `Expected ${id || 'closed'}; got ${actual}`);
  };
  const outside = async target => { await target.mouse.move(700, 20); };
  const checks = [];
  for (const theme of ['light', 'dark']) {
    await page.unrouteAll({ behavior: 'wait' });
    await setup(page, 1366, theme);
    const a = page.locator('[aria-controls="navProducto"]');
    const b = page.locator('[aria-controls="navMultimedia"]');
    await a.click(); await expectOpen(page, 'navProducto');
    const storage = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]);
    await b.hover(); await expectOpen(page, 'navMultimedia');
    assert(JSON.stringify(await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)])) === JSON.stringify(storage), 'Hover is not persisted');
    await outside(page); await expectOpen(page, 'navProducto');
    await b.hover(); await b.click(); await expectOpen(page, 'navMultimedia');
    await b.click(); await expectOpen(page, null);
    await page.mouse.move((await b.boundingBox()).x + 20, (await b.boundingBox()).y + 15);
    await expectOpen(page, null);
    await outside(page); await b.hover(); await expectOpen(page, 'navMultimedia');
    await outside(page); await expectOpen(page, null);
    await a.hover(); await b.hover(); await expectOpen(page, 'navMultimedia');
    await page.locator('#navMultimedia [data-nav-target="section-gallery-mosaic"]').hover();
    await expectOpen(page, 'navMultimedia');
    await page.locator('#navMultimedia [data-nav-target="section-gallery-mosaic"]').click();
    assert(new URL(page.url()).hash === '#section-gallery-mosaic', 'Submenu navigation');
    await outside(page); await expectOpen(page, 'navMultimedia');
    await a.hover(); // A focused submenu link must remain usable even when hovering elsewhere.
    await expectOpen(page, 'navMultimedia');
    await a.focus(); await a.press('Enter'); await expectOpen(page, 'navProducto');
    await a.press('Space'); await expectOpen(page, null);
    await a.press('Enter'); await a.press('Tab');
    assert(await page.locator('#navProducto button').first().evaluate(el => el === document.activeElement), 'Tab reaches submenu');
    await outside(page); await expectOpen(page, 'navProducto');
    await page.locator('[data-settings]').click();
    const settings = page.locator('.mail-settings');
    await settings.locator('[data-edit-box="2"]').click();
    await page.waitForFunction(() => document.querySelector('.mail-settings [name="address"]').value === 'no-reply@cronox.es');
    assert(await settings.locator('[name="name"]').inputValue() === 'No-reply', 'Legacy default corrected');
    assert(await settings.locator('[name="address"]').inputValue() === 'no-reply@cronox.es', 'Address unchanged');
    assert(await settings.locator('[name="address"]').getAttribute('readonly') !== null, 'Existing configuration');
    assert(await settings.locator('[data-edit-box="2"]').innerText() === 'No-reply', 'Settings button label');
    await settings.locator('[data-edit-box="5"]').click();
    await page.waitForFunction(() => document.querySelector('.mail-settings [name="name"]').value === 'Equipo personalizado');
    assert(await settings.locator('[name="name"]').inputValue() === 'Equipo personalizado', 'Custom name preserved');
    for (const box of boxes.slice(0, 4)) {
      await settings.locator(`[data-edit-box="${box.id}"]`).click();
      await page.waitForFunction(address => document.querySelector('.mail-settings [name="address"]').value === address, box.address);
      assert(await settings.locator('[name="address"]').inputValue() === box.address, 'Correct mailbox selected');
    }
    await settings.locator('[data-add-box]').click();
    await page.waitForFunction(() => document.querySelector('.mail-settings [name="address"]').value === '');
    assert(await settings.locator('[name="address"]').inputValue() === '', 'New mailbox address empty');
    assert(await settings.locator('[name="address"]').getAttribute('readonly') === null, 'Creation address editable');
    assert(await settings.locator('[name="name"]').inputValue() === '', 'Creation name empty');
    await page.locator('h3').filter({ hasText: 'Configuración de buzones' }).click();
    const colors = await settings.locator('[data-add-box]').evaluate(el => {
      const s = getComputedStyle(el); return [s.backgroundColor, s.color];
    });
    assert(colors[0] === 'rgb(255, 255, 255)' && colors[1] === 'rgb(0, 0, 0)', 'White/black action in both themes');
    await settings.locator('[data-add-box]').focus();
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    assert(await settings.locator('[data-add-box]').evaluate(el => getComputedStyle(el).outlineStyle !== 'none'), 'Visible focus');
    await page.screenshot({ path: `output/playwright/admin-mail-settings-${theme}-1366.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('#adminSidebar').getBoundingClientRect().right <= 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile overflow');
    await page.screenshot({ path: `output/playwright/admin-mail-settings-${theme}-390.png`, fullPage: true });
    assert(await page.evaluate(() => !window.menuViolations.length), 'Single coherent submenu');
    checks.push(`desktop + mobile layout, ${theme}`);
  }
  boxes[1].name = 'Avisos personalizados';
  await page.evaluate(() => window.CRONOX_INBOX.load());
  await page.locator('[data-settings]').click();
  await page.locator('[data-edit-box="2"]').click();
  await page.waitForFunction(() => document.querySelector('.mail-settings [name="address"]').value === 'no-reply@cronox.es');
  assert(await page.locator('.mail-settings [name="name"]').inputValue() === 'Avisos personalizados', 'Custom name on actual No-reply address preserved');
  assert(await page.locator('[data-edit-box="2"]').innerText() === 'Avisos personalizados', 'Custom No-reply selector preserved');
  boxes[1].name = 'No reply';
  const browser = page.context().browser();
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const mobile = await touch.newPage();
    for (const theme of ['light', 'dark']) for (const doc of ['admin.html', 'admin-user.html']) {
      await mobile.unrouteAll({ behavior: 'wait' });
      await setup(mobile, 390, theme, doc);
      await mobile.locator('#sidebarToggle').tap();
      const a = mobile.locator('[aria-controls="navProducto"]'), b = mobile.locator('[aria-controls="navMultimedia"]');
      await a.tap(); await expectOpen(mobile, 'navProducto');
      await b.tap(); await expectOpen(mobile, 'navMultimedia');
      await b.tap(); await expectOpen(mobile, null);
      await a.tap();
      await mobile.locator('#navProducto [data-nav-target="section-products"]').tap();
      assert(await mobile.locator('#sidebarToggle').getAttribute('aria-expanded') === 'false', 'Mobile drawer closes on navigation');
      await mobile.locator('#sidebarToggle').tap(); await expectOpen(mobile, 'navProducto');
      await mobile.waitForFunction(() => document.querySelector('#adminSidebar').getBoundingClientRect().left >= 0);
      assert(await mobile.locator('[data-nav-target="section-products"][aria-current="page"]').count() === 1, 'Current page highlight');
      await mobile.screenshot({ path: `output/playwright/admin-menu-${doc}-${theme}-touch.png` });
      assert(await mobile.evaluate(() => !window.menuViolations.length), 'Single mobile group');
      checks.push(`touch ${doc} ${theme}`);
    }
  } finally { await touch.close(); }
  assert(mutations === 0, 'Read-only review made no API mutations');
  console.log(JSON.stringify({ checks, apiMutations: mutations, result: 'PASS' }));
}
