// Real built admin UI + isolated in-memory API. No saved account is modified.
async page => {
  const origin = 'http://127.0.0.1:4173';
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const results = [];
  for (const scenario of ['middle', 'last-page', 'dark', 'self', 'admin']) {
    const context = await page.context().browser().newContext({ viewport: { width: scenario === 'last-page' ? 390 : 1366, height: 900 } });
    const target = scenario === 'last-page' ? 101 : scenario === 'self' ? 999 : 50;
    const uid = id => `aaaaaaaa-aaaa-4aaa-8aaa-${String(id).padStart(12,'0')}`;
    let users = Array.from({ length: 101 }, (_, index) => ({ id: index+1, identityUid: uid(index+1),
      memberCode: `CRX-${String(index+1).padStart(6,'0')}`, email: `fixture-${index+1}@example.test`,
      name: 'Persona de prueba', role: 'USER', accountState: index%2 ? 'INACTIVE' : 'ACTIVE', circle: 1,
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', revenueCents: 0 }));
    const actor = { id: 999, identityUid: uid(999), memberCode: 'CRX-000999', email: 'admin@example.test',
      role: scenario === 'admin' ? 'ADMIN' : 'SUPERADMIN', accountState: 'ACTIVE' };
    let writes = 0, fail = scenario === 'middle'; const pages = [];
    await context.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
    if (scenario === 'dark') await context.addInitScript(() => localStorage.setItem('cronox.admin.theme', 'dark'));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/assets/runtime-config.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.__CRONOX_API_BASE__=location.origin;' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let data = {};
      if (url.pathname === '/api/me') data = actor;
      else if (url.pathname === `/api/admin/users/${target}/deletion-preview`) data = {
        user: users.find(user => user.id === target), qr: { token: 'a'.repeat(64), count: 0, eventCount: 0, events: [] }, blockers: []
      };
      else if (url.pathname === '/api/auth/csrf') data = { csrfToken: 'isolated-fixture' };
      else if (url.pathname === `/api/admin/users/${target}`) {
        if (request.method() === 'DELETE') {
          writes++; const body = request.postDataJSON();
          check(body.confirmed === true && body.expectedUpdatedAt, 'Deletion missing explicit versioned confirmation');
          check(request.headers()['x-cronox-user-identity'] === uid(target), 'Missing stable identity header');
          await new Promise(resolve => setTimeout(resolve,300));
          if (fail) { fail = false; return route.fulfill({ status: 500, json: { message: 'Fallo temporal de prueba. La cuenta conserva sus datos.' } }); }
          users = users.filter(user => user.id !== target); return route.fulfill({ json: { deleted: true, id: target } });
        }
        data = { user: target === 999 ? { ...actor, updatedAt: '2026-10-01T00:00:00Z' } : users.find(user => user.id === target), stats: { ordersCount: 0, totalSpent: 0 } };
      } else if (url.pathname === '/api/admin/users') {
        const number = Number(url.searchParams.get('page') || 1); pages.push(number);
        const rows = users.map((user,index) => ({ ...user, registrationNumber: index+1 }));
        data = { data: rows.slice((number-1)*100,number*100), meta: { page: number, pageSize: 100, total: users.length, totalPages: Math.ceil(users.length/100) } };
      } else if (url.pathname.includes('audit-logs') || url.pathname.includes('/notes') || url.pathname.includes('/orders') || url.pathname.includes('/requests')) data = { data: [], meta: { total: 0, totalPages: 1 } };
      else if (url.pathname.includes('/products') || url.pathname.includes('/categories')) data = { items: [], data: [], meta: { total: 0 } };
      return route.fulfill({ json: data });
    });
    const tab = await context.newPage();
    try {
      const hash = `#usuarios&q=fixture&role=USER&page=${scenario === 'last-page' ? 2 : 1}&sort=id%3Aasc`;
      await tab.goto(`${origin}/admin-user.html?id=${target}&uid=${uid(target)}${hash}`);
      await tab.waitForFunction(() => document.documentElement.dataset.adminAuthState === 'authorized');
      await tab.locator('#summaryEmail').filter({ hasText: /example.test/ }).waitFor();
      if (['self','admin'].includes(scenario)) {
        check(await tab.locator('#deleteUser').isHidden(), 'Unauthorized/self destructive action visible');
        check(writes === 0, 'Unauthorized deletion sent'); results.push({ scenario, hidden: true }); continue;
      }
      await tab.locator('#deleteUser').click();
      await tab.locator('#deleteUserDialog').waitFor({ state: 'visible' });
      check(await tab.locator('#confirmDeleteUser').evaluate(el => getComputedStyle(el).backgroundColor === 'rgb(165, 28, 50)'), 'Destructive style overridden by admin shell');
      check(await tab.locator('#deleteUserDialog').evaluate(el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth), 'Dialog exceeds viewport');
      check((await tab.locator('#deleteUserEmail').textContent()) === `fixture-${target}@example.test`, 'Wrong confirmation email');
      check((await tab.locator('#deleteUserCrx').textContent()) === `CRX-${String(target).padStart(6,'0')}`, 'Wrong confirmation CRX');
      check((await tab.locator('#deleteUserName').textContent()) === 'Persona de prueba', 'Missing confirmation name');
      await tab.locator('#cancelDeleteUser').click(); check(writes === 0, 'Cancel sent deletion');
      await tab.locator('#deleteUser').click();
      await tab.screenshot({ path: `output/playwright/admin-user-delete-confirm-${scenario}.png`, fullPage: true });
      if (scenario === 'middle') {
        await tab.locator('#confirmDeleteUser').click();
        await tab.locator('#deleteUserError').filter({ hasText: 'Fallo temporal' }).waitFor();
        check(users.some(user => user.id === target), 'Failed deletion changed list');
        check((new URL(tab.url())).pathname === '/admin-user.html', 'Failure navigated away');
      }
      await tab.locator('#confirmDeleteUser').evaluate(button => { button.click(); button.click(); });
      check(await tab.locator('#confirmDeleteUser').isDisabled(), 'Confirmation not disabled during request');
      await tab.waitForURL('**/admin.html#usuarios*');
      await tab.locator('.toast').filter({ hasText: 'Usuario eliminado definitivamente' }).waitFor();
      check(writes === (scenario === 'middle' ? 2 : 1), 'Double click sent duplicate request');
      check(!users.some(user => user.id === target), 'Successful deletion did not update fixture');
      check(!await tab.locator('#usersBody').textContent().then(text => text.includes(`fixture-${target}@example.test`)), 'Deleted row still visible');
      if (scenario === 'last-page') check(pages.includes(2) && pages.at(-1) === 1, 'Empty last page was not clamped/reloaded');
      check(tab.url().includes('q=fixture') && tab.url().includes('sort=id%3Aasc'), 'Return lost search or ordering');
      if (scenario === 'middle') {
        check((await tab.locator('#usersBody tr').last().locator('td').first().textContent()).trim() === '100', 'Ordinal did not compact');
        check((await tab.locator('#usersBody tr').last().textContent()).includes('CRX-000101'), 'Permanent CRX changed');
      }
      await tab.screenshot({ path: `output/playwright/admin-user-delete-result-${scenario}.png`, fullPage: true });
      results.push({ scenario, cancelSafe: true, identification: true, confirmationDisabled: true, errorPreservesAccount: scenario === 'middle', writes, listRefreshed: true, pages });
    } finally { await context.close(); }
  }
  return { isolatedApi: true, realUsersDeleted: false, results };
}
