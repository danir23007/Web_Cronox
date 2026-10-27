// Built UI with isolated HTTP fixtures; no project account or event is changed.
async page => {
  const origin = 'http://127.0.0.1:4173';
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const results = [];
  for (const scenario of ['none', 'one', 'several', 'changed', 'protected', 'preview-error']) {
    const context = await page.context().browser().newContext({ viewport: { width: ['several', 'changed'].includes(scenario) ? 320 : 1366, height: 900 } });
    const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000050';
    const user = { id: 50, identityUid: uid, memberCode: 'CRX-000050', name: 'Persona ficticia QR', email: 'qr-fixture@example.test', role: 'USER', accountState: 'ACTIVE', circle: 1, updatedAt: '2026-10-27T10:00:00.000Z' };
    let count = ['none', 'preview-error'].includes(scenario) ? 0 : scenario === 'several' ? 2 : 1;
    let writes = 0, changed = false, deleted = false;
    const plan = () => ({ user, qr: { token: (changed ? 'b' : 'a').repeat(64), count, eventCount: count,
      events: ['Evento ficticio A', 'Evento ficticio B'].slice(0, count).map((name, i) => ({ id: String(i), name, count: 1 })) },
      blockers: scenario === 'protected' ? [{ relation: 'Order.userId', count: 1, description: 'pedidos y su historial financiero' }] : [] });
    await context.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/assets/runtime-config.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.__CRONOX_API_BASE__=location.origin;' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let data = {};
      if (url.pathname === '/api/me') data = { id: 999, role: 'SUPERADMIN', accountState: 'ACTIVE' };
      else if (url.pathname === '/api/auth/csrf') data = { csrfToken: 'isolated-fixture' };
      else if (url.pathname.endsWith('/deletion-preview')) {
        check(req.headers()['x-cronox-user-identity'] === uid, 'Preview missing permanent identity');
        await new Promise(r => setTimeout(r, 180));
        if (scenario === 'preview-error') return route.fulfill({ status: 503, json: { message: 'No se pudo consultar los eventos de prueba' } });
        data = plan();
      } else if (url.pathname === '/api/admin/users/50') {
        if (req.method() === 'DELETE') {
          writes++; const body = req.postDataJSON();
          check(body.confirmed && body.expectedUpdatedAt === user.updatedAt, 'Missing explicit versioned consent');
          check(body.qrParticipationToken === plan().qr.token, 'Missing reviewed fingerprint');
          check(count ? body.deleteQrParticipations === true : !body.deleteQrParticipations, 'Incorrect QR consent');
          await new Promise(r => setTimeout(r, 180));
          if (scenario === 'changed' && !changed) {
            changed = true; count = 2;
            return route.fulfill({ status: 409, json: { code: 'USER_DELETE_QR_CONFIRMATION_CHANGED', message: 'Las participaciones QR requieren una confirmación actualizada.', preview: plan() } });
          }
          deleted = true; return route.fulfill({ json: { deleted: true } });
        }
        data = { user, stats: { ordersCount: 0, totalSpent: 0 } };
      } else if (url.pathname === '/api/admin/users') data = { data: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 } };
      else if (/audit-logs|\/notes|\/orders|\/requests/.test(url.pathname)) data = { data: [], meta: { total: 0, totalPages: 1 } };
      else if (/products|categories/.test(url.pathname)) data = { items: [], data: [], meta: { total: 0 } };
      return route.fulfill({ json: data });
    });
    const tab = await context.newPage();
    try {
      await tab.goto(`${origin}/admin-user.html?id=50&uid=${uid}#usuarios&q=fixture`);
      await tab.locator('#summaryEmail').filter({ hasText: user.email }).waitFor();
      await tab.locator('#deleteUser').click();
      check(await tab.locator('#confirmDeleteUser').isDisabled(), 'Preview loading must disable confirmation');
      if (scenario === 'preview-error') {
        await tab.locator('#deleteUserError').filter({ hasText: 'No se pudo consultar' }).waitFor();
        check(await tab.locator('#confirmDeleteUser').isDisabled(), 'Failed preview allows deletion');
        await tab.locator('#cancelDeleteUser').click(); check(writes === 0, 'Preview error modified account');
        results.push({ scenario, safe: true }); continue;
      }
      await tab.waitForFunction(() => !document.getElementById('deleteUserWarning').textContent.startsWith('Comprobando'));
      check((await tab.locator('#deleteUserEvents li').count()) === count, 'Missing event names/count');
      for (const [selector, text] of [['#deleteUserName', user.name], ['#deleteUserEmail', user.email], ['#deleteUserCrx', user.memberCode]]) check((await tab.locator(selector).textContent()) === text, 'Wrong account identity');
      check(await tab.locator('#deleteUserDialog').evaluate(el => { const r=el.getBoundingClientRect(); return r.left >=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; }), 'Dialog exceeds viewport');
      if (scenario === 'protected') {
        check(await tab.locator('#confirmDeleteUser').isDisabled(), 'Financial history not blocked');
        check((await tab.locator('#deleteUserError').textContent()).includes('pedidos'), 'Missing concrete blocker');
        await tab.locator('#cancelDeleteUser').click(); check(writes === 0, 'Protected account modified');
        results.push({ scenario, safe: true }); continue;
      }
      check((await tab.locator('#confirmDeleteUser').textContent()) === (count ? 'Sí, eliminar usuario y participaciones' : 'Eliminar definitivamente'), 'Wrong explicit label');
      await tab.locator('#cancelDeleteUser').click(); check(writes === 0 && !deleted, 'Cancel modified data');
      await tab.locator('#deleteUser').click(); await tab.locator('#confirmDeleteUser').waitFor({state:'visible'});
      await tab.waitForFunction(() => !document.getElementById('confirmDeleteUser').disabled);
      await tab.screenshot({ path: `output/playwright/user-qr-${scenario}.png`, fullPage: true });
      await tab.locator('#confirmDeleteUser').evaluate(el => { el.click(); el.click(); });
      check(await tab.locator('#confirmDeleteUser').isDisabled(), 'Double click not fenced');
      if (scenario === 'changed') {
        await tab.locator('#deleteUserReview').waitFor({ state:'visible' });
        check(!deleted && writes === 1, 'Changed scope was deleted automatically');
        check(await tab.locator('#deleteUserEvents li').count() === 2, 'New event missing');
        check(await tab.locator('#confirmDeleteUser').isDisabled(), 'New scope requires review');
        await tab.locator('#confirmDeleteUser').evaluate(el => { el.click(); el.click(); });
        check(writes === 1, 'Fast repeat authorized unreviewed scope');
        await tab.screenshot({ path: 'output/playwright/user-qr-changed-review.png', fullPage: true });
        await tab.locator('#reviewDeleteUserChanges').check(); await tab.locator('#confirmDeleteUser').click();
      }
      await tab.waitForURL('**/admin.html#usuarios*');
      check(deleted && writes === (scenario === 'changed' ? 2 : 1), 'Unexpected deletion requests');
      check(await tab.evaluate(() => Boolean(localStorage.getItem('cronox:qr-participations-revision'))), 'Missing cross-tab refresh marker');
      results.push({ scenario, cancelSafe: true, writes, explicitlyConfirmed: true });
    } finally { await context.close(); }
  }
  return { realDataModified: false, results };
}
