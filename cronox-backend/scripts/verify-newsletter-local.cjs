// Disposable PostgreSQL only. No production connection or real mail is permitted.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { NewsletterService } = require('../dist/newsletter/newsletter.service');
const { EmailService } = require('../dist/email/email.service');
const { MailTransportFactory } = require('../dist/email/mail-transport.factory');
const { OrdersService } = require('../dist/orders/orders.service');
const url = process.env.NEWSLETTER_TEST_DATABASE_URL;
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Disposable localhost database required');
const db = new PrismaClient({ datasources: { db: { url } } });
async function run() {
  const legacy = await db.promoCode.findUnique({ where: { code: 'CRX10-ABC234' } });
  const used = await db.promoCode.findUnique({ where: { code: 'CRX10-USED23' } });
  assert(legacy.firstOrderOnly && legacy.usageCount === 0);
  assert(used.usageCount === 1 && !used.isActive);
  assert.equal((await db.newsletterSubscription.findUnique({ where: { email: 'pending@example.test' } })).subscribedAt, null);
  const transport = new MailTransportFactory(db);
  let sends = 0, fail = false;
  transport.getFrom = () => 'test@example.test';
  transport.getTransport = () => ({ sendMail: async () => {
    sends++; if (fail) throw Object.assign(new Error('fixture SMTP'), { code: 'EAUTH' });
    await new Promise(resolve => setTimeout(resolve, 50));
    return { messageId: 'fixture', accepted: ['test@example.test'] };
  } });
  const email = new EmailService(transport);
  const service = new NewsletterService(db, email);
  const address = `parallel-${Date.now()}@example.test`;
  await Promise.allSettled([service.subscribe(address), service.subscribe(address)]);
  await service.subscribe(address);
  const sub = await db.newsletterSubscription.findUnique({ where: { email: address }, include: { welcomePromoCode: true } });
  assert.equal(sends, 1); assert(sub.subscribedAt && sub.welcomeSentAt); assert.equal(sub.verifiedAt, null);
  assert.match(sub.welcomePromoCode.code, /^[A-Z0-9]{6}$/);
  assert.equal(await db.promoCode.count({ where: { ownerEmail: address } }), 1);
  assert.equal(await db.emailDelivery.count({ where: { recipient: address, status: 'SMTP_ACCEPTED' } }), 1);
  const retryAddress = `retry-${Date.now()}@example.test`;
  fail = true; await assert.rejects(() => service.subscribe(retryAddress)); fail = false;
  await service.subscribe(retryAddress);
  assert.equal(await db.promoCode.count({ where: { ownerEmail: retryAddress } }), 1);
  assert.equal(await db.emailDelivery.count({ where: { recipient: retryAddress, status: 'FAILED' } }), 1);
  const validator = { prisma: db, resolvePromoRedemptionUserId: OrdersService.prototype.resolvePromoRedemptionUserId };
  const validate = opts => OrdersService.prototype.validatePromoAvailability.call(validator, sub.welcomePromoCode, opts);
  assert.equal((await validate({ customerEmail: address })).valid, true);
  assert.equal((await validate({ customerEmail: 'other@example.test' })).valid, false);
  const user = await db.user.create({ data: { email: address } });
  const order = await db.order.create({ data: { userId: user.id, customerEmail: address, status: 'PAID', subtotal: 20, total: 18, taxRate: 0, taxAmount: 0 } });
  assert.equal((await validate({ userId: user.id })).valid, false);
  assert.equal((await validate({ userId: user.id, excludeOrderId: order.id })).valid, true);
  const paid = await db.order.update({ where: { id: order.id }, data: { promoCodeId: sub.welcomePromoCode.id, promoCodeCode: sub.welcomePromoCode.code } });
  await db.$transaction(tx => OrdersService.prototype.handlePromoUsageOnPaid.call({ ...validator,
    validatePromoAvailability: OrdersService.prototype.validatePromoAvailability }, tx, paid, 'PENDING'));
  assert.equal((await db.promoCode.findUnique({ where: { id: sub.welcomePromoCode.id } })).usageCount, 1);
  assert.equal((await db.user.findUnique({ where: { id: user.id } })).firstOrderDiscountUsed, true);
  console.log('PASS: migration preservation, single opt-in, concurrent duplicate, SMTP failure/retry/audit, guest ownership and first-purchase eligibility');
}
run().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
