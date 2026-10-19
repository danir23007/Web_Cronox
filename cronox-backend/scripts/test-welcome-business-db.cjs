'use strict';
// Real local PostgreSQL/cart/pricing/checkout/fulfillment. No provider or SMTP calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const report = { checks: [], realMailSent: false, realPayments: false, cleanedUp: false };
async function main() {
  const env = loadLocalEnvironment(); ensureLocalPostgres(env);
  const source = new URL(env.DATABASE_URL); assert.equal(source.host, '127.0.0.1:5433');
  const name = 'cronox_welcome_business_' + randomUUID().replace(/-/g, '');
  const control = new Client({ connectionString: source.href });
  let db, sql, created = false;
  try {
    await control.connect();
    assert.ok(['127.0.0.1', '::1'].includes((await control.query('SELECT host(inet_server_addr()) host')).rows[0].host));
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + name;
    Object.assign(env, { DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href, EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false' });
    Object.assign(process.env, env);
    sql = new Client({ connectionString: target.href }); await sql.connect();
    await sql.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
    assert.equal(push.status, 0, 'Disposable schema initialization');
    // Includes the real partial uniqueness constraint for concurrent carts.
    const bankIndex = fs.readFileSync(path.join(backend, 'prisma/migrations/20261013160000_bank_transfer_pending_reservation/migration.sql'), 'utf8');
    await sql.query(bankIndex.replace('DROP INDEX ', 'DROP INDEX IF EXISTS '));
    const { PrismaClient } = require('@prisma/client'); db = new PrismaClient();
    await db.userNumberingState.create({ data: { id: 1, nextId: 1, ready: true } });
    const numbering = fs.readFileSync(path.join(backend, 'prisma/migrations/20261008190000_consecutive_user_numbers/migration.sql'), 'utf8');
    await sql.query(numbering.slice(numbering.indexOf('CREATE FUNCTION cronox_user_number_code'), numbering.indexOf('CREATE FUNCTION cronox_user_number_plan')));
    await sql.query(numbering.slice(numbering.indexOf('CREATE FUNCTION cronox_number_user()'), numbering.indexOf('CREATE FUNCTION cronox_lock_user_deletion()')));
    await sql.query('CREATE TRIGGER "User_number_identity" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_number_user()');
    const { OrdersService } = require('../dist/orders/orders.service');
    const { CartService } = require('../dist/cart/cart.service');
    const { TaxConfigService } = require('../dist/common/tax/tax-config.service');
    const { ShippingMethodsService } = require('../dist/shipping-methods/shipping-methods.service');
    const { HistorialService } = require('../dist/historial/historial.service');
    const { GuestOrderAccountService } = require('../dist/orders/guest-order-account.service');
    const { UsersService } = require('../dist/users/users.service');
    const { ensureAccountWelcome } = require('../dist/users/account-welcome');
    const { NewsletterDeliveryService } = require('../dist/newsletter/newsletter-delivery.service');
    const carts = new CartService(db);
    const orders = new OrdersService(db, carts, new TaxConfigService(), new ShippingMethodsService(db), new HistorialService(db), new GuestOrderAccountService());
    const sent = [];
    const worker = new NewsletterDeliveryService(db, { sendNewsletterWelcome: async (to, code) => {
      assert.ok(code && !/VISTA|EJEMPLO|BIENVENIDA10/.test(code)); sent.push({ to, code }); return { messageId: 'SIMULATED-ACCEPTANCE-' + sent.length };
    } });
    const deliver = async user => {
      const job = await db.newsletterMailJob.findFirstOrThrow({ where: { userId: user.id, kind: 'WELCOME' } });
      await db.newsletterMailJob.update({ where: { id: job.id }, data: { status: 'PROCESSING', claimToken: 'fixture', attempts: 1 } });
      await Promise.all([worker.dispatch(job.id, 'fixture'), worker.dispatch(job.id, 'fixture')]);
      return db.newsletterMailJob.findUniqueOrThrow({ where: { id: job.id } });
    };
    const product = await db.product.create({ data: { name: 'Welcome fixture', slug: 'welcome-fixture', price: 10000, variants: { create: { sku: 'WELCOME-FIXTURE', size: 'M', stockQty: 100 } } }, include: { variants: true } });
    const variantId = product.variants[0].id;
    await db.shippingMethod.create({ data: { id: 1, name: 'STANDARD', price: 500, isActive: true, countries: ['ES'] } });
    const params = { shippingMethod: 'STANDARD', shippingAddress: { firstName: 'Fixture', lastName: 'Buyer', line1: 'Calle Local 1', city: 'Madrid', postalCode: '28001', country: 'ES' } };
    const snapshot = async (owner, code) => {
      await carts.addItem(owner, { variantId, qty: 1 });
      return orders.createCheckoutSnapshotForOwner(owner, { ...params, ...(code ? { promoCode: code } : {}) });
    };
    const pay = async (frozen, prefix = 'fixture') => {
      const paymentIntentId = 'pi_' + prefix + '_' + randomUUID();
      await orders.claimCheckoutPaymentIntentCreation(frozen.checkoutSnapshotId);
      await orders.bindStripePaymentIntent(frozen.checkoutSnapshotId, paymentIntentId, 'acct_fixture');
      const input = { checkoutSnapshotId: frozen.checkoutSnapshotId, paymentIntentId, amountCents: frozen.amountCents, currency: 'EUR', occurredAt: new Date() };
      const results = await Promise.all([orders.createOrderFromVerifiedStripePayment(input), orders.createOrderFromVerifiedStripePayment(input)]);
      assert.equal(results[0].orderId, results[1].orderId);
      return db.order.findUniqueOrThrow({ where: { id: results[0].orderId } });
    };
    const regular = await new UsersService(db).createUser({ email: 'normal@welcome.invalid', password: 'fixture' });
    assert.ok(regular.firstOrderDiscountCode);
    assert.equal((await deliver(regular)).status, 'SENT');
    assert.equal(sent.filter(x => x.to === regular.email).length, 1);
    report.checks.push('Normal signup: one personal code/job/verified simulated acceptance, duplicate dispatch sends once without newsletter consent');

    const regularOwner = { userId: regular.id, customerEmail: regular.email };
    for (const complete of [false, true]) {
      const bank = await snapshot(regularOwner, regular.firstOrderDiscountCode);
      const paymentIntentId = 'pi_bank_fixture_' + randomUUID();
      await orders.claimCheckoutPaymentIntentCreation(bank.checkoutSnapshotId);
      await orders.bindStripePaymentIntent(bank.checkoutSnapshotId, paymentIntentId, 'acct_fixture');
      const pending = await orders.reserveBankTransfer(bank.checkoutSnapshotId, paymentIntentId);
      assert.equal(pending.status, 'BANK_TRANSFER_PENDING');
      assert.equal((await db.promoCode.findUniqueOrThrow({ where: { code: regular.firstOrderDiscountCode } })).usageCount, 0);
      assert.equal((await db.accountWelcomeBenefit.findUniqueOrThrow({ where: { userId: regular.id } })).firstOnlineOrderId, null);
      if (complete) {
        const input = { checkoutSnapshotId: bank.checkoutSnapshotId, paymentIntentId, amountCents: bank.amountCents, currency: 'EUR', occurredAt: new Date() };
        const fulfilled = await Promise.all([orders.createOrderFromVerifiedStripePayment(input), orders.createOrderFromVerifiedStripePayment(input)]);
        assert.equal(fulfilled[0].orderId, pending.orderId); assert.equal(fulfilled[1].orderId, pending.orderId);
        assert.equal((await db.order.findUniqueOrThrow({ where: { id: pending.orderId } })).discountCents, 1000);
        assert.equal((await db.promoCode.findUniqueOrThrow({ where: { code: regular.firstOrderDiscountCode } })).usageCount, 1);
      } else {
        await orders.releaseCheckoutSnapshot(bank.checkoutSnapshotId, 'PAYMENT_CANCELLED');
        await db.cartItem.deleteMany({ where: { cart: { userId: regular.id } } });
      }
    }
    report.checks.push('Bank transfer with welcome code: pending/cancelled consumes nothing; later verified payment converts the same pending order and redeems once under concurrent retries');

    const a = await pay(await snapshot({ anonymousId: 'guest-A-fixture-unique', customerEmail: 'guest@welcome.invalid' }), 'A');
    const guest = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    const owner = { anonymousId: 'guest-B-followup-fixture', customerEmail: guest.email };
    const code = guest.firstOrderDiscountCode;
    const context = await db.accountWelcomeBenefit.findUniqueOrThrow({ where: { userId: guest.id } });
    assert.equal(context.originOrderId, a.id); assert.equal(context.originCheckoutId, (await db.checkoutSnapshot.findUniqueOrThrow({ where: { orderId: a.id } })).id);
    assert.equal(a.discountCents, 0); assert.equal(guest.firstOrderDiscountUsed, false);
    let promo = await db.promoCode.findUniqueOrThrow({ where: { code } }); assert.equal(promo.usageCount, 0);
    assert.equal((await orders.validatePromoAvailability(promo, { userId: guest.id })).valid, false, 'No benefit before persisted send acceptance');
    assert.equal((await deliver(guest)).status, 'SENT');
    const accepted = await db.accountWelcomeBenefit.findUniqueOrThrow({ where: { userId: guest.id } });
    assert.ok(accepted.sentAt && accepted.smtpMessageId); assert.equal(accepted.firstOnlineOrderId, null);
    assert.equal((await orders.validatePromoAvailability(promo, { userId: regular.id })).valid, false);
    await db.newsletterMailJob.update({ where: { id: accepted.welcomeJobId }, data: { sentAt: new Date(accepted.sentAt.getTime() + 1) } });
    assert.equal((await orders.validatePromoAvailability(promo, { userId: guest.id })).valid, false, 'Mismatched acceptance evidence cannot enable the code');
    await db.newsletterMailJob.update({ where: { id: accepted.welcomeJobId }, data: { sentAt: accepted.sentAt } });
    await Promise.all(Array.from({ length: 4 }, () => db.$transaction(tx => ensureAccountWelcome(tx, guest.id, true), { timeout: 30000 })));
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: guest.id } })).firstOrderDiscountCode, code);
    assert.equal(await db.newsletterMailJob.count({ where: { userId: guest.id, kind: 'WELCOME' } }), 1);
    report.checks.push('Guest paid order A creates one account/code and explicit origin checkout/order; A has no retroactive discount, consumes nothing, benefit gated by persisted simulated SMTP acceptance');

    for (const status of ['PAYMENT_CANCELLED', 'EXPIRED', 'PAYMENT_CREATION_FAILED']) {
      const abandoned = await snapshot(owner, code);
      assert.equal((await db.checkoutSnapshot.findUniqueOrThrow({ where: { id: abandoned.checkoutSnapshotId } })).discountCents, 1000);
      await orders.releaseCheckoutSnapshot(abandoned.checkoutSnapshotId, status);
      await db.cartItem.deleteMany({ where: { cart: { anonymousId: owner.anonymousId } } });
      assert.equal((await db.promoCode.findUniqueOrThrow({ where: { id: promo.id } })).usageCount, 0);
      assert.equal((await db.accountWelcomeBenefit.findUniqueOrThrow({ where: { userId: guest.id } })).firstOnlineOrderId, null);
    }
    await db.order.create({ data: { userId: guest.id, customerEmail: guest.email, source: 'IN_PERSON_ADMIN', status: 'PAID', paidAt: new Date(), subtotal: 20, total: 20, taxRate: 0, taxAmount: 0 } });
    await carts.addItem(owner, { variantId, qty: 1 });
    const fresh = await Promise.all(Array.from({ length: 4 }, () => orders.createCheckoutSnapshotForOwner(owner, { ...params, promoCode: code })));
    const frozen = fresh[0]; assert.ok(fresh.every(row => row.checkoutSnapshotId === frozen.checkoutSnapshotId));
    const repeated = await Promise.all(Array.from({ length: 4 }, () => orders.createCheckoutSnapshotForOwner(owner, { ...params, promoCode: code })));
    assert.ok(repeated.every(row => row.checkoutSnapshotId === frozen.checkoutSnapshotId));
    const b = await pay(frozen, 'B');
    assert.equal(b.discountCents, 1000); assert.equal(b.total.toString(), '90');
    assert.equal((await db.accountWelcomeBenefit.findUniqueOrThrow({ where: { userId: guest.id } })).firstOnlineOrderId, b.id);
    promo = await db.promoCode.findUniqueOrThrow({ where: { id: promo.id } });
    assert.equal(promo.usageCount, 1); assert.equal(await db.promoCodeRedemption.count({ where: { promoCodeId: promo.id } }), 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: guest.id } })).firstOrderDiscountUsed, true);
    assert.equal((await db.discountCode.findUniqueOrThrow({ where: { code } })).used, true);
    await assert.rejects(() => snapshot(owner, code));
    await db.$transaction(tx => ensureAccountWelcome(tx, guest.id, true));
    assert.equal((await db.promoCode.findUniqueOrThrow({ where: { id: promo.id } })).usageCount, 1);
    report.checks.push('Real checkout B after A/welcome: 100 EUR -> 10 EUR discount -> 90 EUR paid, one atomic redemption despite concurrent fulfillment/retries; C rejected; failed/abandoned reservations consume nothing; manual purchase does not block');

    const forfeits = await new UsersService(db).createUser({ email: 'without-code@welcome.invalid', password: 'fixture' });
    await deliver(forfeits);
    const noCodeOwner = { userId: forfeits.id, customerEmail: forfeits.email };
    await pay(await snapshot(noCodeOwner), 'WITHOUT-CODE');
    await assert.rejects(() => snapshot(noCodeOwner, forfeits.firstOrderDiscountCode));
    report.checks.push('An actual first online purchase after welcome without the code prevents using the benefit on an arbitrary later purchase');

    const missing = await new UsersService(db).createUser({ email: 'missing@welcome.invalid', password: 'fixture' });
    await db.user.update({ where: { id: missing.id }, data: { firstOrderDiscountCode: null } });
    const before = sent.length; const blocked = await deliver(missing);
    assert.equal(blocked.status, 'FAILED'); assert.equal(blocked.errorCode, 'WELCOME_PERSONAL_CODE_UNAVAILABLE'); assert.equal(blocked.sentAt, null); assert.equal(sent.length, before);
    assert.equal((await db.accountWelcomeBenefit.findUniqueOrThrow({ where: { userId: missing.id } })).sentAt, null);
    report.checks.push('Missing code: no transport invocation, explicit durable data error, no unbounded retries or fictitious replacement');

    const queuedUser = await new UsersService(db).createUser({ email: 'queued@welcome.invalid', password: 'fixture' });
    const queuedJob = await db.newsletterMailJob.findFirstOrThrow({ where: { userId: queuedUser.id, kind: 'WELCOME' } });
    await db.newsletterMailJob.update({ where: { id: queuedJob.id }, data: { status: 'PROCESSING', claimToken: 'queued', attempts: 1 } });
    await new NewsletterDeliveryService(db, { sendNewsletterWelcome: async () => ({ messageId: 'ONLY-QUEUED', queued: true }) }).dispatch(queuedJob.id, 'queued');
    assert.equal((await db.newsletterMailJob.findUniqueOrThrow({ where: { id: queuedJob.id } })).status, 'UNCERTAIN');
    assert.equal((await db.accountWelcomeBenefit.findUniqueOrThrow({ where: { userId: queuedUser.id } })).sentAt, null);
    report.checks.push('Queued transport outcome is not persisted as SMTP acceptance, does not activate eligibility, and cannot cause an automatic duplicate welcome');

    const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
    const { resolveMailCircle } = require('../dist/email/managed/mail-circle-folders');
    const managed = new ManagedMailService(db, {});
    const keys = ['NOREPLY', 'ORDERS', 'SUPPORT', 'INFO'];
    for (const key of keys) await managed.initialize(key);
    const canonical = await db.emailTemplateFolder.findUniqueOrThrow({ where: { senderKey_name: { senderKey: 'NOREPLY', name: 'Círculo 1' } } });
    const template = await db.managedEmailTemplate.findUniqueOrThrow({ where: { importKey: 'NOREPLY:1:NEWSLETTER_WELCOME' } });
    const preserved = await db.managedEmailTemplate.update({ where: { id: template.id }, data: { visualClassification: 'UNIQUE' } });
    const alias = await db.emailTemplateFolder.create({ data: { senderKey: 'NOREPLY', name: '  Círculo  I ' } });
    await db.managedEmailTemplate.update({ where: { id: template.id }, data: { folderId: alias.id } });
    await sql.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261019120000_mail_canonical_circle_folders/migration.sql'), 'utf8'));
    const restored = await db.managedEmailTemplate.findUniqueOrThrow({ where: { id: template.id } });
    for (const field of ['id', 'html', 'text', 'document', 'revision', 'visualClassification', 'folderId']) assert.deepEqual(restored[field], preserved[field]);
    for (const input of ['I', ' Círculo I ', 'círculo   1', '1']) {
      const resolved = await Promise.all(Array.from({ length: 4 }, () => db.$transaction(tx => resolveMailCircle(tx, 'NOREPLY', input))));
      assert.ok(resolved.every(row => row.id === canonical.id));
    }
    await Promise.all([managed.initialize('NOREPLY'), managed.initialize('NOREPLY'), managed.saveFolder('NOREPLY', 'Círculo I')]);
    await assert.rejects(() => managed.saveFolder('NOREPLY', 'Círculo VI'), /cinco/);
    await assert.rejects(() => managed.saveFolder('NOREPLY', 'Círculo 6'), /cinco/);
    await assert.rejects(() => db.emailTemplateFolder.create({ data: { senderKey: 'NOREPLY', name: 'Círculo I' } }));
    report.folders = {};
    for (const key of keys) {
      const rows = await managed.folders(key); report.folders[key] = rows.map(row => row.name);
      assert.deepEqual(report.folders[key], Array.from({ length: 5 }, (_, i) => 'Círculo ' + (i + 1)));
    }
    report.checks.push('Canonical folder migration moves the same customized template to original numeric id; repeated/concurrent initialize/import/alias resolution preserves five circles per sender; DB rejects raw Roman insert');
    report.passed = true;
  } finally {
    if (sql) await sql.end();
    if (db) await db.$disconnect();
    if (created) { await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); report.cleanedUp = true; }
    await control.end();
    const destination = path.resolve(backend, '../test-results/welcome-business/database.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
