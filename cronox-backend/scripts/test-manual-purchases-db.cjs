'use strict';
// Real PostgreSQL integration. Never uses the configured development database for writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const databaseName = `cronox_manual_test_${randomUUID().replace(/-/g, '')}`;
const report = { database: databaseName, checks: [], cleanedUp: false };
const reportPath = path.resolve(backend, '../test-results/manual-purchases-db/results.json');

async function run() {
  const environment = loadLocalEnvironment();
  const source = new URL(environment.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname), 'Only loopback PostgreSQL is allowed');
  assert.match(databaseName, /^cronox_manual_test_[a-f0-9]{32}$/);
  const controlUrl = new URL(source); controlUrl.search = '';
  const control = new Client({ connectionString: controlUrl.href, connectionTimeoutMillis: 5000 });
  let created = false;
  let prisma;
  try {
    await control.connect();
    const identity = (await control.query('SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
    assert.ok(['127.0.0.1', '::1'].includes(identity.host), 'The database server must also identify as loopback');
    report.server = { host: identity.host, port: identity.port };
    await control.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
    created = true;
    const target = new URL(source); target.pathname = '/' + databaseName; target.search = '?schema=public';
    const env = { ...environment, DATABASE_URL: target.href, DIRECT_URL: target.href,
      USER_NUMBERING_DATABASE_URL: target.href, VAT_DEFAULT: '0.21', EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false' };
    const setupUrl = new URL(target); setupUrl.search = '';
    const extensionClient = new Client({ connectionString: setupUrl.href, connectionTimeoutMillis: 5000 });
    try {
      await extensionClient.connect();
      await extensionClient.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    } finally { await extensionClient.end(); }
    // Build the complete final Prisma schema in the empty test database, without data imports.
    const setup = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'],
      { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
    assert.equal(setup.status, 0, 'Prisma schema initialization failed: ' + (setup.stderr || '').replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]'));
    Object.assign(process.env, env);
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { HistorialService } = require('../src/historial/historial.service');
    const { TaxConfigService } = require('../src/common/tax/tax-config.service');
    const { AdminManualPurchasesService } = require('../src/admin/manual-purchases/admin-manual-purchases.service');
    const { AdminUsersService } = require('../src/admin/users/admin-users.service');
    prisma = new PrismaService(); await prisma.$connect();
    assert.equal((await prisma.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, databaseName);
    const service = new AdminManualPurchasesService(prisma, new HistorialService(prisma), new TaxConfigService());
    const users = new AdminUsersService(prisma);
    const admin = await prisma.user.create({ data: { email: 'admin@manual-purchase.test', role: 'SUPERADMIN' } });
    const buyer = await prisma.user.create({ data: { email: 'buyer@manual-purchase.test' } });
    const product = await prisma.product.create({ data: { slug: 'disposable-manual-test', name: 'Disposable integration article', price: 4000,
      privateCost: { create: { unitCostCents: 1000 } }, variants: { create: { size: 'M', sku: 'DISPOSABLE-M', price: 3000, stockQty: 10 } } }, include: { variants: true } });
    const variantId = product.variants[0].id;
    const stock = async () => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQty;
    const statistics = async (orders, units, spent) => {
      const history = await prisma.historial.findUniqueOrThrow({ where: { userId: buyer.id } });
      assert.equal(history.pedidosRealizados, orders); assert.equal(history.articulosAdquiridos, units);
      assert.equal((await users.getUserById(buyer.id)).stats.totalSpent, spent);
    };
    const paid = { paymentMethod: 'CASH', stockHandling: 'DEDUCT_NOW', purchasedAt: '2026-10-01T12:00:00.000Z',
      items: [{ variantId, quantity: 2, unitPriceCents: 2550 }, { variantId, quantity: 1, unitPriceCents: 3100 }] };
    const result = await service.create(buyer.id, admin.id, 'manual-db-deduct-123456', paid);
    const read = async id => prisma.order.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: 'asc' }, include: { financialSnapshot: true } } } });
    const saved = await read(result.order.id);
    assert.deepEqual(saved.items.map(line => [line.unitPrice.toFixed(2), line.quantity, line.lineTotal.toFixed(2)]), [['25.50', 2, '51.00'], ['31.00', 1, '31.00']]);
    assert.equal(saved.subtotal.toFixed(2), '82.00'); assert.equal(saved.total.toFixed(2), '82.00');
    assert.equal(saved.taxRate.toFixed(4), '0.2100'); assert.equal(saved.taxAmount.toFixed(2), '14.23');
    assert.ok(saved.items.every(line => line.financialSnapshot && line.financialSnapshot.unitCostCents === null));
    assert.equal(await stock(), 7); await statistics(1, 3, 82);
    report.checks.push('Persisted two separately priced variant lines, exact subtotal/total/inclusive VAT, financial snapshots, history and customer spending');
    for (let retry = 0; retry < 2; retry++) {
      const replay = await service.create(buyer.id, admin.id, 'manual-db-deduct-123456', paid);
      assert.equal(replay.created, false); assert.equal(replay.order.id, saved.id);
    }
    assert.equal(await prisma.order.count(), 1); assert.equal(await stock(), 7);
    assert.equal(await prisma.stockMovement.count({ where: { orderId: saved.id } }), 1);
    await assert.rejects(service.create(buyer.id, admin.id, 'manual-db-deduct-123456', { ...paid, items: [{ variantId, quantity: 2, unitPriceCents: 2600 }] }), /IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
    await statistics(1, 3, 82);
    report.checks.push('Identical retries return the same order without additional stock/history writes; changed price rejects reused key');
    await assert.rejects(service.create(buyer.id, admin.id, 'manual-db-nostock-123456', { ...paid, items: [{ variantId, quantity: 8, unitPriceCents: 1 }] }), /INSUFFICIENT_STOCK/);
    assert.equal(await prisma.order.count(), 1); assert.equal(await stock(), 7); await statistics(1, 3, 82);
    await assert.rejects(service.create(buyer.id, 2147483647, 'manual-db-rollback-123456', { ...paid, items: [{ variantId, quantity: 1, unitPriceCents: 1 }] }), error => error.code === 'P2003');
    assert.equal(await stock(), 7); assert.equal(await prisma.order.count(), 1);
    assert.equal(await prisma.stockMovement.count(), 1); await statistics(1, 3, 82);
    report.checks.push('Insufficient stock and a real FK failure after stock deduction roll back order, stock movements and history');
    const adjusted = { ...paid, stockHandling: 'ALREADY_ADJUSTED', items: [{ variantId, quantity: 2, unitPriceCents: 1000 }, { variantId, quantity: 1, unitPriceCents: 0 }] };
    const second = await service.create(buyer.id, admin.id, 'manual-db-adjusted-123456', adjusted);
    assert.equal((await read(second.order.id)).total.toFixed(2), '20.00'); assert.equal((await read(second.order.id)).taxAmount.toFixed(2), '3.47');
    assert.equal(await stock(), 7); assert.equal(await prisma.stockMovement.count({ where: { orderId: second.order.id } }), 0); await statistics(2, 6, 102);
    assert.equal((await service.create(buyer.id, admin.id, 'manual-db-adjusted-123456', adjusted)).created, false);
    assert.equal(await prisma.order.count(), 2); assert.equal(await stock(), 7);
    report.checks.push('Already-adjusted stock remains untouched, explicit zero persists, totals/history/spending and retry are correct');
    await prisma.product.update({ where: { id: product.id }, data: { price: 9900 } });
    await prisma.productVariant.update({ where: { id: variantId }, data: { price: 7000 } });
    const historical = await read(saved.id);
    assert.deepEqual(historical.items.map(line => line.unitPrice.toFixed(2)), ['25.50', '31.00']);
    assert.equal(historical.total.toFixed(2), '82.00'); assert.equal(historical.taxAmount.toFixed(2), '14.23');
    await statistics(2, 6, 102);
    assert.equal((await service.create(buyer.id, admin.id, 'manual-db-deduct-123456', paid)).order.id, saved.id);
    const legacy = await service.create(buyer.id, admin.id, 'manual-db-legacy-123456', { ...paid, stockHandling: 'ALREADY_ADJUSTED', items: [{ variantId, quantity: 1 }] });
    assert.equal((await read(legacy.order.id)).items[0].unitPrice.toFixed(2), '70.00'); await statistics(3, 7, 172);
    report.checks.push('Catalog changes do not alter historical paid prices/VAT/spending or replay; omitted price uses current variant catalog');
    assert.equal((await service.void(saved.id, admin.id, 'Disposable test cancellation')).changed, true);
    assert.equal(await stock(), 10); await statistics(2, 4, 90);
    assert.equal((await service.void(saved.id, admin.id, 'Repeated cancellation')).changed, false);
    assert.equal(await stock(), 10); assert.equal(await prisma.stockMovement.count({ where: { orderId: saved.id, reason: 'manual_sale_void' } }), 2);
    const cancelledReplay = await service.create(buyer.id, admin.id, 'manual-db-deduct-123456', paid);
    assert.equal(cancelledReplay.created, false); assert.equal(cancelledReplay.order.status, 'CANCELLED'); assert.equal(await stock(), 10);
    assert.equal((await read(saved.id)).items[0].unitPrice.toFixed(2), '25.50');
    await service.void(second.order.id, admin.id, 'Already adjusted cancellation');
    await service.void(second.order.id, admin.id, 'Repeated adjusted cancellation');
    assert.equal(await stock(), 10); assert.equal(await prisma.stockMovement.count({ where: { orderId: second.order.id } }), 0); await statistics(1, 1, 70);
    report.checks.push('Both cancellation modes update spending/history; deducted quantities restore only once; adjusted stock never restores; historical lines remain saved');
    report.passed = true;
  } finally {
    if (prisma) await prisma.$disconnect();
    if (created) {
      // Only the uniquely named database created by this invocation can be removed.
      assert.match(databaseName, /^cronox_manual_test_[a-f0-9]{32}$/);
      await control.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      report.cleanedUp = true;
    }
    await control.end();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
}
run().catch(error => { console.error(error.stack); process.exitCode = 1; });
