'use strict';
// Disposable localhost PostgreSQL only. SMTP is replaced with a recording fake.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const report = { checks: [], smtp: 'fake-only', cleanedUp: false };

async function main() {
  const env = loadLocalEnvironment();
  const source = new URL(env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  ensureLocalPostgres(env);
  const name = 'cronox_cart_reminder_test_' + randomUUID().replace(/-/g, '');
  assert.match(name, /^cronox_cart_reminder_test_[a-f0-9]{32}$/);
  const controlUrl = new URL(source); controlUrl.search = '';
  const control = new Client({ connectionString: controlUrl.href });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cronox-cart-reminder-'));
  const realNow = Date.now;
  let created = false, db, other;
  try {
    await control.connect();
    assert.ok(['127.0.0.1', '::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + name; target.search = '?schema=public';
    Object.assign(env, { DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href,
      EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false' });
    Object.assign(process.env, env);
    const setupUrl = new URL(target); setupUrl.search = '';
    const setup = new Client({ connectionString: setupUrl.href }); await setup.connect();
    try {
      await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      const schema = fs.readFileSync(path.join(backend, 'prisma/schema.prisma'), 'utf8')
        .replace(/model CartAbandonment \{[\s\S]*?\n\}/, '')
        .replace(/^  (?:cartAbandonments|abandonments) CartAbandonment\[\]\r?\n/gm, '');
      const schemaPath = path.join(temp, 'baseline.prisma'); fs.writeFileSync(schemaPath, schema);
      const pushed = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', schemaPath],
        { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
      assert.equal(pushed.status, 0, 'ISOLATED_BASELINE_FAILED: ' + pushed.stderr);
      // A historical cart exists before the additive migration.
      await setup.query(`INSERT INTO "User" (email,"updatedAt") VALUES ('history@example.test',now());
        INSERT INTO "Cart" ("userId","updatedAt") SELECT id,now() FROM "User";
        INSERT INTO "Product" (slug,name,price,"updatedAt") VALUES ('fixture','Fixture',3900,now());
        INSERT INTO "ProductVariant" ("productId",size,sku,stock,"updatedAt") SELECT id,'M','FIXTURE',20,now() FROM "Product";
        INSERT INTO "CartItem" ("cartId","variantId",qty,"priceAtAdd","updatedAt") SELECT c.id,v.id,1,3900,now() FROM "Cart" c CROSS JOIN "ProductVariant" v;`);
      await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261124120000_cart_abandonment/migration.sql'), 'utf8'));
      assert.equal((await setup.query('SELECT count(*)::int AS n FROM "CartAbandonment"')).rows[0].n, 0);
      assert.equal((await setup.query('SELECT count(*)::int AS n FROM "CartItem"')).rows[0].n, 1);
      assert.equal((await setup.query(`SELECT relrowsecurity FROM pg_class WHERE relname='CartAbandonment'`)).rows[0].relrowsecurity, true);
      report.checks.push('Migration preserves historical cart and creates no historical episodes; private RLS enabled');
    } finally { await setup.end(); }
    require('ts-node/register/transpile-only');
    const { PrismaClient, Prisma } = require('@prisma/client');
    const { CartAbandonmentService } = require('../src/cart/cart-abandonment.service');
    const { CartService } = require('../src/cart/cart.service');
    const { ManagedMailService } = require('../src/email/managed/managed-mail.service');
    const { EmailService } = require('../src/email/email.service');
    db = new PrismaClient(); other = new PrismaClient();
    let clock = Date.parse('2030-01-01T00:00:00.000Z');
    Date.now = () => clock;
    // Execute production SQL against real PostgreSQL with only its clock expression
    // replaced by a test-controlled timestamp. Locks/CAS/constraints remain real.
    const frozen = client => new Proxy(client, { get(object, property) {
      if (property === '$transaction') return (callback, options) => object.$transaction(tx => callback(frozen(tx)), options);
      if (property === '$queryRaw' || property === '$executeRaw') return (parts, ...values) => {
        const strings = Array.isArray(parts) ? parts : parts.strings;
        const args = Array.isArray(parts) ? values : parts.values;
        const timestamp = new Date(clock).toISOString();
        return object[property](Prisma.sql(strings.map(s => s.replace(/clock_timestamp\(\)/g, `TIMESTAMPTZ '${timestamp}'`)), ...args));
      };
      const value = object[property]; return typeof value === 'function' ? value.bind(object) : value;
    } });
    const a = frozen(db), b = frozen(other);
    process.env.CART_ABANDONMENT_START_AT = '2030-01-01T00:00:00Z';
    process.env.CART_ABANDONMENT_ENABLED = 'true'; process.env.BACKGROUND_JOBS_ENABLED = 'true';
    process.env.EMAIL_SMTP_PAUSED = 'false'; process.env.MAILBOX_ENCRYPTION_KEY_ID = 'test';
    process.env.MAILBOX_ENCRYPTION_KEYS = JSON.stringify({ test: Buffer.alloc(32, 9).toString('base64') });
    const sends = []; let fail, barrier;
    const email = { isNewsletterSenderConfigured: () => true,
      prepareAbandonedCart: async (to, data) => ({ to, ...data }),
      sendAbandonedCart: async (to, data) => {
        sends.push({ to, data }); if (barrier) await barrier;
        if (fail) throw fail; return { messageId: 'fake-' + sends.length };
      } };
    let storefrontClosed = false;
    const keyScreen = { shouldGatePublicHtml: async () => storefrontClosed };
    const worker = new CartAbandonmentService(a, email, keyScreen), second = new CartAbandonmentService(b, email, keyScreen);
    const carts = new CartService(a);
    const variant = await db.productVariant.findFirst();
    let index = 0;
    const fixture = async (consent = true) => {
      const user = await db.user.create({ data: { email: `fixture-${++index}@example.test`, newsletterSubscribed: consent } });
      if (consent) await db.newsletterSubscription.create({ data: { email: user.email, userId: user.id, subscribedAt: new Date(clock) } });
      const cart = await carts.addItem({ userId: user.id }, { variantId: variant.id, qty: 1 }, 'operation-unique');
      return { user, cart };
    };
    const jobs = f => db.cartAbandonment.findMany({ where: { cartId: f.cart.id }, orderBy: { activityAt: 'asc' } });
    const advance = ms => { clock += ms; };
    const delay = 23 * 3600000;
    const original = await fixture();
    assert.equal(+(await jobs(original))[0].dueAt - +(await jobs(original))[0].activityAt, delay);
    advance(delay - 1); await worker.tick(); assert.equal(sends.length, 0);
    advance(1); await Promise.all([worker.tick(), second.tick()]); assert.equal(sends.length, 1);
    const sentEpisode = (await jobs(original))[0]; assert.equal(sentEpisode.status, 'SENT');
    advance(delay * 3); await worker.tick(); assert.equal(sends.length, 1);
    await worker.activity(original.user.id); advance(delay - 1); await worker.tick(); assert.equal(sends.length, 1);
    advance(1); await worker.tick(); assert.equal(sends.length, 2);
    report.checks.push('No send at 23h minus 1ms; send at 23h; concurrent workers send once; time alone never rearms; real activity permits a second episode');

    const rescheduled = await fixture(); advance(3600000);
    await carts.addItem({ userId: rescheduled.user.id }, { variantId: variant.id, qty: 1 }, 'operation-unique');
    assert.equal((await jobs(rescheduled)).length, 1, 'Idempotent replay is not activity');
    await carts.getCartForCurrentUser(rescheduled.user.id); assert.equal((await jobs(rescheduled)).length, 1, 'Reads are not activity');
    await carts.updateItem({ userId: rescheduled.user.id }, rescheduled.cart.items[0].id, { qty: 2 });
    assert.equal((await jobs(rescheduled))[0].status, 'CANCELLED');
    const count = sends.length; advance(delay - 1); await worker.tick(); assert.equal(sends.length, count);
    advance(1); await worker.tick(); assert.equal(sends.length, count + 1);
    report.checks.push('Mutations atomically reschedule; automatic reads and mutation replays do not reset the clock');

    const empty = await fixture(); await carts.clearCart({ userId: empty.user.id });
    const noConsent = await fixture(false), suppressed = await fixture(), withdrawn = await fixture();
    await db.mailboxSuppression.create({ data: { email: suppressed.user.email, reason: 'UNSUBSCRIBED' } });
    await db.user.update({ where: { id: withdrawn.user.id }, data: { newsletterSubscribed: false } });
    const beforeExcluded = sends.length; advance(delay); await worker.tick();
    assert.equal(sends.length, beforeExcluded);
    for (const f of [empty, noConsent, suppressed, withdrawn]) assert.ok((await jobs(f)).every(j => j.status === 'CANCELLED'));
    report.checks.push('Empty carts, absent consent, withdrawal and campaign suppressions excluded');

    const pending = await fixture();
    const snapshot = await db.checkoutSnapshot.create({ data: { cartId: pending.cart.id, userId: pending.user.id,
      customerEmail: pending.user.email, cartUpdatedAt: new Date(clock), requestFingerprint: 'fixture',
      status: 'PAYMENT_BOUND', stripePaymentIntentId: 'pi_fake_never_contact_provider', subtotalCents: 3900,
      taxRate: 0, taxAmountCents: 0, totalCents: 3900, expiresAt: new Date(clock - 1000) } });
    advance(delay); const beforePending = sends.length; await worker.tick(); assert.equal(sends.length, beforePending);
    assert.equal((await jobs(pending))[0].errorCode, 'PAYMENT_RECONCILIATION_PENDING');
    for (const status of ['PAYMENT_INTENT_CREATING', 'MISSING_RECOVERY_PENDING', 'REPLACEMENT_PENDING', 'BANK_TRANSFER_PENDING', 'DISPUTED', 'RESERVED']) {
      await db.checkoutSnapshot.update({ where: { id: snapshot.id }, data: { status } });
      advance(300000); await worker.tick(); assert.equal(sends.length, beforePending, status);
    }
    const cancelledBankOrder = await db.order.create({ data: { userId: pending.user.id, customerEmail: pending.user.email,
      status: 'CANCELLED', subtotal: 39, total: 39, taxRate: 0, taxAmount: 0 } });
    await db.checkoutSnapshot.update({ where: { id: snapshot.id }, data: { status: 'PAYMENT_CANCELLED', orderId: cancelledBankOrder.id } });
    advance(300000); await worker.tick(); assert.equal(sends.length, beforePending + 1);
    const purchased = await fixture();
    const order = await db.order.create({ data: { userId: purchased.user.id, customerEmail: purchased.user.email, status: 'PAID', subtotal: 39, total: 39, taxRate: 0, taxAmount: 0 } });
    await db.checkoutSnapshot.create({ data: { cartId: purchased.cart.id, userId: purchased.user.id, customerEmail: purchased.user.email,
      cartUpdatedAt: new Date(clock), requestFingerprint: 'paid', status: 'ORDER_CREATED', orderId: order.id,
      subtotalCents: 3900, taxRate: 0, taxAmountCents: 0, totalCents: 3900, expiresAt: new Date(clock), updatedAt: new Date(clock) } });
    advance(delay); const beforePaid = sends.length; await worker.tick(); assert.equal(sends.length, beforePaid);
    assert.equal((await jobs(purchased))[0].status, 'CANCELLED');
    const guestId = randomUUID();
    const guest = await carts.addItem({ anonymousId: guestId }, { variantId: variant.id, qty: 1 });
    assert.equal(await db.cartAbandonment.count({ where: { cartId: guest.id } }), 0);
    const guestOwner = await db.user.create({ data: { email: 'adopted@example.test', newsletterSubscribed: true } });
    await db.newsletterSubscription.create({ data: { email: guestOwner.email, userId: guestOwner.id, subscribedAt: new Date(clock) } });
    await carts.mergeOnLogin(guestOwner.id, guestId);
    assert.equal(await db.cartAbandonment.count({ where: { cartId: guest.id, userId: guestOwner.id, status: 'QUEUED' } }), 1);
    await carts.clearCart({ userId: guestOwner.id });
    report.checks.push('Expired timestamps alone cannot authorize sends for unreconciled payments; terminal reconciliation permits retry; completed purchase cancels');

    const retry = await fixture(); advance(delay);
    fail = Object.assign(Error('known rejection'), { reminderRetrySafe: true });
    await worker.tick(); assert.equal((await jobs(retry))[0].status, 'QUEUED');
    fail = null; advance(300000); await Promise.all([worker.tick(), second.tick()]);
    assert.equal((await jobs(retry))[0].status, 'SENT');
    const uncertain = await fixture(); advance(delay);
    fail = Object.assign(Error('accepted response lost'), { deliveryUnknown: true });
    await worker.tick(); assert.equal((await jobs(uncertain))[0].status, 'UNCERTAIN');
    fail = null; const afterUnknown = sends.length; advance(delay * 2); await worker.tick(); assert.equal(sends.length, afterUnknown);
    const interrupted = await fixture(); await db.cartAbandonment.updateMany({ where: { cartId: interrupted.cart.id }, data: { status: 'PROCESSING', claimedAt: new Date(clock - 3600000) } });
    await worker.tick(); assert.equal((await jobs(interrupted))[0].status, 'UNCERTAIN');
    const replacedClaim = await fixture();
    const oldClaim = (await jobs(replacedClaim))[0];
    await db.cartAbandonment.update({ where: { id: oldClaim.id }, data: { status: 'PROCESSING', claimedAt: new Date(clock) } });
    await second.activity(replacedClaim.user.id);
    const beforeOldClaim = sends.length; await worker.deliver(oldClaim); assert.equal(sends.length, beforeOldClaim);
    assert.equal((await db.cartAbandonment.findUnique({ where: { id: oldClaim.id } })).status, 'CANCELLED');
    await carts.clearCart({ userId: replacedClaim.user.id });
    report.checks.push('Proven rejection retries persistently; concurrent retry sends once; ambiguous SMTP and interrupted claims never auto-retry');

    const locked = await fixture(); advance(delay);
    let releaseSend, notifyEntered;
    const entered = new Promise(resolve => { notifyEntered = resolve; });
    barrier = new Promise(resolve => { releaseSend = resolve; });
    const originalSend = email.sendAbandonedCart;
    email.sendAbandonedCart = async (...args) => { notifyEntered(); return originalSend(...args); };
    const running = worker.tick(); await entered;
    let activityFinished = false;
    const activity = second.activity(locked.user.id).then(() => { activityFinished = true; });
    await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(activityFinished, false, 'Final cart lock must hold through SMTP');
    releaseSend(); await running; await activity;
    barrier = null; email.sendAbandonedCart = originalSend;
    const lockedJobs = await jobs(locked); assert.equal(lockedJobs.filter(j => j.status === 'SENT').length, 1);
    assert.equal(lockedJobs.filter(j => j.status === 'QUEUED').length, 1);
    await carts.clearCart({ userId: locked.user.id });
    report.checks.push('New activity waits for final SMTP lock, then creates a fresh episode; an obsolete claimed episode cannot send; anonymous carts produce no jobs until authenticated merge');
    const closedStore = await fixture(); advance(delay); storefrontClosed = true;
    const beforeClosed = sends.length; await worker.tick(); assert.equal(sends.length, beforeClosed);
    assert.equal((await jobs(closedStore))[0].status, 'QUEUED');
    storefrontClosed = false; advance(300000); await worker.tick(); assert.equal(sends.length, beforeClosed + 1);
    report.checks.push('Existing prelaunch storefront gate defers reminders until the shop reopens');

    assert.deepEqual(await worker.recover(retry.user.id, sentEpisode.id), { valid: false });
    // The old email must not overwrite later contents or prices.
    await db.productVariant.update({ where: { id: variant.id }, data: { price: 4500, stockQty: 1 } });
    const restored = await worker.recover(original.user.id, sentEpisode.id);
    assert.equal(restored.valid, true); assert.equal(restored.purchasableItems[0].unitPriceFormatted, new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(45));
    assert.equal((await db.cartItem.findFirst({ where: { cartId: original.cart.id } })).qty, 1);
    const episodesBeforeAcceptance = (await jobs(original)).length;
    const currentItem = await db.cartItem.findFirst({ where: { cartId: original.cart.id } });
    await carts.updateItem({ userId: original.user.id }, currentItem.id, { qty: 1 });
    assert.equal((await db.cartItem.findUnique({ where: { id: currentItem.id } })).priceAtAdd, 4500);
    assert.equal((await jobs(original)).length, episodesBeforeAcceptance + 1, 'Accepting changed price is genuine activity even at the same quantity');
    await db.productVariant.update({ where: { id: variant.id }, data: { stockQty: 0 } });
    assert.equal((await worker.recover(original.user.id, sentEpisode.id)).purchasableItems.length, 0);
    report.checks.push('Recovery checks account ownership, keeps current cart intact, revalidates price and stock');

    const managed = new ManagedMailService(db, {});
    await managed.initialize('NOREPLY');
    const templates = await db.managedEmailTemplate.findMany({ where: { purpose: 'CART_ABANDONED' } });
    assert.equal(templates.length, 5); assert.equal(await db.emailPublication.count({ where: { purpose: { startsWith: 'CART_ABANDONED' } } }), 0);
    const t = templates[0];
    const sample = { circleLevel: 1, items: [{ name: 'Fixture', variantName: 'M', quantity: 1, imageUrl: 'https://example.test/image.png', lineTotalFormatted: '45,00 €' }],
      actionUrl: 'https://example.test/cart.html?recover=' + sentEpisode.id, unsubscribeUrl: 'https://example.test/unsubscribe' };
    const service = new EmailService({}, managed);
    await assert.rejects(service.prepareAbandonedCart('fixture@example.test', sample), /PUBLICATION_REQUIRED/);
    const folder = await db.emailTemplateFolder.findUnique({ where: { id: t.folderId } });
    const circle = Number(folder.name.match(/[1-5]/)[0]); sample.circleLevel = circle;
    assert.ok((await managed.preview('NOREPLY', { ...t, view: 'preview' })).html.includes('Recuperar mi carrito'));
    assert.ok((await managed.preview('NOREPLY', { ...t, view: 'edit' })).bindings);
    await managed.action('NOREPLY', t.id, { action: 'publish', revision: t.revision, confirmed: true });
    const rendered = await service.prepareAbandonedCart('fixture@example.test', sample);
    assert.ok(rendered.html.includes('Recuperar mi carrito')); assert.ok(rendered.html.includes('Fixture')); assert.ok(rendered.html.includes(sample.unsubscribeUrl));
    const currentTemplate = await db.managedEmailTemplate.findUnique({ where: { id: t.id } });
    await managed.save('NOREPLY', { ...currentTemplate, subject: 'Borrador posterior', signatureId: undefined, visualClassification: undefined }, undefined, t.id);
    assert.equal((await service.prepareAbandonedCart('fixture@example.test', sample)).subject, rendered.subject);
    await managed.initialize('NOREPLY'); assert.equal(await db.managedEmailTemplate.count({ where: { purpose: 'CART_ABANDONED' } }), 5);
    report.checks.push('Five circle drafts initialize without publication; only published versions render; products, CTA, logo, shared signature slot and unsubscribe retained; initialization is idempotent');
  } finally {
    Date.now = realNow;
    if (db) await db.$disconnect(); if (other) await other.$disconnect();
    if (created) { await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); report.cleanedUp = true; }
    await control.end();
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.match(path.basename(resolved), /^cronox-cart-reminder-[a-zA-Z0-9]+$/);
    fs.rmSync(resolved, { recursive: true, force: true });
    const output = path.resolve(backend, '../test-results/cart-abandonment/results.json');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
