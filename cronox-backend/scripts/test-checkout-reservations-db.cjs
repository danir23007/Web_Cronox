'use strict';
// Real disposable loopback PostgreSQL + production services + controlled Date.
// Stripe is an isolated stateful provider double; no network payments or email.
const fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const reportPath = path.resolve(backend, '../output/stock-reservations/database-results.json');
const report = { isolatedDatabase: true, provider: 'STATEFUL_STRIPE_DOUBLE', realCharges: false, checks: [], passed: false };
async function run() {
  const env = loadLocalEnvironment(); ensureLocalPostgres(env);
  const source = new URL(env.DATABASE_URL); source.search = '';
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  const name = `cronox_reservation_test_${randomUUID().replace(/-/g, '')}`;
  assert.match(name, /^cronox_reservation_test_[a-f0-9]{32}$/);
  const control = new Client({ connectionString: source.href });
  let db, clock, created = false;
  try {
    await control.connect();
    assert.ok(['127.0.0.1', '::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + name;
    const setup = new Client({ connectionString: target.href }); await setup.connect();
    await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    const isolated = { ...env, DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href,
      EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false', STRIPE_WEBHOOK_WORKER_ENABLED: 'false',
      STRIPE_SECRET_KEY: 'sk_test_local_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_local_fixture', JWT_ACCESS_SECRET: 'local-reservation-fixture-secret-at-least-32-chars' };
    const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], { cwd: backend, env: isolated, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.equal(push.status, 0, 'Schema initialization failed');
    await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261013160000_bank_transfer_pending_reservation/migration.sql'), 'utf8').replace('DROP INDEX ', 'DROP INDEX IF EXISTS '));
    // Execute the actual new migration, rather than validating only db push.
    await setup.query('DROP TABLE "CheckoutPresence"; ALTER TABLE "CheckoutSnapshot" DROP COLUMN "reservationPhase", DROP COLUMN "paymentStartedAt", DROP COLUMN "stripeCreateRequest", DROP COLUMN "reservationRetryAt"');
    await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261027190000_checkout_presence_and_payment_window/migration.sql'), 'utf8'));
    await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261027233000_checkout_presence_private/migration.sql'), 'utf8'));
    assert.equal((await setup.query(`SELECT relrowsecurity FROM pg_class WHERE oid='"CheckoutPresence"'::regclass`)).rows[0].relrowsecurity,true);
    for(const role of ['anon','authenticated'])if((await setup.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount){
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await setup.query('SELECT has_table_privilege($1,$2,$3) allowed',[role,'"CheckoutPresence"',privilege])).rows[0].allowed,false);
    }
    report.migrationAppliedInDisposableDatabase = true;
    await setup.end();
    Object.assign(process.env, isolated);
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { CartService } = require('../src/cart/cart.service');
    const { OrdersService } = require('../src/orders/orders.service');
    const { TaxConfigService } = require('../src/common/tax/tax-config.service');
    const { ShippingMethodsService } = require('../src/shipping-methods/shipping-methods.service');
    const { HistorialService } = require('../src/historial/historial.service');
    const { GuestOrderAccountService } = require('../src/orders/guest-order-account.service');
    const { StripeService } = require('../src/payments/stripe.service');
    const { PaymentIntentFactory } = require('../src/payments/payment-intent.factory');
    const { CheckoutReservationCleanupService } = require('../src/payments/checkout-reservation-cleanup.service');
    const { CheckoutPresenceController } = require('../src/payments/checkout-presence.controller');
    const { BankTransferService } = require('../src/payments/bank-transfer.service');
    const { StripeWebhookRecoveryService } = require('../src/payments/stripe-webhook-recovery.service');
    const { StripeWebhookController } = require('../src/payments/stripe-webhook.controller');
    db = new PrismaService(); await db.$connect();
    assert.equal((await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, name);
    await db.shippingMethod.createMany({ data: [{ id: 1, name: 'Standard fixture', price: 295 }, { id: 2, name: 'Express fixture', price: 495 }] });
    clock = require('@sinonjs/fake-timers').install({ now: Date.now(), toFake: ['Date'] });
    const advance = ms => clock.setSystemTime(Date.now() + ms);
    const cart = new CartService(db);
    const orders = new OrdersService(db, cart, new TaxConfigService(), new ShippingMethodsService(db), new HistorialService(db), new GuestOrderAccountService());
    const intents = new Map(), keys = new Map();
    let offline = false, loseCreateReply = false, succeedDuringCancel = false;
    const stripe = new StripeService({ get: key => isolated[key] });
    const signatureApi = stripe.stripe.webhooks;
    const provider = {
      accounts: { retrieve: async () => ({ id: 'acct_local_fixture' }) },
      webhooks: signatureApi,
      paymentMethodConfigurations: { list: async () => ({ data: [{ is_default: true, active: true, customer_balance: { available: true } }] }) },
      customers: { create: async () => ({ id: 'cus_fixture' }) },
      paymentIntents: {
        async create(input, options) {
          let id = keys.get(options.idempotencyKey);
          if (!id) { id = 'pi_' + randomUUID().replace(/-/g, ''); keys.set(options.idempotencyKey, id); intents.set(id, { ...input, id, currency: input.currency.toLowerCase(), amount_received: 0, status: 'requires_payment_method', livemode: false, client_secret: `${id}_secret_fixture`, payment_method_types: ['card', 'paypal', 'customer_balance'] }); }
          if (loseCreateReply) { loseCreateReply = false; throw new Error('Connection lost after provider committed'); }
          return { ...intents.get(id) };
        },
        async retrieve(id) { if (offline) throw new Error('Provider temporarily unavailable'); assert.ok(intents.has(id)); return { ...intents.get(id) }; },
        async update(id, data) { Object.assign(intents.get(id), data); return { ...intents.get(id) }; },
        async cancel(id) {
          if (offline) throw new Error('Provider temporarily unavailable');
          const pi = intents.get(id);
          if (succeedDuringCancel) { succeedDuringCancel = false; pi.status = 'succeeded'; pi.amount_received = pi.amount; throw new Error('Success won cancellation race'); }
          if (['succeeded', 'processing'].includes(pi.status)) throw new Error('Cannot cancel');
          pi.status = 'canceled'; return { ...pi };
        },
        async confirm(id, options) {
          const pi = intents.get(id); if (pi.status === 'canceled') throw new Error('Canceled intents cannot charge');
          if (options?.payment_method_data?.type === 'customer_balance') { pi.status = 'requires_action'; pi.next_action = { type: 'display_bank_transfer_instructions', display_bank_transfer_instructions: { amount_remaining: pi.amount, financial_addresses: [] } }; }
          else { pi.status = 'succeeded'; pi.amount_received = pi.amount; }
          return { ...pi };
        },
      },
    };
    stripe.stripe = provider;
    const factory = new PaymentIntentFactory(orders, stripe);
    let cleanup = new CheckoutReservationCleanupService(orders, stripe);
    const presence = new CheckoutPresenceController(orders, cart, cleanup, stripe);
    const bank = new BankTransferService(stripe, orders, factory);
    const recovery = new StripeWebhookRecoveryService(db);
    const webhook = new StripeWebhookController(stripe, orders, { isEnabled: () => false }, db, {}, {}, undefined, recovery);
    const check = name => { report.checks.push(name); console.log('[PASS]', name); };
    let counter = 0;
    async function fixture(kind = 'guest', quantity = 1, stockQty = quantity, sharedVariant) {
      const id = ++counter;
      const user = await db.user.create({ data: { email: `fixture-${id}@example.test`, password: 'not-a-login-credential' } });
      const owner = kind === 'guest' ? { anonymousId: randomUUID(), customerEmail: user.email } : { userId: user.id, customerEmail: user.email };
      const context = kind === 'guest' ? { anonymousId: owner.anonymousId } : { userId: user.id };
      const product = sharedVariant ? null : await db.product.create({ data: { name: `Fictitious ${id}`, slug: `fixture-${id}`, imageUrl: '/assets/logo_banner.png', price: 1000, variants: { create: { size: 'M', sku: `fixture-${id}`, stockQty } } }, include: { variants: true } });
      const variant = sharedVariant || product.variants[0];
      await cart.addItem(context, { variantId: variant.id, qty: quantity });
      const req = kind === 'guest' ? { cookies: { cartId: owner.anonymousId } } : { user: { id: user.id, email: user.email } };
      const f = { owner, context, req, variant, tabId: randomUUID() };
      f.readCart = () => cart.getCheckoutCartForRequest(req);
      f.stock = async () => (await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stockQty;
      f.enter = async (action = 'enter', tabId = f.tabId) => f.reservation = await presence.presence(req, { action, tabId });
      f.prepare = async () => {
        const body = { checkoutSnapshotId: f.reservation.checkoutSnapshotId, tabId: f.tabId, shippingMethod: 'STANDARD', guestEmail: owner.customerEmail,
          shippingAddress: { firstName: 'Fixture', lastName: 'Customer', line1: `Fictitious street ${id}`, city: 'Madrid', postalCode: '28001', country: 'España' } };
        f.dto = body;
        f.payment = await factory.createPaymentIntentForOwner(owner, body, await f.readCart());
        f.reservation = await f.enter('heartbeat'); f.dto.checkoutSnapshotId = f.reservation.checkoutSnapshotId;
        return f.payment;
      };
      f.start = () => presence.start(req, { tabId: f.tabId, checkoutSnapshotId: f.payment.metadata.checkoutSnapshotId, paymentIntentId: f.payment.paymentIntentId });
      f.row = () => db.checkoutSnapshot.findUniqueOrThrow({ where: { id: f.reservation.checkoutSnapshotId } });
      return f;
    }
    async function deliver(f, type = 'payment_intent.succeeded', eventId = 'evt_' + randomUUID()) {
      const event = { id: eventId, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { ...intents.get(f.payment.paymentIntentId) } } };
      const raw = JSON.stringify(event), signature = signatureApi.generateTestHeaderString({ payload: raw, secret: isolated.STRIPE_WEBHOOK_SECRET });
      return webhook.processEvent({ body: Buffer.from(raw) }, signature, '/webhooks/stripe');
    }
    for (const kind of ['guest', 'registered']) {
      const f = await fixture(kind);
      assert.equal(await f.stock(), 1); assert.equal(await db.checkoutSnapshot.count({ where: { cartId: (await f.readCart()).id } }), 0);
      await f.enter(); assert.equal(await f.stock(), 0);
      for (let i = 0; i < 8; i++) { advance(80_000); await f.enter('heartbeat'); }
      assert.equal((await f.row()).paymentStartedAt, null); assert.equal(await f.stock(), 0);
      const second = randomUUID(); await f.enter('enter', second); await f.enter('leave'); assert.equal(await f.stock(), 0);
      await assert.rejects(f.enter('heartbeat'), /EXPIRED/);
      await f.enter('leave', second); assert.equal(await f.stock(), 1); assert.equal((await f.readCart()).items.length, 1);
      check(`${kind}: cart holds nothing; presence >6min; two tabs; stale leave/heartbeat; explicit exit preserves cart`);
    }
    {
      const f = await fixture(); await f.enter(); advance(89_999); await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 0);
      advance(1); await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 1);
      await assert.rejects(f.enter('heartbeat'), /EXPIRED/); check('Unexpected disappearance: 90s lease, no browser required, heartbeat cannot recreate');
      await f.enter(); await f.enter('depart'); advance(14_999); await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 0);
      f.tabId = randomUUID(); await f.enter(); advance(2); await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 0);
      await f.enter('leave'); check('Pagehide uses 15s grace; reload joins without losing inventory');
    }
    {
      const f = await fixture(); await f.enter();
      await assert.rejects(factory.createPaymentIntentForOwner(f.owner, { checkoutSnapshotId: f.reservation.checkoutSnapshotId, tabId: f.tabId, shippingMethod: 'STANDARD' }, await f.readCart()), /ADDRESS_REQUIRED/);
      assert.equal((await f.row()).paymentStartedAt, null);
      await f.prepare(); assert.equal((await f.row()).paymentStartedAt, null);
      const first = await f.start(), deadline = first.expiresAt.getTime(); assert.equal(deadline - first.paymentStartedAt.getTime(), 360000);
      assert.equal(first.checkout.items[0].variant.product.imageUrl, '/assets/logo_banner.png');
      const other = randomUUID(); await f.enter('enter', other); await f.enter('leave'); advance(180000);
      await f.enter('heartbeat', other); const duplicate = await f.start(); assert.equal(duplicate.expiresAt.getTime(), deadline);
      intents.get(f.payment.paymentIntentId).status = 'requires_payment_method'; await f.prepare(); assert.equal((await f.row()).expiresAt.getTime(), deadline);
      advance(deadline - Date.now() - 1); await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 0);
      advance(1); await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 1);
      await assert.rejects(provider.paymentIntents.confirm(f.payment.paymentIntentId), /cannot charge/);
      await assert.rejects(f.enter('heartbeat', other)); await assert.rejects(f.enter());
      f.tabId = randomUUID(); await f.enter('restart'); assert.equal(await f.stock(), 0); await f.enter('leave');
      check('Validation/preparation do not start; protected bank/app exit; decline/retry/reload do not renew; 359999/360000ms cancel fence; explicit restart');
    }
    {
      const a = await fixture(), b = await fixture('registered', 1, 1, a.variant);
      const race = await Promise.allSettled([a.enter(), b.enter()]); assert.equal(race.filter(r => r.status === 'fulfilled').length, 1); assert.equal(await a.stock(), 0);
      const winner = race[0].status === 'fulfilled' ? a : b; await winner.enter('leave'); assert.equal(await a.stock(), 1);
      check('Two independent customers racing the final unit: one reservation, no negative stock');
    }
    {
      const f = await fixture('registered', 2, 3); await f.enter();
      advance(1); await cart.updateItem(f.context, (await f.readCart()).items[0].id, { qty: 1 }); await f.enter('heartbeat'); assert.equal(await f.stock(), 2);
      await f.prepare(); await f.start(); advance(1); await cart.updateItem(f.context, (await f.readCart()).items[0].id, { qty: 2 });
      await f.enter('heartbeat'); await f.prepare(); const snapshot = await db.checkoutSnapshot.findUniqueOrThrow({ where: { id: f.reservation.checkoutSnapshotId }, include: { items: true } }); assert.equal(snapshot.items[0].quantity, 1);
      await provider.paymentIntents.confirm(f.payment.paymentIntentId); await deliver(f);
      assert.equal(await f.stock(), 2); assert.equal((await f.readCart()).items[0].qty, 1);
      check('Mutable quantity refresh; protected snapshot freezes items; fulfillment does not deduct again or erase changed cart');
    }
    {
      const f = await fixture(); await f.enter(); await f.prepare(); const start = await f.start(); advance(start.expiresAt.getTime() - Date.now());
      succeedDuringCancel = true; await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 0);
      assert.equal(await db.order.count({ where: { providerRef: f.payment.paymentIntentId, status: 'PAID' } }), 1);
      const id = 'evt_duplicate_' + randomUUID(); await deliver(f, 'payment_intent.succeeded', id); await deliver(f, 'payment_intent.succeeded', id); await deliver(f); await deliver(f, 'payment_intent.payment_failed');
      assert.equal(await db.order.count({ where: { providerRef: f.payment.paymentIntentId } }), 1); assert.equal(await f.stock(), 0);
      check('Success wins expiration/cancel race; cleanup fulfills; signed duplicate/late/out-of-order webhooks produce one sale');
    }
    {
      const f = await fixture(); await f.enter(); await f.prepare(); const start = await f.start(); advance(start.expiresAt.getTime() - Date.now()); offline = true;
      await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 0); await assert.rejects(f.start());
      cleanup = new CheckoutReservationCleanupService(orders, stripe); offline = false; advance(5001);
      intents.get(f.payment.paymentIntentId).status = 'processing'; await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 0);
      intents.get(f.payment.paymentIntentId).status = 'succeeded'; intents.get(f.payment.paymentIntentId).amount_received = intents.get(f.payment.paymentIntentId).amount;
      await cleanup.reconcile(f.reservation.checkoutSnapshotId); assert.equal(await f.stock(), 0); assert.equal((await f.row()).status, 'ORDER_CREATED');
      check('Provider outage/processing retains stock; restart reconciles durable state without refund or deadline renewal');
    }
    {
      const f = await fixture(); await f.enter(); loseCreateReply = true;
      await assert.rejects(f.prepare(), /Connection lost/); const active = await orders.getActiveReservation(f.owner, (await f.readCart()).id);
      assert.equal(active.status, 'PAYMENT_INTENT_CREATING'); assert.ok(active.stripeCreateRequest);
      const before = intents.size; advance(90001); await cleanup.reconcile(active.id);
      assert.equal(intents.size, before); assert.equal(await f.stock(), 1);
      check('Crash after provider creation before binding: persisted idempotent request recovered and canceled, never released blindly');
    }
    {
      const f = await fixture(); await f.enter(); await f.prepare();
      const result = await bank.begin(f.owner, f.dto, await f.readCart(), 'fixture-bank');
      const snapshot = await f.row(); assert.ok(snapshot.paymentStartedAt); assert.equal(snapshot.expiresAt - snapshot.paymentStartedAt, 360000);
      assert.equal(result.paymentStatus, 'requires_action'); await f.enter('leave'); assert.equal(await f.stock(), 0);
      advance(360000); await cleanup.reconcile(snapshot.id); assert.equal(await f.stock(), 1);
      assert.equal((await db.order.findUniqueOrThrow({ where: { id: result.orderId } })).status, 'CANCELLED');
      check('Bank instructions share 360s protection, remain through exit, cancel before releasing and cannot charge later');
    }
    {
      const f = await fixture(); await f.enter();
      const original = f.reservation.checkoutSnapshotId, current = await f.readCart();
      advance(1);
      // Simulate an edit racing stock validation; the acquisition must roll back
      // the entire release, not expose the original unit to another buyer.
      await db.cart.update({ where: { id: current.id }, data: { updatedAt: new Date(), items: { update: { where: { id: current.items[0].id }, data: { qty: 2 } } } } });
      await assert.rejects(f.enter('heartbeat'));
      assert.equal(await f.stock(), 0);
      assert.equal((await db.checkoutSnapshot.findUniqueOrThrow({ where: { id: original } })).status, 'REPLACEMENT_PENDING');
      advance(1);
      await cart.updateItem(f.context, current.items[0].id, { qty: 1 });
      await f.enter('heartbeat'); assert.notEqual(f.reservation.checkoutSnapshotId, original); assert.equal(await f.stock(), 0);
      await f.enter('leave'); assert.equal(await f.stock(), 1);
      check('Failed quantity replacement rolls back release atomically; corrected cart retries without losing the original unit');
    }
    {
      const f = await fixture();
      await f.enter('leave'); await assert.rejects(f.enter()); assert.equal(await f.stock(), 1);
      f.tabId = randomUUID();
      await Promise.allSettled([f.enter(), f.enter('leave')]);
      const active = await orders.getActiveReservation(f.owner, (await f.readCart()).id);
      if (active) await cleanup.reconcile(active.id);
      assert.equal(await f.stock(), 1);
      check('Departure before initial response/arrival cannot create an orphan reservation');
    }
    {
      const f = await fixture(); await f.enter(); await f.prepare(); const protectedState = await f.start();
      const user = await db.user.findUniqueOrThrow({ where: { email: f.owner.customerEmail } });
      await cart.getOrCreateCart({ userId: user.id });
      await cart.mergeOnLogin(user.id, f.owner.anonymousId);
      const req = { user: { id: user.id, email: user.email } };
      const resumed = await presence.presence(req, { action: 'enter', tabId: randomUUID() });
      assert.equal(resumed.checkoutSnapshotId, protectedState.checkoutSnapshotId);
      assert.equal(resumed.expiresAt.getTime(), protectedState.expiresAt.getTime());
      assert.equal((await cart.getCheckoutCartForRequest(req)).items[0].qty, 1); assert.equal(await f.stock(), 0);
      advance(360001); await cleanup.reconcile(resumed.checkoutSnapshotId); assert.equal(await f.stock(), 1);
      check('Guest login into existing account cart preserves held quantity, snapshot and protected deadline');
    }
    {
      const f = await fixture(); await f.enter(); await f.prepare();
      const oldId = f.payment.paymentIntentId;
      await stripe.cancelCheckoutPaymentIntent(oldId, f.reservation.checkoutSnapshotId);
      await f.prepare(); assert.notEqual(f.payment.paymentIntentId, oldId); assert.equal(await f.stock(), 0);
      assert.equal((await f.row()).paymentStartedAt, null);
      const stranger = await fixture('registered');
      await assert.rejects(orders.startCheckoutPayment(stranger.owner, (await f.readCart()).id, f.reservation.checkoutSnapshotId, f.payment.paymentIntentId, f.tabId));
      await assert.rejects(orders.startCheckoutPayment(f.owner, (await f.readCart()).id, f.reservation.checkoutSnapshotId, oldId, f.tabId));
      assert.equal((await f.row()).paymentStartedAt, null);
      await f.enter('leave'); assert.equal(await f.stock(), 1);
      check('Canceled preparation recovers atomically; foreign owner and stale intent cannot start protection');
    }
    assert.equal(await db.productVariant.count({ where: { stockQty: { lt: 0 } } }), 0);
    check('Global invariant: inventory never negative'); report.passed = true;
  } finally {
    clock?.uninstall(); if (db) await db.$disconnect();
    if (created) { assert.match(name, /^cronox_reservation_test_[a-f0-9]{32}$/); await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); report.cleanedUp = true; }
    await control.end(); fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
}
run().catch(error => { console.error(String(error.stack).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
