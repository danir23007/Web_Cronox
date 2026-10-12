'use strict';
// Real PostgreSQL/Nest integration using synthetic data in a loopback database.
// --serve exposes the real UI until "stop" on stdin, then removes only this DB.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..'), root = path.resolve(backend, '..');
const name = 'cronox_statistics_test_' + randomUUID().replace(/-/g, '');
const checks = [];
async function main() {
  const environment = loadLocalEnvironment(), source = new URL(environment.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
  const control = new Client({ connectionString: source.href });
  let db, app, created = false;
  try {
    await control.connect();
    assert.ok(['127.0.0.1', '::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    assert.match(name, /^cronox_statistics_test_[a-f0-9]{32}$/);
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + name; target.search = '';
    const env = { ...environment, DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href };
    const sql = new Client({ connectionString: target.href }); await sql.connect();
    try {
      await sql.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], { cwd: backend, env, windowsHide: true, encoding: 'utf8' });
      assert.equal(push.status, 0, 'Isolated schema creation failed');
      await sql.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261002120000_permanent_visitor_finance_history/migration.sql'), 'utf8'));
      await sql.query('ALTER TABLE "Order" DROP COLUMN "excludedFromStatistics"; ALTER TABLE "AuditLog" DROP COLUMN "requestKey"');
      await sql.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261012140000_manual_statistics_exclusion/migration.sql'), 'utf8'));
      const reconciliation = fs.readFileSync(path.join(backend, 'prisma/migrations/20261002200000_visitor_daily_reconciliation/migration.sql'), 'utf8');
      await sql.query(reconciliation.slice(reconciliation.indexOf('CREATE VIEW'), reconciliation.indexOf('-- Local PostgreSQL')));
    } finally { await sql.end(); }
    require('../test/test-environment.cjs').installTestEnvironment({ overrides: { DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href,
      EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false', CRONOX_ROUTE_SMOKE_MODE: 'true', CRONOX_LOCAL_DEV: 'true', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
      PORT: '43122', FRONTEND_URL: 'http://127.0.0.1:43122', API_PUBLIC_URL: 'http://127.0.0.1:43122', CORS_ORIGINS: 'http://127.0.0.1:43122',
      // Only this uniquely created disposable server: intensive UI sort matrix.
      RATE_LIMIT_TTL_MS: '1000', RATE_LIMIT_MAX: '100' } });
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaService } = require('../src/prisma/prisma.service');
    db = new PrismaService(); await db.$connect();
    const { AdminManualPurchasesService } = require('../src/admin/manual-purchases/admin-manual-purchases.service');
    const { HistorialService } = require('../src/historial/historial.service');
    const { TaxConfigService } = require('../src/common/tax/tax-config.service');
    const { AdminFinanceService } = require('../src/admin/finance/admin-finance.service');
    const { AdminUsersService } = require('../src/admin/users/admin-users.service');
    const { AdminMapService } = require('../src/admin/map/admin-map.service');
    const { AdminDashboardService } = require('../src/admin/dashboard/admin-dashboard.service');
    const { AdminCustomerAnalyticsService } = require('../src/analytics/admin-customer-analytics.service');
    const { AdminExportsService } = require('../src/admin/exports/admin-exports.service');
    const { madridDate } = require('../src/admin/finance/financial-calculations');
    const history = new HistorialService(db), manual = new AdminManualPurchasesService(db, history, new TaxConfigService());
    const finance = new AdminFinanceService(db), users = new AdminUsersService(db), analytics = new AdminCustomerAnalyticsService(db);
    const admin = await db.user.create({ data: { email: 'admin@statistics.test', role: 'SUPERADMIN' } });
    const customer = await db.user.create({ data: { email: 'buyer@statistics.test', name: 'TEST local estadísticas', analyticsConsentStatus: 'ACTIVE' } });
    const product = await db.product.create({ data: { name: 'TEST Camiseta estadísticas', slug: 'statistics-shirt', price: 9999,
      privateCost: { create: { unitCostCents: 1500 } }, variants: { create: [{ size: 'M', sku: 'STAT-M', stockQty: 100 }, { size: 'L', sku: 'STAT-L', stockQty: 0 }] } }, include: { variants: { orderBy: { id: 'asc' } } } });
    const variantId = product.variants[0].id, now = new Date(), day = madridDate(now);
    const payload = { paymentMethod: 'CASH', stockHandling: 'DEDUCT_NOW', purchasedAt: now.toISOString(), items: [{ variantId, quantity: 2, unitPriceCents: 2550 }] };
    const normal = (await manual.create(customer.id, admin.id, randomUUID(), payload)).order;
    const excluded = (await manual.create(customer.id, admin.id, randomUUID(), { ...payload, excludedFromStatistics: true })).order;
    const query = { from: day, to: day, aggregation: 'days', currency: 'EUR', search: '', sort: 'revenue', direction: 'desc', page: 1, source: 'all' };
    async function assertTotals(multiplier, expectedSpent = 102) {
      const expected = { revenueCents: 5100 * multiplier, costCents: 3000 * multiplier, profitCents: 2100 * multiplier, unitsSold: 2 * multiplier, unitsReturned: 0 };
      for (const source of ['all', 'manual']) {
        const report = await finance.getReport({ ...query, source });
        assert.deepEqual(report.totals, expected); assert.equal(report.salesCount, multiplier);
        assert.equal(report.buckets[0].profitCents, expected.profitCents);
        assert.equal(report.products.reduce((n, p) => n + p.unitsSold, 0), 2 * multiplier);
        assert.equal(report.topProducts.reduce((n, p) => n + p.revenueCents, 0), 5100 * multiplier);
        // JSON report serialization preserves the same analytic aggregates.
        assert.equal(JSON.parse(JSON.stringify(report)).totals.profitCents, expected.profitCents);
      }
      const map = await new AdminMapService(db).getReport({ from: day, to: day, page: 1 });
      assert.equal(map.total.orders, multiplier); assert.equal(map.total.units, 2 * multiplier); assert.equal(map.total.revenueCents, 5100 * multiplier);
      const overview = await new AdminDashboardService(db).getOverview();
      assert.equal(overview.orders.total, multiplier); assert.equal(overview.revenue.today, 51 * multiplier);
      assert.equal((await users.getUserById(customer.id)).stats.totalSpent, expectedSpent);
      const customerList = await users.listUsers({});
      assert.equal(customerList.data.find(user => user.id === customer.id).revenueCents, expectedSpent * 100);
      assert.equal((await history.calculatePurchaseStats(customer.id)).pedidosRealizados, multiplier);
      assert.equal((await analytics.summary(customer.id)).analytics.purchasedUnits, 2 * multiplier);
      assert.equal((await analytics.products(customer.id)).items.reduce((n, p) => n + p.purchasedUnits, 0), 2 * multiplier);
    }
    await assertTotals(1);
    assert.equal(await db.order.count({ where: { userId: customer.id } }), 2);
    const before = await db.order.findUnique({ where: { id: excluded.id }, include: { items: { include: { financialSnapshot: true } } } });
    const stockBefore = await db.productVariant.findUnique({ where: { id: variantId } }), movementsBefore = await db.stockMovement.count();
    const key = randomUUID();
    await Promise.all([manual.setStatisticsExclusion(excluded.id, admin.id, key, false), manual.setStatisticsExclusion(excluded.id, admin.id, key, false)]);
    await assertTotals(2);
    assert.equal(await db.auditLog.count({ where: { requestKey: key } }), 1);
    await manual.setStatisticsExclusion(excluded.id, admin.id, randomUUID(), true); await assertTotals(1);
    // A delayed retry of inclusion must not override the later exclusion.
    await manual.setStatisticsExclusion(excluded.id, admin.id, key, false); await assertTotals(1);
    await assert.rejects(manual.setStatisticsExclusion(excluded.id, admin.id, key, true), /IDEMPOTENCY_KEY_REUSED/);
    const after = await db.order.findUnique({ where: { id: excluded.id }, include: { items: { include: { financialSnapshot: true } } } });
    assert.deepEqual(after.items, before.items); assert.equal(after.total.toString(), before.total.toString()); assert.equal(after.status, before.status);
    assert.equal((await db.productVariant.findUnique({ where: { id: variantId } })).stockQty, stockBefore.stockQty);
    assert.equal(await db.stockMovement.count(), movementsBefore);
    const archive = await db.financeArchive.findUnique({ where: { orderId: excluded.id } });
    assert.equal(archive.snapshot.excludedFromStatistics, true);
    assert.deepEqual(archive.snapshot.items, (await db.financeArchiveRevision.findUnique({ where: { orderId_revision: { orderId: excluded.id, revision: 1 } } })).snapshot.items);
    const exports = await new AdminExportsService(db, {}).orders({ scope: 'all' });
    assert.equal(exports[0].rows.find(r => r.id === excluded.id).excluded, 'Sí');
    assert.equal(exports[1].rows.length, 2);
    assert.equal(exports[1].rows.find(r => r.orderId === excluded.id).excluded, 'Sí');
    checks.push('Equivalent normal/excluded purchases: account and operational export retain both, analytics count exactly one; all/manual, summary, calendar buckets, ranks, map, customer/product aggregates agree');
    checks.push('Concurrent retry creates one audit; toggle/reinclude and stale replay do not duplicate orders or mutate prices/costs/stock/status; archive revisions preserve amounts');
    // Refund/correction of an excluded order never leaks amounts/units, including
    // periods containing only the return rather than the original sale.
    await manual.void(excluded.id, admin.id, 'Local exclusion cancellation test');
    await assertTotals(1, 51);
    const future = madridDate(new Date(now.getTime() + 86400000));
    assert.equal((await finance.getReport({ ...query, from: future, to: future })).totals.revenueCents, 0);
    const web = await db.order.create({ data: { userId: customer.id, customerEmail: customer.email, source: 'ONLINE', status: 'PAID', paidAt: now,
      subtotal: '10', total: '10', taxRate: '0.21', taxAmount: '1.74', currency: 'EUR', items: { create: { productId: product.id, variantId,
        title: 'Web fixture', quantity: 1, unitPrice: '10', lineTotal: '10', financialSnapshot: { create: { productName: product.name, unitCostCents: 500 } } } } } });
    await assert.rejects(manual.setStatisticsExclusion(web.id, admin.id, randomUUID(), true), /NOT_MANUAL_PURCHASE/);
    await assert.rejects(db.order.update({ where: { id: web.id }, data: { excludedFromStatistics: true } }), /manual_statistics_only/);
    assert.equal((await finance.getReport({ ...query, source: 'web' })).totals.profitCents, 500);
    checks.push('Excluded cancellation and out-of-period returns remain absent; web calculations unchanged, service and database reject web exclusion');
    const { AdminPointsService } = require('../src/admin/points/admin-points.service');
    const points = new AdminPointsService(db);
    const pointId = (await points.savePoint(admin.id, randomUUID(), { name: 'TEST local statistics point', type: 'EVENT', city: 'Madrid', venue: '', notes: '',
      commissionBp: 0, archived: false, participationCents: 0, expenseDate: day + 'T12:00' })).pointId;
    await points.sale(pointId, admin.id, randomUUID(), { occurredAt: day + 'T12:00', note: '', paymentMethod: 'CASH', stockHandling: 'ALREADY_ADJUSTED',
      lines: [{ variantId, quantity: 1, unitPriceCents: 2500, commissionBp: 0 }] });
    const pointReport = await finance.getReport({ ...query, source: 'points' });
    assert.equal(pointReport.salesCount, 1); assert.equal(pointReport.totals.profitCents, 1000);
    assert.equal((await finance.getReport(query)).totals.profitCents, 3600);
    checks.push('Real point sale remains included exactly once in points/all origins and general finance; exclusion is not part of its model');
    const usersList = process.argv.includes('--users-list') ? await require('./user-list-review-fixtures.cjs')(db, manual, admin, users, product, variantId, now) : null;
    if (usersList) checks.push('Users list: 106 local fixtures, complete-set ranking before pagination for all eight sorts, same-name/different-product identity, multiple sizes, custom manual prices, full returns, exclusions/reinclusion and obsolete state filters');
    // Full application/authenticated browser, with no production credentials.
    const runtime = path.join(root, 'test-results/manual-statistics/runtime'); fs.mkdirSync(runtime, { recursive: true }); process.chdir(runtime);
    const { NestFactory } = require('@nestjs/core'), { ValidationPipe } = require('@nestjs/common');
    const { AppModule } = require('../dist/app.module');
    app = await NestFactory.create(AppModule, { logger: ['error'] }); app.setGlobalPrefix('api'); app.use(require('cookie-parser')());
    app.use(require('../dist/common/config/local-review-safety').localReviewSafety);
    // Match the existing redirects installed by the normal main.ts bootstrap.
    app.use(['/admin', '/admin/'], (req, res, next) => {
      if (req.method === 'GET' && (req.path === '/' || req.path === '')) return res.redirect(307, '/admin.html');
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.use((req, res, next) => { const token = req.cookies?.cronox_csrf_token || randomUUID(); req.csrfToken = token;
      if (!req.cookies?.cronox_csrf_token) res.cookie('cronox_csrf_token', token, { sameSite: 'lax' }); next(); });
    const { AuthSessionsService } = require('../dist/auth/auth-sessions.service');
    const token = await app.get(AuthSessionsService).create(admin);
    const limitedAdmin = await db.user.create({ data: { email: 'menu-admin@example.test', role: 'ADMIN' } });
    const limitedToken = await app.get(AuthSessionsService).create(limitedAdmin);
    const customerToken = await app.get(AuthSessionsService).create(customer);
    app.use('/__review/admin', (_req, res) => { res.cookie('jwt', token.accessToken, { httpOnly: true, sameSite: 'lax' });
      res.cookie('refresh_token', token.refreshToken, { httpOnly: true, sameSite: 'lax' });
      res.redirect(`/admin-user.html?id=${customer.id}&uid=${customer.identityUid}`); });
    app.use('/__review/users', (_req, res) => { res.cookie('jwt', token.accessToken, { httpOnly: true, sameSite: 'lax' });
      res.cookie('refresh_token', token.refreshToken, { httpOnly: true, sameSite: 'lax' });
      res.redirect('/admin.html?accountState=PRE_REGISTERED#usuarios&accountState=PRE_REGISTERED&sort=revenue:asc'); });
    app.use('/__review/menu', (req, res) => { const session = req.query.role === 'ADMIN' ? limitedToken : req.query.role === 'USER' ? customerToken : token;
      res.cookie('jwt', session.accessToken, { httpOnly: true, sameSite: 'lax' }); res.cookie('refresh_token', session.refreshToken, { httpOnly: true, sameSite: 'lax' });
      res.redirect('/admin.html#section-sale-points'); });
    await app.listen(43122, '127.0.0.1');
    const csrf = 'local-statistics-test-csrf';
    const headers = { Origin: 'http://127.0.0.1:43122', Cookie: 'cronox_csrf_token=' + csrf, 'x-csrf-token': csrf, Authorization: 'Bearer ' + token.accessToken, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
    headers['x-cronox-user-identity'] = customer.identityUid;
    const editUrl = `http://127.0.0.1:43122/api/admin/users/${customer.id}/in-person-purchases/${normal.id}`;
    const readReply = await fetch(editUrl, { headers });
    const beforeEdit = await readReply.json();
    assert.equal(readReply.status, 200, JSON.stringify(beforeEdit));
    const editReply = await fetch(editUrl, { method: 'PATCH', headers, body: JSON.stringify({
      expectedVersion: beforeEdit.expectedVersion, items: beforeEdit.order.items.map(({ itemId, variantId, quantity, unitPriceCents }) => ({ itemId, variantId, quantity, unitPriceCents })), paymentMethod: beforeEdit.order.paymentMethod,
      purchasedAt: beforeEdit.order.purchasedAt, excludedFromStatistics: beforeEdit.order.excludedFromStatistics, note: 'HTTP persistence regression',
    }) });
    assert.equal(editReply.status, 200, 'Edit rejected by local bootstrap: ' + await editReply.text());
    const afterEdit = await (await fetch(editUrl, { headers })).json();
    assert.equal(afterEdit.order.id, normal.id); assert.equal(afterEdit.order.note, 'HTTP persistence regression');
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: normal.id } })).internalNote, 'HTTP persistence regression');
    checks.push('Local bootstrap PATCH persists same purchase; subsequent GET and database agree');
    assert.equal((await fetch(`http://127.0.0.1:43122/api/admin/orders/${web.id}/statistics-exclusion`, { method: 'POST', headers, body: JSON.stringify({ excludedFromStatistics: true }) })).status, 400);
    assert.equal((await fetch('http://127.0.0.1:43122/api/admin/sale-points/1/sales', { method: 'POST', headers, body: JSON.stringify({ excludedFromStatistics: true }) })).status, 400);
    assert.equal((await fetch('http://127.0.0.1:43122/api/admin/sale-points')).status, 401);
    assert.equal((await fetch('http://127.0.0.1:43122/api/admin/sale-points', { headers: { Authorization: 'Bearer ' + customerToken.accessToken } })).status, 403);
    const result = { database: name, checks, usersList, passed: true, customerId: customer.id, identityUid: customer.identityUid, variantId, normalOrderId: normal.id, excludedOrderId: excluded.id, webOrderId: web.id,
      localUrl: 'http://127.0.0.1:43122/__review/admin' };
    fs.writeFileSync(path.join(root, 'test-results/manual-statistics/db-results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes('--serve')) await new Promise(resolve => { process.stdin.on('data', value => { if (String(value).includes('stop')) { process.stdin.pause(); resolve(); } }); });
  } finally {
    if (app) await app.close(); if (db) await db.$disconnect();
    if (created) { assert.match(name, /^cronox_statistics_test_[a-f0-9]{32}$/); await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
    await control.end();
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exit(1); });
