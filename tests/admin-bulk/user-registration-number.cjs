// Real local PostgreSQL/API/browser regression. Only disposable, tagged users.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { chromium, expect } = require('@playwright/test');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');
const { PrismaClient } = require('../../cronox-backend/node_modules/@prisma/client');
const bcrypt = require('../../cronox-backend/node_modules/bcrypt');

async function run() {
  const env = loadLocalEnvironment(), url = new URL(env.DATABASE_URL);
  assert.equal(url.host, '127.0.0.1:5433'); assert.equal(url.pathname, '/cronox_dev');
  assert.equal(env.EMAIL_ENABLED, 'false'); assert.equal(env.BACKGROUND_JOBS_ENABLED, 'false');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const tag = 'number-qa-' + randomUUID(), search = tag + '-target-', password = randomUUID();
  const ids = [], browser = await chromium.launch(), context = await browser.newContext();
  const page = await context.newPage(); let actor;
  const output = 'output/playwright/user-number-2026-10-07'; mkdirSync(output, { recursive: true });
  const list = async query => {
    const r = await context.request.get('http://localhost:3000/api/admin/users?' + new URLSearchParams(query));
    assert.equal(r.status(), 200); return r.json();
  };
  const post = async (path, data) => {
    await context.request.get('http://localhost:3000/api/auth/csrf');
    const csrf = (await context.cookies()).find(c => c.name === 'cronox_csrf_token');
    return context.request.post('http://localhost:3000' + path, { data,
      headers: { Origin: 'http://localhost:3000', 'x-csrf-token': decodeURIComponent(csrf.value) } });
  };
  const snapshot = async () => {
    const rows = await db.user.findMany({ select: { id: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { rows, numbers: new Map(rows.map((r, i) => [r.id, i + 1])) };
  };
  const verify = (result, reference) => result.data.forEach(u => assert.equal(u.registrationNumber, reference.numbers.get(u.id)));
  try {
    const ready = await context.request.get('http://localhost:3000/api/ready');
    assert.equal(ready.status(), 200, 'Start the guarded local backend and wait for readiness first');
    const original = await snapshot();
    const oldest = (original.rows[0]?.createdAt.getTime() ?? Date.UTC(2000, 0, 1)) - 86400000;
    actor = await db.user.create({ data: { name: 'Administrador Temporal', email: tag + '-actor@example.test',
      password: await bcrypt.hash(password, 10), role: 'SUPERADMIN', accountState: 'ACTIVE' } }); ids.push(actor.id);
    // Two equal registration dates deliberately exercise the internal-ID tie break.
    await db.user.createMany({ data: Array.from({ length: 105 }, (_, i) => ({
      name: 'Usuario Temporal', email: search + String(i).padStart(3, '0') + '@example.test',
      accountState: 'PRE_REGISTERED', createdAt: new Date(oldest + Math.floor(i / 2) * 1000),
    })) });
    const fixtures = await db.user.findMany({ where: { email: { startsWith: search } }, orderBy: { id: 'asc' } });
    ids.push(...fixtures.map(u => u.id));
    await page.goto('http://localhost:3000/admin.html');
    await page.locator('#adminLoginEmail').fill(actor.email); await page.locator('#adminLoginPassword').fill(password);
    await page.locator('#adminLoginSubmit').click(); await expect(page.locator('#adminLoginSubmit')).toBeHidden();
    let reference = await snapshot();
    const all = [];
    for (let p = 1; ; p++) {
      const result = await list({ page: p, sort: 'createdAt', order: 'asc' });
      verify(result, reference); all.push(...result.data);
      assert.equal(result.meta.total, reference.rows.length);
      if (p === result.meta.totalPages) break;
    }
    assert.deepEqual(all.map(u => u.registrationNumber), reference.rows.map((_, i) => i + 1));
    for (const query of [{ q: search, page: 2 }, { q: search, sort: 'email', order: 'asc' },
      { email: fixtures[51].email, circle: 1, accountState: 'PRE_REGISTERED' }, { sort: 'id', order: 'desc' }])
      verify(await list(query), reference);
    await page.goto('http://localhost:3000/admin.html#section-users');
    const section = page.locator('#section-users');
    await expect(section.locator('thead th').first()).toHaveText('N.º');
    await section.locator('details.filters-panel').evaluate(el => { el.open = true; });
    await page.locator('#usersSearch').fill(search);
    await expect(page.locator('#usersPageInfo')).toContainText('105 resultados');
    await page.locator('#usersSort').selectOption('id'); await page.locator('#usersOrder').selectOption('asc');
    await expect(page.locator('#usersBody tr').first().locator('td').first()).toHaveText(String(reference.numbers.get(fixtures[0].id)));
    await page.locator('#usersNext').click();
    await expect(page.locator('#usersBody tr')).toHaveCount(5);
    await expect(page.locator('#usersBody tr').first().locator('td').first()).toHaveText(String(reference.numbers.get(fixtures[100].id)));
    await page.screenshot({ path: output + '/page-two.png' });

    // Remove only our middle fixture. No deletion route exists in the current panel.
    const nextNumber = reference.numbers.get(fixtures[51].id);
    const deleted = fixtures[50]; await db.user.delete({ where: { id: deleted.id } });
    reference = await snapshot();
    const recalculated = await list({ q: search, sort: 'createdAt', order: 'asc' }); verify(recalculated, reference);
    assert.equal(recalculated.meta.total, 104);
    assert.equal(reference.numbers.get(fixtures[51].id), nextNumber - 1);
    await page.reload(); await expect(page.locator('#usersPageInfo')).toContainText('104 resultados');
    await expect(page.locator('#usersBody tr')).toHaveCount(4);
    const latest = await db.user.create({ data: { name: 'Usuario Nuevo', email: search + 'new@example.test',
      accountState: 'PRE_REGISTERED', createdAt: new Date(reference.rows.at(-1).createdAt.getTime() + 1000) } }); ids.push(latest.id);
    reference = await snapshot();
    const newest = await list({ email: latest.email }); verify(newest, reference);
    assert.equal(newest.data[0].registrationNumber, reference.rows.length);
    await db.user.update({ where: { id: fixtures[51].id }, data: { newsletterSubscribed: false, accountState: 'ACTIVE' } });
    verify(await list({ email: fixtures[51].email, accountState: 'ACTIVE' }), reference);
    // Bulk selection and execute must use the original internal ID, never its visible number.
    const payload = { kind: 'users', ids: [fixtures[51].id], changes: { circleLevel: 2 } };
    const preview = await post('/api/admin/bulk/preview', payload); assert.equal(preview.status(), 201);
    const plan = await preview.json(); assert.equal(plan.rows[0].id, fixtures[51].id);
    const executed = await post('/api/admin/bulk/execute', { ...payload, reviewToken: plan.reviewToken, operationId: randomUUID() });
    assert.equal(executed.status(), 201); assert.equal((await db.user.findUnique({ where: { id: fixtures[51].id } })).circleLevel, 2);
    await page.goto('http://localhost:3000/admin.html#section-users');
    await page.locator('#usersSearch').fill(fixtures[51].email);
    await expect(page.locator('#usersPageInfo')).toContainText('1 resultados');
    const row = page.locator('#usersBody tr');
    await expect(row.locator('td').first()).toHaveText(String(reference.numbers.get(fixtures[51].id)));
    await expect(row.getByRole('link', { name: 'Ver', exact: true })).toHaveAttribute('href', new RegExp('id=' + fixtures[51].id + '(?:#|$)'));
    await section.getByRole('button', { name: 'Bulk Edit', exact: true }).click();
    await expect(row.locator('[data-bulk-id]')).toHaveAttribute('data-bulk-id', String(fixtures[51].id));
    await page.screenshot({ path: output + '/internal-actions.png' });
    await row.getByRole('link', { name: 'Ver', exact: true }).click();
    await expect(page.locator('#editUser')).toBeVisible(); assert(new URL(page.url()).searchParams.get('id') === String(fixtures[51].id));
    console.log(JSON.stringify({ globalContiguous: true, dateTieBreak: true, pagesAndFilters: true,
      middleDeletionRecalculated: true, newestEqualsTotal: true, stateAndNewsletterKeepNumber: true,
      internalIdsForActionsAndBulk: true, localFixturesOnly: true }));
  } catch (error) {
    await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {}); throw error;
  } finally {
    try {
      if (actor) { await db.auditLog.deleteMany({ where: { actorId: actor.id } }); await db.adminBulkOperation.deleteMany({ where: { actorId: actor.id } }); }
      if (ids.length) await db.user.deleteMany({ where: { id: { in: ids } } });
    } finally { await context.close(); await browser.close(); await db.$disconnect(); }
  }
}
run().catch(e => { console.error(e.message); process.exitCode = 1; });
