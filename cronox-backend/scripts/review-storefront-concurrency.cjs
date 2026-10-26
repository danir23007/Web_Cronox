'use strict';
// Only invoked inside review-newsletter-registration.cjs's disposable database.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
module.exports = async ({ app, db, auth, origin, root }) => {
  assert.match((await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, /^cronox_newsletter_test_[a-f0-9]{32}$/);
  const report = { diagnostic: process.argv.includes('--diagnose'), loads: [], consistency: [], inventory: [] };
  const { ModulesContainer } = require('@nestjs/core');
  const { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } = require('@nestjs/common/constants');
  const { RequestMethod } = require('@nestjs/common');
  for (const module of app.get(ModulesContainer).values()) for (const wrapper of module.controllers.values()) {
    const type = wrapper.metatype; if (!type) continue;
    const base = Reflect.getMetadata(PATH_METADATA, type) || '';
    for (const name of Object.getOwnPropertyNames(type.prototype)) {
      const handler = type.prototype[name]; if (typeof handler !== 'function' || !Reflect.hasMetadata(METHOD_METADATA, handler)) continue;
      const route = ('/api/' + [base, Reflect.getMetadata(PATH_METADATA, handler)].filter(Boolean).join('/')).replace(/\/+/g, '/').replace(/\/$/, '');
      if (/\/admin(?:\/|$)/.test(route)) continue;
      const guards = [...(Reflect.getMetadata(GUARDS_METADATA, type) || []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) || [])].map(g => g.name);
      report.inventory.push({ route, method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)], guards,
        limit: Reflect.getMetadata('THROTTLER:LIMITdefault', handler) || Reflect.getMetadata('THROTTLER:LIMITdefault', type) || 100,
        ttl: Reflect.getMetadata('THROTTLER:TTLdefault', handler) || Reflect.getMetadata('THROTTLER:TTLdefault', type) || 60000,
        skipped: Boolean(Reflect.getMetadata('THROTTLER:SKIPdefault', handler) || Reflect.getMetadata('THROTTLER:SKIPdefault', type)) });
    }
  }
  const { CartService } = require('../src/cart/cart.service');
  const { FavoritesService } = require('../src/favorites/favorites.service');
  const carts = app.get(CartService), favorites = app.get(FavoritesService);
  const csrfResponse = await fetch(origin + '/api/auth/csrf');
  const csrf = (await csrfResponse.json()).csrfToken;
  const send = async (route, { method = 'GET', body, token, network = '198.51.100.10', key } = {}) => {
    const start = performance.now();
    const res = await fetch(origin + '/api/' + route, { method, headers: {
      origin, cookie: `cronox_csrf_token=${csrf}`, 'x-csrf-token': csrf, 'x-real-ip': network,
      ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => null);
    return { status: res.status, ms: Math.round(performance.now() - start), retryAfter: res.headers.get('retry-after'), data };
  };
  const summarize = (name, responses, extras = {}) => {
    const times = responses.map(r => r.ms).sort((a,b) => a-b);
    const statuses = {}; for (const r of responses) statuses[r.status] = (statuses[r.status] || 0) + 1;
    report.loads.push({ name, count: responses.length, statuses, p50: times[Math.floor(times.length * .5)], p95: times[Math.min(times.length - 1, Math.floor(times.length * .95))], ...extras });
  };
  await db.accreditationDesign.create({ data: { id: 'metacrilatos', name: 'Fixture', renderer: 'metacrilatos-v1', config: { version: 1 } } });
  await db.accreditationSelection.create({ data: { id: 'global', activeDesignId: 'metacrilatos' } });
  for (const size of [5, 20, 50, 100]) {
    for (const shared of [true, false]) {
      // Distinct subjects per case; shared quotas stay active throughout.
      const result = await Promise.all(Array.from({ length: size }, (_, i) => send('newsletter/start-registration', {
        method: 'POST', body: { email: `load-${size}-${shared}-${i}@newsletter.test` }, network: shared ? '198.51.100.10' : `198.51.100.${i + 1}`,
      })));
      summarize('newsletter-start', result, { sharedNetwork: shared });
      if (!report.diagnostic) assert.ok(result.every(r => r.status === 200), JSON.stringify(report.loads.at(-1)));
    }
  }
  const user = await db.user.create({ data: { email: 'concurrency-owner@newsletter.test', firstName: 'Prueba' } });
  const tokens = await auth.generateTokens(user);
  const product = await db.product.create({ data: { name: 'Concurrency fixture', slug: 'concurrency-fixture', price: 1000, variants: { create: { size: 'M', sku: 'CONCURRENCY-FIXTURE', stockQty: 1000 } } }, include: { variants: true } });
  const variantId = product.variants[0].id;
  const context = { userId: user.id };
  const cart = await carts.getOrCreateCart(context);
  for (const size of [5, 20, 50, 100]) {
    await carts.clearCart(context);
    const results = await Promise.allSettled(Array.from({ length: size }, () => carts.addItem(context, { variantId, qty: 1 })));
    const saved = await db.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId } } });
    const check = { name: 'same-cart-concurrent-adds', size, success: results.filter(r => r.status === 'fulfilled').length, failures: results.filter(r => r.status === 'rejected').map(r => r.reason.code || r.reason.message), qty: saved?.qty };
    report.consistency.push(check);
    if (!report.diagnostic) assert.equal(saved?.qty, size, JSON.stringify(check));
  }
  await carts.clearCart(context);
  const repeated = await Promise.all(Array.from({ length: 2 }, () => send('cart/items', { method: 'POST', body: { variantId, qty: 1 }, token: tokens.accessToken, key: 'review-one-intent' })));
  const saved = await db.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId } } });
  report.consistency.push({ name: 'same-add-idempotency-key', statuses: repeated.map(r => r.status), qty: saved?.qty });
  if (!report.diagnostic) assert.equal(saved.qty, 1);
  for (const size of [5, 20, 50, 100]) {
    await db.favorite.deleteMany({ where: { userId: user.id } });
    const results = await Promise.allSettled(Array.from({ length: size }, () => favorites.toggle(user.id, { productId: product.id })));
    const count = await db.favorite.count({ where: { userId: user.id, productId: product.id } });
    const check = { name: 'favorite-toggle-concurrency', size, success: results.filter(r => r.status === 'fulfilled').length, count, expectedCount: size % 2 };
    report.consistency.push(check);
    if (!report.diagnostic) { assert.equal(check.success, size); assert.equal(count, size % 2); }
  }
  if (!report.diagnostic) {
    // A fresh pair of storage objects must share a single atomic quota.
    const { SharedThrottlerStorage } = require('../src/common/guards/shared-throttler.storage');
    const a = new SharedThrottlerStorage(db), b = new SharedThrottlerStorage(db);
    const hits = await Promise.all(Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).increment('review-shared-counter', 60000, 50, 60000, 'default')));
    assert.equal(hits.filter(h => !h.isBlocked).length, 50);
    a.onApplicationShutdown();
    assert.equal((await b.increment('review-shared-counter', 60000, 50, 60000, 'default')).isBlocked, true);
    await db.$executeRaw`UPDATE "RequestRateWindow" SET "resetsAt" = now() - interval '1 second', "blockedUntil" = now() - interval '1 second' WHERE key = 'review-shared-counter'`;
    assert.equal((await a.increment('review-shared-counter', 60000, 50, 60000, 'default')).totalHits, 1);
    report.consistency.push({ name: 'two-storage-instances', requests: 100, accepted: 50, blocked: 50, restartRetainsQuota: true, expiredWindowResets: true });

    const limited = await Promise.all(Array.from({ length: 6 }, () => send('newsletter/start-registration', { method: 'POST', network: '203.0.113.200', body: { email: 'quota@newsletter.test' } })));
    assert.equal(limited.filter(r => r.status === 200).length, 5);
    const blocked = limited.find(r => r.status === 429);
    assert.ok(Number(blocked.retryAfter) > 0); assert.equal(blocked.data.code, 'RATE_LIMITED');
    assert.equal((await send('newsletter/start-registration', { method: 'POST', network: '203.0.113.200', body: { email: 'unrelated@newsletter.test' } })).status, 200);
    assert.equal(await db.user.count({ where: { email: 'quota@newsletter.test' } }), 0);
    assert.equal(await db.newsletterSubscription.count({ where: { email: 'quota@newsletter.test' } }), 0);
    report.consistency.push({ name: 'email-quota-isolation-abandonment', allowed: 5, blocked: 1, otherEmailAllowed: true, noAccountOrSubscription: true, retryAfter: blocked.retryAfter });

    const password = 'Synthetic-Only-563!';
    const registrations = await Promise.all(Array.from({ length: 5 }, (_, i) => send('auth/register', { method: 'POST', network: '203.0.113.90', body: { email: `registered-${i}@newsletter.test`, firstName: 'Prueba', password, registrationSource: 'newsletter' } })));
    summarize('five-full-newsletter-registrations', registrations, { sharedNetwork: true });
    assert.ok(registrations.every(r => r.status === 201), JSON.stringify(registrations.map(r => [r.status, r.data])));
    const people = await db.user.findMany({ where: { email: { startsWith: 'registered-' } }, orderBy: { email: 'asc' } });
    assert.equal(people.length, 5);
    for (const person of people) {
      assert.equal(await db.newsletterSubscription.count({ where: { userId: person.id, subscribedAt: { not: null } } }), 1);
      assert.equal(await db.newsletterMailJob.count({ where: { email: person.email, kind: 'WELCOME' } }), 1);
    }
    const logins = await Promise.all(people.map(person => send('auth/login', { method: 'POST', network: '203.0.113.90', body: { email: person.email, password } })));
    summarize('five-logins', logins, { sharedNetwork: true }); assert.ok(logins.every(r => r.status === 200), JSON.stringify(logins));
    const duplicateBody = { email: 'concurrent-register@newsletter.test', firstName: 'Prueba', password, registrationSource: 'newsletter' };
    const duplicates = await Promise.all(Array.from({ length: 5 }, () => send('auth/register', { method: 'POST', body: duplicateBody })));
    assert.equal(duplicates.filter(r => r.status === 201).length, 1);
    assert.ok(duplicates.every(r => [201, 409].includes(r.status)));
    assert.equal(await db.user.count({ where: { email: duplicateBody.email } }), 1);
    assert.equal(await db.newsletterSubscription.count({ where: { email: duplicateBody.email } }), 1);
    assert.equal(await db.newsletterMailJob.count({ where: { email: duplicateBody.email, kind: 'WELCOME' } }), 1);
    report.consistency.push({ name: 'duplicate-registration', requests: 5, users: 1, subscriptions: 1, welcomes: 1, statuses: duplicates.map(r => r.status) });

    const access = await Promise.all(people.map(p => auth.generateTokens(p)));
    for (const size of [5, 20, 50, 100]) for (const shared of [true, false]) {
      const reads = ['products?limit=5', 'products/suggestions?search=Concurrency', 'products/concurrency-fixture', 'categories', 'cart', 'favorites', 'me', 'me/orders', 'accreditations/active', 'shipping-methods', 'analytics/config'];
      const navigation = await Promise.all(Array.from({ length: size }, (_, i) => send(reads[i % reads.length], { token: access[i % 5].accessToken, network: shared ? '203.0.113.30' : `203.0.113.${i + 1}` })));
      summarize('mixed-navigation-five-accounts', navigation, { sharedNetwork: shared });
      assert.ok(navigation.every(r => r.status === 200), JSON.stringify(navigation.filter(r => r.status !== 200)));
      const presence = await Promise.all(Array.from({ length: size }, (_, i) => send('live-stats/presence', { method: 'POST', token: access[i % 5].accessToken, network: shared ? '203.0.113.30' : `203.0.113.${i + 1}`, body: { section: 'store', enabled: true } })));
      summarize('presence-five-accounts', presence, { sharedNetwork: shared });
      assert.ok(presence.every(r => r.status === 204));
      const writes = await Promise.all(Array.from({ length: size }, (_, i) => send('cart/items', { method: 'POST', token: access[i % 5].accessToken, key: `intent-${size}-${shared}-${i}`, body: { variantId, qty: 1 }, network: shared ? '203.0.113.30' : `203.0.113.${i + 1}` })));
      summarize('cart-writes-five-accounts', writes, { sharedNetwork: shared }); assert.ok(writes.every(r => r.status === 201), JSON.stringify(writes.filter(r => r.status !== 201)));
      for (let i = 0; i < 5; i++) {
        const current = await carts.getOrCreateCart({ userId: people[i].id });
        assert.equal(current.items[0].qty, size / 5);
        await carts.clearCart({ userId: people[i].id });
      }
    }
    const mismatch = await send('cart/items', { method: 'POST', token: tokens.accessToken, key: 'review-one-intent', body: { variantId, qty: 2 } });
    assert.equal(mismatch.status, 409);
    const quantity = await Promise.all([2, 3].map(qty => send(`cart/items/${saved.id}`, { method: 'PATCH', token: tokens.accessToken, key: `expected-quantity-${qty}`, body: { qty, expectedQty: 1 } })));
    assert.deepEqual(quantity.map(r => r.status).sort(), [200, 409]);
    const guest = { anonymousId: require('node:crypto').randomUUID() };
    await carts.addItem(guest, { variantId, qty: 1 }, 'guest-before-login');
    const beforeMerge = (await carts.getOrCreateCart(context)).items[0].qty;
    await Promise.all([carts.mergeOnLogin(user.id, guest.anonymousId), carts.mergeOnLogin(user.id, guest.anonymousId)]);
    assert.equal((await carts.getOrCreateCart(context)).items[0].qty, beforeMerge + 1);
    await carts.addItem(context, { variantId, qty: 1 }, 'guest-before-login');
    assert.equal((await carts.getOrCreateCart(context)).items[0].qty, beforeMerge + 1);
    report.consistency.push({ name: 'cart-conflicts-and-merge', reusedKeyDifferentBody: 409, staleQuantity: 409, duplicateMergeAddsOnce: true, guestRetryAfterLoginAddsOnce: true });

    await require('./review-security-checkout.cjs')({ db });
    report.consistency.push({ name: 'checkout-real-postgres', lastUnitBuyers: 2, duplicatePaymentEvents: 2, orders: 1, stockDeductedOnce: true, refundReordering: true, ownershipAndPromotions: true, provider: 'simulated' });
    // An added quantity after reservation must survive payment of the frozen cart.
    const { OrdersService } = require('../src/orders/orders.service'); const orders = app.get(OrdersService);
    const owner = people[0]; const ownerContext = { userId: owner.id };
    await carts.addItem(ownerContext, { variantId, qty: 1 });
    const checkout = await orders.createCheckoutSnapshot(owner.id, { shippingMethod: 'STANDARD', shippingAddress: { firstName: 'Prueba', lastName: 'Local', line1: 'Test 1', city: 'Madrid', postalCode: '28001', country: 'ES' } });
    await carts.addItem(ownerContext, { variantId, qty: 2 });
    await orders.claimCheckoutPaymentIntentCreation(checkout.checkoutSnapshotId);
    await orders.bindStripePaymentIntent(checkout.checkoutSnapshotId, 'pi_changed_cart', 'acct_isolated_audit');
    const payment = { checkoutSnapshotId: checkout.checkoutSnapshotId, paymentIntentId: 'pi_changed_cart', amountCents: checkout.amountCents, currency: 'EUR', occurredAt: new Date() };
    const fulfilled = await Promise.all(Array.from({ length: 5 }, () => orders.createOrderFromVerifiedStripePayment(payment)));
    assert.equal(new Set(fulfilled.map(r => r.orderId)).size, 1);
    assert.equal((await carts.getOrCreateCart(ownerContext)).items[0].qty, 2);
    report.consistency.push({ name: 'cart-edited-during-checkout', paymentNotifications: 5, orders: 1, unpaidQuantityPreserved: 2 });
    const recovery = new (require('../src/payments/stripe-webhook-recovery.service').StripeWebhookRecoveryService)(db);
    let failAfterCommit = true;
    recovery.register(async () => {
      const result = await orders.createOrderFromVerifiedStripePayment(payment);
      if (failAfterCommit) { failAfterCommit = false; throw new Error('Synthetic interruption after durable order'); }
      return result;
    }, async () => 'not_needed');
    await assert.rejects(() => recovery.accept({ id: 'evt_after_commit', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000), data: { object: {} } }, { paymentIntentId: payment.paymentIntentId }));
    assert.equal((await db.stripeWebhookEvent.findUnique({ where: { id: 'evt_after_commit' } })).status, 'FAILED');
    await db.stripeWebhookEvent.update({ where: { id: 'evt_after_commit' }, data: { nextAttemptAt: new Date(0) } });
    await recovery.process('evt_after_commit');
    assert.equal((await db.stripeWebhookEvent.findUnique({ where: { id: 'evt_after_commit' } })).status, 'PROCESSED');
    assert.equal(await db.order.count({ where: { id: fulfilled[0].orderId, status: 'PAID' } }), 1);
    assert.equal((await carts.getOrCreateCart(ownerContext)).items[0].qty, 2);
    report.consistency.push({ name: 'failure-after-order-commit', recovered: true, duplicateOrder: false, refundedByRecovery: false, stockAndCartUnchanged: true });

    const forgot = await Promise.all(people.map(person => send('auth/forgot-password', { method: 'POST', network: '203.0.113.90', body: { email: person.email } })));
    summarize('five-password-recovery-requests-no-smtp', forgot); assert.ok(forgot.every(r => r.status === 201));
    const profiles = await Promise.all(people.map((person, i) => send('me', { method: 'PUT', token: access[i].accessToken, body: { firstName: 'Revisado' } })));
    summarize('five-profile-writes', profiles); assert.ok(profiles.every(r => r.status === 200));
    const addresses = await Promise.all(people.map((person, i) => send('me/addresses', { method: 'POST', token: access[i].accessToken, body: { name: 'Prueba Local', line1: 'Test 1', city: 'Madrid', zip: '28001', country: 'ES', isDefault: true } })));
    summarize('five-address-writes', addresses); assert.ok(addresses.every(r => r.status === 201), JSON.stringify(addresses));
    for (const person of people) assert.equal(await db.address.count({ where: { userId: person.id, isDefault: true } }), 1);
    const addressBurst = await Promise.all(Array.from({ length: 20 }, (_, i) => send('me/addresses', { method: 'POST', token: access[0].accessToken,
      body: { name: `Fixture ${i}`, line1: 'Test 1', city: 'Madrid', zip: '28001', country: 'ES', isDefault: true } })));
    summarize('twenty-address-creates-one-account-limit-ten', addressBurst);
    assert.equal(addressBurst.filter(r => r.status === 201).length, 9);
    assert.equal(addressBurst.filter(r => r.status === 400).length, 11);
    assert.equal(await db.address.count({ where: { userId: people[0].id } }), 10);
    assert.equal(await db.address.count({ where: { userId: people[0].id, isDefault: true } }), 1);
    const defaults = await Promise.all(Array.from({ length: 5 }, () => send('me/address', { method: 'PUT', token: access[0].accessToken,
      body: { name: 'Fixture Default', line1: 'Test 2', city: 'Madrid', zip: '28001', country: 'ES' } })));
    assert.ok(defaults.every(r => r.status === 200), JSON.stringify(defaults));
    assert.equal(await db.address.count({ where: { userId: people[0].id, isDefault: true } }), 1);
    report.consistency.push({ name: 'address-limit-default', concurrentCreates: 20, accepted: 9, rejectedAtLimit: 11, addresses: 10, defaults: 1, concurrentLegacyUpserts: 5 });
    const outOfStock = await db.productVariant.create({ data: { productId: product.id, size: 'L', sku: 'AUDIT-RESTOCK', stockQty: 0 } });
    const restock = await Promise.all(Array.from({ length: 20 }, () => send(`waitlist/${outOfStock.id}`, { method: 'POST', token: access[0].accessToken })));
    summarize('twenty-repeated-restock-joins', restock); assert.ok(restock.every(r => r.status === 201));
    assert.equal(await db.restockRequest.count({ where: { userId: people[0].id, variantId: outOfStock.id } }), 1);
    const beforeMixed = await Promise.all(people.map(p => carts.getOrCreateCart({ userId: p.id })));
    const mixed = await Promise.all(Array.from({ length: 100 }, (_, i) => {
      const token = access[Math.floor(i / 4) % 5].accessToken;
      if (i % 4 === 0) return send('products', { token });
      if (i % 4 === 1) return send('live-stats/presence', { method: 'POST', token, body: { section: 'cart' } });
      if (i % 4 === 2) return send('cart/items', { method: 'POST', token, key: `mixed-intent-${i}`, body: { variantId, qty: 1 } });
      return send('checkout/summary?shippingMethod=STANDARD', { token });
    }));
    summarize('simultaneous-navigation-presence-cart-checkout-summary', mixed);
    assert.ok(mixed.every(r => [200, 201, 204].includes(r.status)), JSON.stringify(mixed.filter(r => r.status >= 400)));
    for (let i = 0; i < people.length; i++) {
      const current = await carts.getOrCreateCart({ userId: people[i].id });
      assert.equal(current.itemsCount, beforeMixed[i].itemsCount + 5);
    }
    const purchases = await Promise.allSettled(people.map(async (person, i) => {
      const snapshot = await orders.createCheckoutSnapshot(person.id, { shippingMethod: 'STANDARD', shippingAddress: { firstName: 'Prueba', lastName: 'Local', line1: 'Test 1', city: 'Madrid', postalCode: '28001', country: 'ES' } });
      await orders.claimCheckoutPaymentIntentCreation(snapshot.checkoutSnapshotId);
      await orders.bindStripePaymentIntent(snapshot.checkoutSnapshotId, `pi_parallel_buyer_${i}`, 'acct_isolated_audit');
      return orders.createOrderFromVerifiedStripePayment({ checkoutSnapshotId: snapshot.checkoutSnapshotId, paymentIntentId: `pi_parallel_buyer_${i}`, amountCents: snapshot.amountCents, currency: 'EUR', occurredAt: new Date() });
    }));
    assert.equal(purchases.filter(r => r.status === 'fulfilled').length, 5, JSON.stringify(purchases.map(r => r.status === 'rejected' ? r.reason.message : 'paid')));
    assert.equal(new Set(purchases.map(r => r.value.orderId)).size, 5);
    report.consistency.push({ name: 'five-parallel-buyers', completed: 5, separateOrders: 5, provider: 'simulated-no-charge' });
  }
  const output = path.join(root, 'output/concurrency-review'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, report.diagnostic ? 'diagnostic.json' : 'after.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
};
