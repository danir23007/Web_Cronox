'use strict';
// All writes and fixtures are confined to a uniquely named disposable local database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const databaseName = `cronox_circle_test_${randomUUID().replace(/-/g, '')}`;
const reportPath = path.resolve(backend, '../test-results/circle-promotions-db/results.json');
const report = { database: databaseName, checks: [], cleanedUp: false };

async function run() {
  const environment = loadLocalEnvironment();
  const source = new URL(environment.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  assert.match(databaseName, /^cronox_circle_test_[a-f0-9]{32}$/);
  const connection = new URL(source); connection.search = '';
  const control = new Client({ connectionString: connection.href });
  let created = false, prisma, worker;
  try {
    await control.connect();
    const identity = (await control.query('SELECT host(inet_server_addr()) AS host')).rows[0];
    assert.ok(['127.0.0.1', '::1'].includes(identity.host));
    await control.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + databaseName; target.search = '?schema=public';
    const env = { ...environment, DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href };
    const setupUrl = new URL(target); setupUrl.search = '';
    const setup = new Client({ connectionString: setupUrl.href });
    await setup.connect();
    try {
      await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      const initialized = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'],
        { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
      assert.equal(initialized.status, 0, 'Disposable schema setup failed');
      await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261002120000_permanent_visitor_finance_history/migration.sql'), 'utf8'));
      const exclusion = fs.readFileSync(path.join(backend, 'prisma/migrations/20261012140000_manual_statistics_exclusion/migration.sql'), 'utf8');
      await setup.query(exclusion.slice(exclusion.indexOf('CREATE OR REPLACE FUNCTION')));
      const circles = fs.readFileSync(path.join(backend, 'prisma/migrations/20261017120000_circle_spend_promotion/migration.sql'), 'utf8');
      await setup.query(circles.slice(circles.indexOf('CREATE FUNCTION')));
    } finally { await setup.end(); }
    Object.assign(process.env, env);
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { CircleService } = require('../src/membership/circle.service');
    const { CircleUpgradeService } = require('../src/membership/circle-upgrade.service');
    const { CircleReconciliationService } = require('../src/membership/circle-reconciliation.service');
    const { circle2Eligibility, CIRCLE_II_COOLDOWN_MS, getNetSpendCents } = require('../src/membership/circle-policy');
    const { AdminManualPurchasesService } = require('../src/admin/manual-purchases/admin-manual-purchases.service');
    const { HistorialService } = require('../src/historial/historial.service');
    const { TaxConfigService } = require('../src/common/tax/tax-config.service');
    prisma = new PrismaService(); await prisma.$connect();
    assert.equal((await prisma.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, databaseName);
    const upgrade = new CircleUpgradeService(prisma);
    const circles = new CircleService(prisma, upgrade);
    worker = new CircleReconciliationService(prisma);
    const manual = new AdminManualPurchasesService(prisma, new HistorialService(prisma), new TaxConfigService());
    const admin = await prisma.user.create({ data: { email: 'admin@circle.test', role: 'SUPERADMIN', circleLevel: 5 } });
    const product = await prisma.product.create({ data: { slug: 'circle-fixture', name: 'Circle fixture', price: 8500,
      variants: { create: { size: 'M', sku: 'CIRCLE-FIXTURE', price: 8500, stockQty: 100 } } }, include: { variants: true } });
    const variantId = product.variants[0].id;
    const user = (name, data = {}) => prisma.user.create({ data: { email: name + '@circle.test', ...data } });
    const read = id => prisma.user.findUniqueOrThrow({ where: { id } });
    const paidAt = new Date(Date.now() - 60000);
    const order = (owner, cents, data = {}) => prisma.order.create({ data: { userId: owner.id, customerEmail: owner.email,
      providerRef: 'pi_circle_' + randomUUID(), status: 'PAID', source: 'ONLINE', paidAt, currency: 'EUR',
      subtotal: cents / 100, total: cents / 100, taxRate: 0.21, taxAmount: 0,
      items: { create: { productId: product.id, variantId, title: 'Circle fixture', unitPrice: cents / 100, quantity: 1, lineTotal: cents / 100 } }, ...data } });
    const justBelow = await user('below'); await order(justBelow, 8499);
    const exact = await user('exact'); await order(exact, 8500);
    await worker.drainQueue();
    assert.equal((await read(justBelow.id)).circleLevel, 1);
    const promoted = await read(exact.id);
    assert.equal(promoted.circleLevel, 2); assert.ok(promoted.circle2PromotedAt instanceof Date);
    report.checks.push('84.99 EUR stays I; exactly 85 EUR promotes to II with an effective persisted date');

    const mixed = await user('mixed'); await order(mixed, 4000);
    const manualResult = await manual.create(mixed.id, admin.id, 'circle-manual-' + randomUUID(), {
      paymentMethod: 'CASH', stockHandling: 'ALREADY_ADJUSTED', purchasedAt: paidAt.toISOString(),
      items: [{ variantId, quantity: 1, unitPriceCents: 4500 }],
    });
    await prisma.order.update({ where: { id: manualResult.order.id }, data: { excludedFromStatistics: true } });
    await worker.drainQueue();
    const mixedPromoted = await read(mixed.id);
    assert.equal(mixedPromoted.circleLevel, 2); assert.equal(await getNetSpendCents(prisma, mixed.id), 8500);
    for (let i = 0; i < 3; i++) await prisma.order.update({ where: { id: manualResult.order.id }, data: { excludedFromStatistics: !!(i % 2) } });
    await Promise.all([worker.drainQueue(), new CircleReconciliationService(prisma).drainQueue()]);
    assert.equal((await read(mixed.id)).circle2PromotedAt.toISOString(), mixedPromoted.circle2PromotedAt.toISOString());
    assert.equal(await prisma.order.count({ where: { userId: mixed.id } }), 2);
    report.checks.push('Online + manual 40 + 45 EUR including excluded statistics reaches 85 once; repeated events and workers preserve date');

    const invalid = await user('invalid');
    await order(invalid, 9000, { status: 'PENDING', paidAt: null }); await order(invalid, 9000, { status: 'CANCELLED' });
    await worker.drainQueue(); assert.equal((await read(invalid.id)).circleLevel, 1);
    assert.equal(await getNetSpendCents(prisma, invalid.id), 0);
    const refunded = await user('refunded'); const refundOrder = await order(refunded, 10000);
    await prisma.financeEventArchive.create({ data: { id: 'circle-refund', paymentIntentId: refundOrder.providerRef, occurredAt: paidAt,
      snapshot: { id: 'circle-refund', type: 'charge.refunded', paymentIntentId: refundOrder.providerRef, refundCumulativeCents: 1501 } } });
    await worker.drainQueue(); assert.equal(await getNetSpendCents(prisma, refunded.id), 8499);
    assert.equal((await read(refunded.id)).circleLevel, 1);
    // New append-only refund evidence must enqueue, without touching an order.
    await prisma.financeEventArchive.create({ data: { id: 'circle-refund-next', paymentIntentId: refundOrder.providerRef, occurredAt: new Date(), snapshot: {
      id: 'circle-refund-next', type: 'charge.refunded', paymentIntentId: refundOrder.providerRef, refundCumulativeCents: 1502 } } });
    assert.ok(await prisma.circleReconciliationQueue.findUnique({ where: { userId: refunded.id } }));
    await worker.drainQueue(); assert.equal((await read(refunded.id)).circleLevel, 1);
    assert.equal(await getNetSpendCents(prisma, refunded.id), 8498);
    await order(refunded, 2); await worker.drainQueue();
    assert.equal((await read(refunded.id)).circleLevel, 2);
    report.checks.push('Pending/cancelled orders excluded; cumulative refunds yield 84.99 then 84.98 without double subtraction; refund-only events enqueue; net 85 promotes');

    for (const cents of [8500, 8750, 9000, 15000]) {
      const existing = await user('existing-' + cents); await order(existing, cents);
      await prisma.circleReconciliationQueue.deleteMany({ where: { userId: existing.id } });
      await circles.ensureCircleByNetSpent(existing.id);
      assert.equal((await read(existing.id)).circleLevel, 2);
    }
    const higher = await user('higher', { circleLevel: 5 }); await order(higher, 8500);
    const manualII = await user('manual-ii'); await prisma.user.update({ where: { id: manualII.id }, data: { circleLevel: 2 } });
    const manualDate = (await read(manualII.id)).circle2PromotedAt;
    assert.ok(manualDate); await circles.ensureCircleByNetSpent(manualII.id); await worker.drainQueue();
    assert.equal((await read(higher.id)).circleLevel, 5);
    assert.equal((await read(manualII.id)).circleLevel, 2);
    assert.equal((await read(manualII.id)).circle2PromotedAt.toISOString(), manualDate.toISOString());
    await prisma.user.update({ where: { id: manualII.id }, data: { circle2PromotedAt: new Date() } });
    assert.equal((await read(manualII.id)).circle2PromotedAt.toISOString(), manualDate.toISOString());
    report.checks.push('Existing eligible 85/87.50/90/150 EUR accounts repair; manual/higher circles and existing dates remain unchanged');

    const legacy = await user('legacy', { circleLevel: 2 });
    assert.equal((await read(legacy.id)).circle2PromotedAt, null);
    await assert.rejects(circles.requestPromotion(legacy.id), error => error.getResponse().code === 'promotion_date_unknown');
    const { reconcileUser, recoverCircle2Date } = require('./reconcile-circles-local.cjs');
    const policy = require('../src/membership/circle-policy');
    const repair = (id, apply = true) => prisma.$transaction(tx => reconcileUser(tx, id,
      { apply, now: new Date(), policy }), { isolationLevel: 'Serializable' });
    assert.equal((await repair(legacy.id)).outcome, 'review');
    assert.equal((await read(legacy.id)).circle2PromotedAt, null);
    const evidenced = await user('evidenced', { circleLevel: 2 });
    const historicalDate = new Date(Date.now() - CIRCLE_II_COOLDOWN_MS - 1000);
    await prisma.auditLog.create({ data: { action: 'admin.user.update', actionType: 'admin.user.update',
      targetType: 'user', targetId: String(evidenced.id), fromCircle: 1, toCircle: 2, createdAt: historicalDate } });
    assert.equal((await repair(evidenced.id, false)).outcome, 'would_recover_date');
    assert.equal((await read(evidenced.id)).circle2PromotedAt, null);
    assert.equal((await repair(evidenced.id)).outcome, 'date_recovered');
    assert.equal((await read(evidenced.id)).circle2PromotedAt.toISOString(), historicalDate.toISOString());
    assert.equal((await repair(evidenced.id)).outcome, 'existing_date_preserved');
    assert.equal((await circles.getPromotionEligibility(evidenced.id)).canRequest, true);
    assert.equal(recoverCircle2Date([
      { id: 1, targetType: 'user', targetId: '99', fromCircle: 1, toCircle: 2, createdAt: historicalDate },
      { id: 2, targetType: 'user', targetId: '99', fromCircle: 2, toCircle: 1, createdAt: new Date() },
    ], 99, new Date()).reason, 'promotion_date_current_cycle_unproven');
    const repairEligible = await user('repair-eligible'); await order(repairEligible, 8750);
    assert.equal((await repair(repairEligible.id, false)).outcome, 'would_promote');
    assert.equal((await read(repairEligible.id)).circleLevel, 1);
    assert.equal((await repair(repairEligible.id)).outcome, 'promoted');
    const repairedDate = (await read(repairEligible.id)).circle2PromotedAt.toISOString();
    assert.equal((await repair(repairEligible.id)).outcome, 'existing_date_preserved');
    assert.equal((await read(repairEligible.id)).circle2PromotedAt.toISOString(), repairedDate);
    assert.equal(await prisma.auditLog.count({ where: { targetType: 'user', targetId: String(repairEligible.id) } }), 1);
    report.checks.push('Repair dry run does not write; explicit historical evidence restores date once; missing/ambiguous evidence stays for review; applied eligible repair audited once');
    await assert.rejects(circles.requestPromotion(exact.id), error => error.getResponse().code === 'cooldown');
    const dateBeforeReload = (await circles.getPromotionEligibility(exact.id)).eligibleAt.toISOString();
    const reloadedService = new CircleService(prisma, new CircleUpgradeService(prisma));
    assert.equal((await reloadedService.getPromotionEligibility(exact.id)).eligibleAt.toISOString(), dateBeforeReload);
    const start = new Date('2026-01-01T00:00:00.000Z');
    const before = circle2Eligibility({ circleLevel: 2, circle2PromotedAt: start }, false, new Date(start.getTime() + CIRCLE_II_COOLDOWN_MS - 1));
    const boundary = circle2Eligibility({ circleLevel: 2, circle2PromotedAt: start }, false, new Date(start.getTime() + CIRCLE_II_COOLDOWN_MS));
    assert.equal(before.canRequest, false); assert.equal(before.cooldownMs, 1);
    assert.equal(boundary.canRequest, true); assert.equal(boundary.cooldownMs, 0);
    report.checks.push('Server rejects before 30 full days and unknown legacy date; exact deadline enables request; re-instantiation preserves deadline');

    const mature = await user('mature', { circleLevel: 2, circle2PromotedAt: new Date(Date.now() - CIRCLE_II_COOLDOWN_MS - 1000) });
    assert.equal((await circles.getPromotionEligibility(mature.id)).canRequest, true);
    assert.equal((await read(mature.id)).circleLevel, 2);
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => circles.requestPromotion(mature.id)));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.getStatus() === 409).length, 3);
    assert.equal(await prisma.circlePromotionRequest.count({ where: { userId: mature.id } }), 1);
    assert.equal(await prisma.circleUpgradeRequest.count({ where: { userId: mature.id } }), 1);
    assert.equal((await circles.getPromotionEligibility(mature.id)).hasPending, true);
    assert.equal((await read(mature.id)).circleLevel, 2);
    await prisma.user.update({ where: { id: mature.id }, data: { circleLevel: 5 } });
    await prisma.circlePromotionRequest.update({ where: { userId: mature.id }, data: { promoteAt: new Date(Date.now() - 1000) } });
    await circles.maybePromoteRequestedCircle(mature.id); assert.equal((await read(mature.id)).circleLevel, 5);
    report.checks.push('Deadline alone does not grant III; four simultaneous requests create one pending request and history; processing preserves manual higher circle');

    const circleIII = await user('circle-iii', { circleLevel: 3 });
    const higherAttempts = await Promise.allSettled(Array.from({ length: 4 }, () => upgrade.createRequest(circleIII.id,
      { socialNetwork: 'INSTAGRAM', username: 'circle-fixture' })));
    assert.equal(higherAttempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await prisma.circleUpgradeRequest.count({ where: { userId: circleIII.id, fromCircle: 3, toCircle: 4 } }), 1);
    const higherRequest = await prisma.circleUpgradeRequest.findFirstOrThrow({ where: { userId: circleIII.id } });
    await prisma.circleUpgradeRequest.update({ where: { id: higherRequest.id }, data: { status: 'DENIED' } });
    const higherStatus = await upgrade.getStatus(circleIII.id);
    assert.equal(higherStatus.canRequest, false); assert.ok(higherStatus.eligibleAt); assert.ok(higherStatus.serverTime);
    await assert.rejects(upgrade.createRequest(circleIII.id, { socialNetwork: 'INSTAGRAM', username: 'circle-fixture' }));
    report.checks.push('Existing III to IV request also prevents simultaneous duplicates and retains its existing retry cooldown');

    const automatic = await user('automatic'); await order(automatic, 8500);
    assert.equal(process.env.BACKGROUND_JOBS_ENABLED, 'false'); worker.onModuleInit();
    const timeout = Date.now() + 5000;
    while ((await read(automatic.id)).circleLevel === 1 && Date.now() < timeout) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await read(automatic.id)).circleLevel, 2);
    worker.onModuleDestroy();
    report.checks.push('Persistent worker promotes without visiting any page, with local external background jobs disabled');
  } finally {
    worker?.onModuleDestroy();
    if (prisma) await prisma.$disconnect();
    if (created) {
      assert.match(databaseName, /^cronox_circle_test_[a-f0-9]{32}$/);
      await control.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); report.cleanedUp = true;
    }
    await control.end();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed: report.checks.length, cleanedUp: report.cleanedUp, report: reportPath }));
}
run().catch(error => { console.error(error.stack?.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]') || error.message); process.exitCode = 1; });
