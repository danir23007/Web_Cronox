// playwright-cli run-code --filename tests/users/review-browser.cli.js
async (page) => {
  const origin = 'http://127.0.0.1:43130';
  const fixture = await (await page.request.get(origin + '/__fixture')).json();
  const expected = fixture.detail.user.memberCode;
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  page = await context.newPage();
  const errors = [], mutations = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  await context.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') { mutations.push(route.request().method()); return route.fulfill({ status: 405, json: {} }); }
    const url = new URL(route.request().url()), p = url.pathname;
    if (p === '/api/me' || p === '/api/auth/me') return route.fulfill({ json: page.url().includes('profile') ? fixture.profile : { id: 999, role: 'SUPERADMIN', accountState: 'ACTIVE', email: 'admin@example.test', hasPassword: true } });
    if (p === '/api/me/profile') return route.fulfill({ json: fixture.profile });
    if (p === '/api/admin/users') return route.fulfill({ json: fixture.list });
    if (p === '/api/admin/users/' + fixture.detail.user.id) return route.fulfill({ json: fixture.detail });
    if (p.endsWith('/edit-options')) return route.fulfill({ json: { roles: ['USER','FRIEND','ADMIN','SUPERADMIN'], accountStates: ['ACTIVE','PENDING_PASSWORD','PRE_REGISTERED'], circles: [1,2,3,4,5] } });
    if (p.endsWith('/dashboard/pending-counts')) return route.fulfill({ json: {} });
    if (p === '/api/membership/me/qr') return route.fulfill({ response: await page.request.get(origin + '/__qr') });
    if (p === '/api/membership/me/stats') return route.fulfill({ json: { circleLevel: 1, createdAt: fixture.profile.createdAt, pedidosRealizados: 0, articulosAdquiridos: 0, productosDiferentes: 0 } });
    if (p === '/api/cart') return route.fulfill({ json: { items: [], itemsCount: 0 } });
    if (p === '/api/favorites') return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], data: [], meta: { total: 0, page: 1, totalPages: 1 } } });
  });
  try {
    await page.goto(origin + '/admin.html#section-users');
    await page.locator('[data-nav-target="section-users"]').first().click();
    await page.waitForFunction(code => document.querySelector('#usersBody')?.textContent.includes(code), expected);
    const row = page.locator('#usersBody tr').filter({ hasText: fixture.profile.email });
    check((await row.innerText()).includes(expected), 'User list public ID mismatch');
    check((await row.innerText()).includes('Prerregistrado'), 'Newsletter account must appear with correct pending state');
    await page.screenshot({ path: 'output/playwright/user-identity/users-desktop.png' });
    await row.getByRole('link', { name: 'Ver', exact: true }).click();
    await page.waitForFunction(code => document.querySelector('#summaryId')?.textContent === code, expected);
    await page.screenshot({ path: 'output/playwright/user-identity/detail-desktop.png' });
    await page.locator('#editUser').click();
    check((await page.locator('#summaryId').innerText()) === expected, 'Individual editing must preserve public ID');
    await page.screenshot({ path: 'output/playwright/user-identity/edit-desktop.png' });
    await page.goto(origin + '/profile.html#accreditation');
    const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true }); if (await reject.isVisible()) await reject.click();
    const acc = page.locator('[data-profile-section="accreditation"]');
    await page.locator('[data-profile-tab="accreditation"]').click();
    await page.waitForFunction(code => document.querySelector('.accreditation-id')?.textContent === 'ID: ' + code, expected);
    await page.locator('#cronox-member-qr').waitFor({ state: 'visible' });
    check(await page.locator('#cronox-member-qr').evaluate(img => img.complete && img.naturalWidth > 0), 'Real QR must load');
    await acc.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    await page.screenshot({ path: 'output/playwright/user-identity/accreditation-desktop.png' });
    await page.emulateMedia({ media: 'print' });
    check((await page.locator('.accreditation-id').innerText()) === 'ID: ' + expected, 'Print must preserve the public ID');
    await page.screenshot({ path: 'output/playwright/user-identity/accreditation-print.png' });
    await page.emulateMedia({ media: 'screen' });
    await page.setViewportSize({ width: 390, height: 844 }); await acc.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    await page.screenshot({ path: 'output/playwright/user-identity/accreditation-mobile.png' });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile accreditation must not overflow');
    check(errors.length === 0 && mutations.length === 0, 'Unexpected JS errors or business writes');
    return { expected, table: expected, detail: expected, accreditation: expected, pendingAccountVisible: true, QR: 'loaded', errors, mutations };
  } finally { await context.close(); }
}
