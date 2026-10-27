'use strict';
// Disposable loopback PostgreSQL only. No real users, SMTP or payment provider.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..'), read = file => fs.readFileSync(path.join(backend, file), 'utf8');
const reportFile = path.resolve(backend, '../output/admin-user-deletion/database-results.json');
const report = { isolatedDatabase: true, realUsersDeleted: false, checks: [], passed: false };
async function run() {
  const local = loadLocalEnvironment(); ensureLocalPostgres(local);
  const source = new URL(local.DATABASE_URL); source.search = '';
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  const name = 'cronox_user_delete_test_' + randomUUID().replace(/-/g, '');
  assert.match(name, /^cronox_user_delete_test_[a-f0-9]{32}$/);
  const control = new Client({ connectionString: source.href });
  let created = false, sql, db, second;
  try {
    await control.connect();
    assert.ok(['127.0.0.1','::1'].includes((await control.query('SELECT host(inet_server_addr()) host')).rows[0].host));
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + name;
    const env = { ...local, DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href,
      BACKGROUND_JOBS_ENABLED: 'false', EMAIL_ENABLED: 'false', STRIPE_WEBHOOK_WORKER_ENABLED: 'false' };
    sql = new Client({ connectionString: target.href }); await sql.connect();
    await sql.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'],
      { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
    assert.equal(push.status, 0, 'Disposable schema initialization failed');
    // db push omits SQL-only constraints. Keep the production newsletter CHECK
    // so a successful deletion cannot hide an invalid terminal delivery state.
    const newsletterCheck = read('prisma/migrations/20260930120000_newsletter_mail_jobs/migration.sql')
      .match(/CONSTRAINT "NewsletterMailJob_status_check" CHECK \([^\n]+\)/)[0];
    await sql.query('ALTER TABLE "NewsletterMailJob" ADD ' + newsletterCheck);
    Object.assign(process.env, env);
    require('../test/test-environment.cjs').installTestEnvironment({ force: true, overrides: env });
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { AdminUsersService } = require('../src/admin/users/admin-users.service');
    const { AuthSessionsService } = require('../src/auth/auth-sessions.service');
    const { MembershipService } = require('../src/membership/membership.service');
    const { UserIdentityGuard } = require('../src/users/user-identity.guard');
    db = new PrismaService(); second = new PrismaService(); await db.$connect(); await second.$connect();
    assert.equal((await db.$queryRawUnsafe('SELECT current_database() name'))[0].name, name);
    const old = read('prisma/migrations/20261008190000_consecutive_user_numbers/migration.sql');
    const retired = read('prisma/migrations/20261009020000_retired_user_references/migration.sql');
    const history = read('prisma/migrations/20261009023000_deleted_account_order_history/migration.sql');
    await sql.query(old.slice(old.indexOf('CREATE FUNCTION cronox_user_number_code'), old.indexOf('CREATE FUNCTION cronox_compact_users')));
    await sql.query(old.slice(old.indexOf('CREATE FUNCTION cronox_number_user()'), old.indexOf('DROP TRIGGER "User_check_reserved_id"')));
    await sql.query(retired.slice(retired.indexOf('CREATE FUNCTION cronox_user_reference_key'), retired.indexOf('CREATE FUNCTION cronox_retire_user_references')));
    await sql.query(history.slice(history.indexOf('CREATE OR REPLACE FUNCTION cronox_retire_user_references'), history.lastIndexOf('COMMIT;')));
    for (const trigger of [
      '"User_number_identity" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_number_user()',
      '"User_retire_references" BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_retire_user_references()',
      '"User_delete_gate" BEFORE DELETE ON "User" FOR EACH STATEMENT EXECUTE FUNCTION cronox_lock_user_deletion()',
      '"User_compact_deleted" AFTER DELETE ON "User" FOR EACH STATEMENT EXECUTE FUNCTION cronox_compact_after_user_delete()',
    ]) await sql.query('CREATE TRIGGER ' + trigger);
    await db.userNumberingState.create({ data: { id: 1, nextId: 1, ready: false } });
    // Simulate a previously retired high number: migration must respect it.
    await db.userIdentityReservation.create({ data: { userId: 50, memberCode: 'CRX-000050' } });
    await sql.query('DROP TABLE "AdminUserDeletion"');
    await sql.query(read('prisma/migrations/20261027210000_safe_user_deletion_permanent_ids/migration.sql'));
    const check = name => { report.checks.push(name); console.log('[PASS]', name); };
    let counter = 0;
    const create = (data = {}) => db.user.create({ data: { email: `delete-fixture-${++counter}@example.test`, ...data } });
    const actor = await create({ role: 'SUPERADMIN' }), admin = await create({ role: 'ADMIN' });
    assert.equal(actor.id, 51); assert.equal(actor.memberCode, 'CRX-000051');
    const service = new AdminUsersService(db), competing = new AdminUsersService(second), sessions = new AuthSessionsService(db);
    const membership = new MembershipService(db, {}, {}, {});
    const dto = user => ({ confirmed: true, expectedUpdatedAt: user.updatedAt.toISOString() });
    const remove = (user, adminId = actor.id, options = dto(user)) => service.deleteUser(user.id, user.identityUid, options, adminId, { requestId: 'isolated-test' });
    const exists = user => db.user.findUnique({ where: { id: user.id } });
    check('Real migration disables legacy compaction and retains retired allocation high-water mark');
    const empty = await create({ name: 'Fictional <account>', email: 'fictional@gmail.con' });
    const tail = await create({ accountState: 'INACTIVE' });
    const originalTail = { id: tail.id, uid: tail.identityUid, code: tail.memberCode, qr: tail.publicMemberToken };
    await assert.rejects(remove(actor), /propia cuenta/);
    await assert.rejects(remove(empty, admin.id), /Super Admin/);
    await assert.rejects(remove(empty, actor.id, { ...dto(empty), confirmed: false }), /expresamente/);
    await assert.rejects(remove(empty, actor.id, { ...dto(empty), expectedUpdatedAt: new Date(0).toISOString() }), /cambiado/);
    assert.ok(await exists(empty)); check('Self-deletion, ADMIN access, missing confirmation and stale version reject without changes');
    const token = await sessions.create(empty);
    assert.equal((await sessions.verify(token.accessToken, 'access')).user.id, empty.id);
    await db.passwordResetToken.create({ data: { userId: empty.id, token: 'fixture-reset-token', expiresAt: new Date(Date.now()+60000) } });
    await db.emailChangeRequest.create({ data: { userId: empty.id, id: randomUUID(), oldEmail: empty.email,
      newEmail: 'new-fictional@example.test', sessionVersion: empty.sessionVersion, stage: 'VERIFY_NEW', tokenHash: 'change-fixture',
      cancelHash: 'cancel-fixture', expiresAt: new Date(Date.now()+60000), lastSentAt: new Date(), windowAt: new Date() } });
    const product = await db.product.create({ data: { slug: 'delete-fixture', name: 'Fixture', price: 1000,
      variants: { create: { size: 'M', sku: 'delete-fixture', stockQty: 9 } } }, include: { variants: true } });
    await db.favorite.create({ data: { userId: empty.id, productId: product.id } });
    await db.restockRequest.create({ data: { userId: empty.id, variantId: product.variants[0].id } });
    const cart = await db.cart.create({ data: { userId: empty.id, items: { create: { variantId: product.variants[0].id, qty: 1, priceAtAdd: 1000 } } } });
    await db.checkoutPresence.create({ data: { cartId: cart.id, tabId: randomUUID(), expiresAt: new Date(Date.now()+60000) } });
    const promo = await db.promoCode.create({ data: { code: 'DELETE-FIXTURE', type: 'PERCENT', value: 10, ownerUserId: empty.id, ownerEmail: empty.email } });
    await db.newsletterSubscription.create({ data: { userId: empty.id, email: empty.email, subscribedAt: new Date(), verificationTokenHash: 'fixture-verification' } });
    const job = await db.newsletterMailJob.create({ data: { email: empty.email, kind: 'ACCESS', userId: empty.id, tokenHash: 'fixture-access', status: 'PROCESSING', claimToken: 'fixture-claim' } });
    await db.historial.create({ data: { userId: empty.id } });
    assert.equal((await membership.getMemberInfo(empty.publicMemberToken)).valid, true);
    const before = await service.listUsers({ pageSize: 100, order: 'asc' });
    const tailNumber = before.data.find(u => u.id === tail.id).registrationNumber;
    const raced = await Promise.all([remove(empty), competing.deleteUser(empty.id, empty.identityUid, dto(empty), actor.id)]);
    assert.ok(raced.every(r => r.deleted)); assert.equal(raced.filter(r => !r.alreadyDeleted).length, 1);
    assert.equal(await exists(empty), null);
    assert.equal(await db.auditLog.count({ where: { actionType: 'admin.user.delete', targetId: String(empty.id) } }), 1);
    assert.equal((await remove(empty)).alreadyDeleted, true);
    assert.equal(await db.authSession.count({ where: { userId: empty.id } }), 0);
    await assert.rejects(sessions.verify(token.accessToken, 'access')); await assert.rejects(sessions.rotate(token.refreshToken));
    assert.equal((await membership.getMemberInfo(empty.publicMemberToken)).valid, false);
    assert.equal(await db.passwordResetToken.count({ where: { userId: empty.id } }), 0);
    assert.equal(await db.emailChangeRequest.count({ where: { userId: empty.id } }), 0);
    for (const model of ['favorite','restockRequest','cart','historial','newsletterSubscription']) assert.equal(await db[model].count({ where: { userId: empty.id } }), 0);
    assert.equal(await db.checkoutPresence.count({ where: { cartId: cart.id } }), 0);
    const canceled = await db.newsletterMailJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(canceled.status, 'FAILED'); assert.equal(canceled.errorCode, 'ACCOUNT_DELETED');
    assert.equal(canceled.tokenHash, null); assert.equal(canceled.userId, null);
    assert.equal((await db.promoCode.findUniqueOrThrow({ where: { id: promo.id } })).isActive, false);
    check('Concurrent/repeated deletion commits one receipt/audit; sessions, refresh/reset/access links, QR, favorites, waitlist and cart are invalidated');
    const after = await service.listUsers({ pageSize: 100, order: 'asc' });
    assert.equal(after.data.find(u => u.id === tail.id).registrationNumber, tailNumber - 1);
    const savedTail = await exists(tail); assert.deepEqual({ id: savedTail.id, uid: savedTail.identityUid, code: savedTail.memberCode, qr: savedTail.publicMemberToken }, originalTail);
    const newAccount = await create(); assert.ok(newAccount.id > tail.id); assert.notEqual(newAccount.id, empty.id);
    await assert.rejects(db.user.create({ data: { email: 'reused-qr@example.test', publicMemberToken: empty.publicMemberToken } }));
    await assert.rejects(db.user.create({ data: { email: 'reused-uid@example.test', identityUid: empty.identityUid } }));
    await assert.rejects(db.user.update({ where: { id: tail.id }, data: { id: 99999, memberCode: 'CRX-099999' } }));
    await assert.rejects(sql.query('SELECT cronox_compact_users(0,\'[]\',\'test\')'));
    check('Intermediate deletion compacts ordinals; internal ID, CRX, UUID and QR stay permanent; registrations never reuse retired identities');
    const bought = await create();
    const order = await db.order.create({ data: { userId: bought.id, customerEmail: bought.email, total: 10, subtotal: 10, taxRate: 0, taxAmount: 0, currency: 'EUR', status: 'PAID', provider: 'fixture', providerRef: 'fixture-only' } });
    const snapshotBefore = JSON.stringify(await db.order.findUnique({ where: { id: order.id } }));
    await assert.rejects(remove(bought), error => error.getResponse().code === 'USER_DELETE_BLOCKED' && /pedidos/.test(error.message));
    assert.ok(await exists(bought)); assert.equal(JSON.stringify(await db.order.findUnique({ where: { id: order.id } })), snapshotBefore);
    const stockOwner = await create();
    await db.stockMovement.create({ data: { userId: stockOwner.id, variantId: product.variants[0].id, reason: 'ADJUSTMENT', delta: 1 } });
    await assert.rejects(remove(stockOwner), /stock/);
    const qrOwner = await create(); const group = await db.qrEventGroup.create({ data: { name: 'Fixture QR', createdByIdentityUid: actor.identityUid } });
    await db.qrEventParticipant.create({ data: { groupId: group.id, userIdentityUid: qrOwner.identityUid, circleAtRegistration: 1 } });
    await assert.rejects(remove(qrOwner), /QR/);
    check('Paid orders and stock trace block deletion; QR participation alone requires the new explicit confirmation');
    await require('./test-user-qr-deletion-fixtures.cjs')({db,second,sql,service,competing,actor,admin,create,sessions,membership,check,product});
    {
      const { CartService } = require('../src/cart/cart.service');
      const { OrdersService } = require('../src/orders/orders.service');
      const { TaxConfigService } = require('../src/common/tax/tax-config.service');
      const { ShippingMethodsService } = require('../src/shipping-methods/shipping-methods.service');
      const { HistorialService } = require('../src/historial/historial.service');
      const { GuestOrderAccountService } = require('../src/orders/guest-order-account.service');
      await db.shippingMethod.create({ data: { id: 1, name: 'Standard fixture', price: 295 } });
      const checkoutUser = await create(); const carts = new CartService(db);
      const cart = await carts.addItem({ userId: checkoutUser.id }, { variantId: product.variants[0].id, qty: 1 });
      const orders = new OrdersService(db, carts, new TaxConfigService(), new ShippingMethodsService(db), new HistorialService(db), new GuestOrderAccountService());
      await orders.createCheckoutSnapshotForOwner({ userId: checkoutUser.id, customerEmail: checkoutUser.email }, { shippingMethod: 'STANDARD' }, { cart, presenceOnly: true });
      await assert.rejects(remove(checkoutUser), /checkouts/);
      assert.ok(await exists(checkoutUser));
      assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockQty, 8);
      // Restore the test inventory through the existing reservation lifecycle.
      const snapshot = await orders.getActiveReservation({ userId: checkoutUser.id }, cart.id);
      await orders.releaseCheckoutSnapshot(snapshot.id, 'EXPIRED');
      check('Existing checkout reservation blocks deletion without canceling payment or changing held inventory');
    }
    const administrative = await create({ role: 'ADMIN' });
    assert.equal((await remove(administrative)).deleted, true);
    const unknown = await create();
    await sql.query('CREATE TABLE "FutureTrace" (id serial PRIMARY KEY, "userId" integer REFERENCES "User"(id) ON DELETE CASCADE)');
    await sql.query('INSERT INTO "FutureTrace" ("userId") VALUES ($1)', [unknown.id]);
    await assert.rejects(remove(unknown), /FutureTrace/); assert.ok(await exists(unknown));
    check('Only authorized Super Admin deletes an unused administrative account; unreviewed cascading relations fail closed');
    // A failure after receipt creation must roll back the entire access cleanup.
    const rollback = await create(); const rollbackTokens = await sessions.create(rollback);
    await sql.query(`CREATE FUNCTION test_reject_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id=${rollback.id} THEN RAISE EXCEPTION 'isolated failure'; END IF; RETURN OLD; END $$;
      CREATE TRIGGER "zz_test_delete_failure" BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION test_reject_user_delete()`);
    await assert.rejects(remove(rollback)); assert.ok(await exists(rollback));
    assert.equal((await sessions.verify(rollbackTokens.accessToken,'access')).user.id, rollback.id);
    assert.equal(await db.auditLog.count({ where: { actionType: 'admin.user.delete', targetId: String(rollback.id) } }), 0);
    assert.equal((await sql.query('SELECT count(*)::integer n FROM "AdminUserDeletion" WHERE "userId"=$1',[rollback.id])).rows[0].n, 0);
    await sql.query('DROP TRIGGER "zz_test_delete_failure" ON "User"; DROP FUNCTION test_reject_user_delete()');
    check('Server failure rolls back user deletion, receipt, audit and access cleanup together');
    // Global creation ranking precedes all user filters and both sort modes.
    for (let i=0;i<104;i++) await create({ accountState: i%2 ? 'ACTIVE' : 'INACTIVE', createdAt: new Date('2026-10-20T00:00:00Z') });
    const all = await db.user.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    const ordinals = new Map(all.map((u,i) => [u.id,i+1]));
    for (const query of [{ page: 2, pageSize: 100 }, { q: tail.email }, { role: 'USER', accountState: 'INACTIVE' }, { sort: 'orders', order: 'asc', page: 2, pageSize: 3 }]) {
      const list = await service.listUsers(query);
      for (const user of list.data) assert.equal(user.registrationNumber, ordinals.get(user.id));
    }
    const secondPage = await service.listUsers({ page: 2, pageSize: 100 }); assert.ok(secondPage.data.length > 0);
    check('Global ordinals include inactive accounts, use stable creation-date/ID tie break and survive pagination/search/filter/metric sorting');
    const identityGuard = new UserIdentityGuard(db);
    assert.equal(await identityGuard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method: 'DELETE', path: `/api/admin/users/${empty.id}`, params: { id: String(empty.id) }, headers: { 'x-cronox-user-identity': empty.identityUid } }) }) }), true);
    await assert.rejects(identityGuard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method: 'DELETE', path: `/api/admin/users/${empty.id}`, params: { id: String(empty.id) }, headers: { 'x-cronox-user-identity': randomUUID() } }) }) }));
    assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockQty, 9);
    assert.equal(JSON.stringify(await db.order.findUnique({ where: { id: order.id } })), snapshotBefore);
    check('Deletion replay passes stable-identity guard; other users, orders and inventory remain unchanged');
    report.passed = true;
  } finally {
    if (second) await second.$disconnect(); if (db) await db.$disconnect(); if (sql) await sql.end();
    if (created) { await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); report.cleanedUp = true; }
    await control.end();
  }
}
run().catch(error => { report.error = error.message.replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted]'); console.error(error); process.exitCode=1; }).finally(() => {
  fs.mkdirSync(path.dirname(reportFile),{recursive:true}); fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
});
