// Disposable local accounts only. No production credentials, real recipients or orders.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');
const { PrismaClient } = require('../../cronox-backend/node_modules/@prisma/client');
const bcrypt = require('../../cronox-backend/node_modules/bcrypt');
async function run() {
  const env = loadLocalEnvironment(), target = new URL(env.DATABASE_URL);
  assert.equal(target.host, '127.0.0.1:5433'); assert.equal(target.pathname, '/cronox_dev');
  assert.equal(env.EMAIL_ENABLED, 'false'); assert.equal(env.BACKGROUND_JOBS_ENABLED, 'false');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const tag = 'active-qa-' + randomUUID(), password = randomUUID(), ids = [], http = [];
  const browser = await chromium.launch(); const context = await browser.newContext();
  const page = await context.newPage(); let actor;
  mkdirSync('output/playwright/bulk-active-2026-10-06', { recursive: true });
  const post = async (path, data, method = 'post') => {
    await context.request.get('http://localhost:3000/api/auth/csrf');
    const csrf = (await context.cookies()).find(c => c.name === 'cronox_csrf_token');
    return context.request[method]('http://localhost:3000' + path, { data,
      headers: { Origin: 'http://localhost:3000', 'x-csrf-token': decodeURIComponent(csrf.value) } });
  };
  try {
    const hash = await bcrypt.hash(password, 10);
    actor = await db.user.create({ data: { name: tag + ' actor', email: tag + '-actor@example.test',
      password: hash, role: 'SUPERADMIN', accountState: 'ACTIVE' } }); ids.push(actor.id);
    for (let i = 0; i < 13; i++) {
      const user = await db.user.create({ data: { name: tag + ' target ' + i,
        email: tag + '-' + i + '@example.test', accountState: 'PRE_REGISTERED',
        preRegistration: { create: {} } } }); ids.push(user.id);
    }
    page.on('response', async r => {
      if (r.url().includes('/api/admin/bulk/') && r.request().method() === 'POST')
        http.push({ path: new URL(r.url()).pathname, status: r.status() });
    });
    await page.goto('http://localhost:3000/admin.html');
    await page.locator('#adminLoginEmail').fill(actor.email);
    await page.locator('#adminLoginPassword').fill(password);
    await page.locator('#adminLoginSubmit').click();
    await expect(page.locator('#adminLoginSubmit')).toBeHidden();
    await page.goto('http://localhost:3000/admin.html#section-users');
    assert((await page.content()).includes('admin-bulk.js?v=8'), 'Admin must serve the current bulk script');
    const section = page.locator('#section-users');
    await section.locator('details.filters-panel').evaluate(el => { el.open = true; });
    await page.locator('#usersSearch').fill(tag + ' target');
    await expect(page.locator('#usersPageInfo')).toContainText('13 resultados');
    await section.getByRole('button', { name: 'Bulk Edit', exact: true }).click();
    await section.locator('.bulk-select-all input').click();
    await expect(section.locator('.bulk-selection strong')).toHaveText('13 seleccionados');
    await section.getByRole('button', { name: 'Editar seleccionados', exact: true }).click();
    const dialog = page.locator('.admin-bulk-dialog');
    const state = dialog.locator('[data-bulk-field="accountState"]');
    await expect(state).toBeEnabled(); await state.selectOption('ACTIVE');
    await expect(dialog).toContainText('Cambios pendientes de revisión');
    await page.screenshot({ path: 'output/playwright/bulk-active-2026-10-06/pending-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole('button', { name: 'Aplicar cambios', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'output/playwright/bulk-active-2026-10-06/pending-mobile.png' });
    await dialog.getByRole('button', { name: 'Aplicar cambios', exact: true }).click();
    if (process.argv.includes('--reproduce')) {
      await expect(dialog).toContainText('para activar la cuenta debe establecer primero una contraseña');
      assert(http.some(r => r.status === 400));
      assert.equal(await db.user.count({ where: { id: { in: ids.slice(1) }, accountState: 'PRE_REGISTERED', password: null } }), 13);
      await page.screenshot({ path: 'output/playwright/bulk-active-2026-10-06/before.png' });
      console.log(JSON.stringify({ reproduced: true, http, rowsUnchanged: 13, executeSent: false })); return;
    }
    const apply = dialog.getByRole('button', { name: 'Confirmar cambios a 13 usuarios', exact: true });
    await expect(apply).toBeEnabled();
    await expect(dialog).toContainText('Todavía no se ha modificado ningún registro');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: 'output/playwright/bulk-active-2026-10-06/review-desktop.png' });
    assert.equal(await db.user.count({ where: { id: { in: ids.slice(1) }, accountState: 'ACTIVE' } }), 0);
    await apply.evaluate(el => { el.click(); el.click(); }); // Second click must not execute twice.
    await expect(dialog).toContainText('Completado: 13 modificados');
    await expect(page.locator('#usersBody tr')).toHaveCount(13);
    assert.equal(http.filter(r => r.path.endsWith('/execute')).length, 1);
    const saved = await db.user.findMany({ where: { id: { in: ids.slice(1) } } });
    assert(saved.every(u => u.accountState === 'ACTIVE' && u.password === null && u.role === 'USER' && u.circleLevel === 1 && u.sessionVersion === 1));
    assert.equal(await db.authSession.count({ where: { userId: { in: ids.slice(1) } } }), 0);
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.reload(); await expect(page.locator('#usersPageInfo')).toContainText('13 resultados');
    await expect(page.locator('#usersBody .badge').filter({ hasText: /^Activa$/ })).toHaveCount(13);
    await page.screenshot({ path: 'output/playwright/bulk-active-2026-10-06/after.png' });

    // Isolated HTTP failure: backend stays healthy and no write reaches it.
    await section.getByRole('button', { name: 'Bulk Edit', exact: true }).click();
    await section.locator('.bulk-select-all input').click();
    await expect(section.locator('.bulk-selection strong')).toHaveText('13 seleccionados');
    await section.getByRole('button', { name: 'Editar seleccionados', exact: true }).click();
    await expect(state).toBeEnabled(); await state.selectOption('ACTIVE');
    await dialog.locator('[data-bulk-field="circleLevel"]').selectOption('2');
    await dialog.getByRole('button', { name: 'Revisar cambios', exact: true }).click();
    await expect(apply).toBeEnabled();
    let failedPayload;
    const fail = async route => {
      failedPayload = route.request().postDataJSON();
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ message: 'Base de datos temporalmente no disponible (prueba aislada)' }) });
    };
    await page.route('**/api/admin/bulk/execute', fail);
    await apply.click();
    await expect(dialog).toContainText('Base de datos temporalmente no disponible (prueba aislada) (HTTP 503)');
    await expect(section.locator('.bulk-selection strong')).toHaveText('13 seleccionados');
    await expect(state).toHaveValue('ACTIVE');
    await expect(dialog.locator('[data-bulk-field="circleLevel"]')).toHaveValue('2');
    assert.equal(await db.user.count({ where: { id: { in: ids.slice(1) }, circleLevel: 1 } }), 13);
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole('button', { name: 'Consultar resultado', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'output/playwright/bulk-active-2026-10-06/server-error-mobile.png' });
    await page.unroute('**/api/admin/bulk/execute', fail);
    await dialog.getByRole('button', { name: 'Consultar resultado', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Reintentar la misma operación', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reintentar la misma operación', exact: true }).click();
    await expect(dialog).toContainText('Completado: 13 modificados');
    assert.equal(await db.adminBulkOperation.count({ where: { id: failedPayload.operationId } }), 1);
    assert.equal(await db.user.count({ where: { id: { in: ids.slice(1) }, circleLevel: 2, password: null } }), 13);
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();

    // Mixed password presence, combined changes, durable retries and concurrency.
    await db.user.update({ where: { id: ids[2] }, data: { password: hash } });
    await db.user.update({ where: { id: ids[1] }, data: { accountState: 'PRE_REGISTERED' } });
    const payload = { kind: 'users', ids: ids.slice(1, 3), changes: { accountState: 'ACTIVE', role: 'FRIEND', circleLevel: 3 } };
    const preview = await post('/api/admin/bulk/preview', payload); assert.equal(preview.status(), 201);
    const plan = await preview.json(), operationId = randomUUID();
    const execute = { ...payload, reviewToken: plan.reviewToken, operationId };
    const replies = await Promise.all([post('/api/admin/bulk/execute', execute), post('/api/admin/bulk/execute', execute)]);
    for (const r of replies) assert.equal(r.status(), 201, await r.text());
    assert.equal(await db.adminBulkOperation.count({ where: { id: operationId } }), 1);
    const changed = await db.user.findMany({ where: { id: { in: payload.ids } } });
    assert(changed.every(u => u.circleLevel === 3 && u.role === 'FRIEND' && u.accountState === 'ACTIVE'));
    assert.equal(changed.find(u => u.id === ids[1]).password, null);
    assert.equal(changed.find(u => u.id === ids[2]).password, hash);
    const race = { kind: 'users', ids: payload.ids, changes: { circleLevel: 4 } };
    const old = await (await post('/api/admin/bulk/preview', race)).json();
    await db.user.update({ where: { id: ids[1] }, data: { name: tag + ' target changed' } });
    assert.equal((await post('/api/admin/bulk/execute', { ...race, reviewToken: old.reviewToken, operationId: randomUUID() })).status(), 409);
    assert.equal((await db.user.findUnique({ where: { id: ids[2] } })).circleLevel, 3);
    // Individual state editing was already password-independent.
    const user = await db.user.update({ where: { id: ids[3] }, data: { name: 'Usuario Temporal' } });
    assert.equal((await post('/api/admin/users/' + user.id, { expectedUpdatedAt: user.updatedAt.toISOString(), accountState: 'PENDING_PASSWORD' }, 'patch')).status(), 200);
    const pending = await db.user.findUnique({ where: { id: user.id } });
    assert.equal((await post('/api/admin/users/' + user.id, { expectedUpdatedAt: pending.updatedAt.toISOString(), accountState: 'ACTIVE' }, 'patch')).status(), 200);
    assert.equal((await db.user.findUnique({ where: { id: user.id } })).password, null);
    await page.goto('http://localhost:3000/admin-user.html?id=' + user.id);
    const optionsResponse = page.waitForResponse(r => r.url().endsWith('/api/admin/users/edit-options'));
    await page.locator('#editUser').click();
    const optionsHttp = await optionsResponse; assert.equal(optionsHttp.status(), 200);
    await expect(page.locator('#userEditForm')).toBeVisible();
    await page.locator('#editUserStatus').selectOption('PENDING_PASSWORD');
    await page.locator('#saveUserEdit').click();
    await expect(page.locator('#userEditForm')).toBeHidden();
    await page.locator('#editUser').click();
    await page.locator('#editUserStatus').selectOption('ACTIVE');
    await page.locator('#saveUserEdit').click();
    await expect(page.locator('#userEditForm')).toBeHidden();
    assert.equal((await db.user.findUnique({ where: { id: user.id } })).password, null);
    assert.equal((await post('/api/auth/login', { email: user.email, password: '' })).status(), 400);
    assert.equal((await post('/api/auth/login', { email: user.email, password: 'wrong-password' })).status(), 401);
    assert.equal(await db.newsletterMailJob.count({ where: { userId: { in: ids.slice(1) } } }), 0);
    console.log(JSON.stringify({ http, activated: 13, mixedAndCombined: true, concurrentRetry: true,
      staleReview409Atomic: true, individual: true, server503RetainsSelectionAndValues: true,
      emptyPassword400: true, incorrectPassword401: true, accountSessionsCreated: 0, newsletterJobsCreated: 0 }));
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/bulk-active-2026-10-06/failure.png', fullPage: true }).catch(() => {});
    console.log(await page.locator('#profileStatus').textContent().catch(() => ''));
    throw error;
  } finally {
    if (actor) {
      await db.auditLog.deleteMany({ where: { actorId: actor.id } });
      await db.adminBulkOperation.deleteMany({ where: { actorId: actor.id } });
    }
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await context.close(); await browser.close(); await db.$disconnect();
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
