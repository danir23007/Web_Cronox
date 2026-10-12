'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async function review(db, manual, admin, users, product, variantId, now) {
  const fixtures = [];
  for (let i = 0; i < 106; i++) fixtures.push(await db.user.create({ data: { email: `users-list-${i}@example.test`, name: `LIST local ${String(i).padStart(3, '0')}`,
    accountState: ['ACTIVE', 'PRE_REGISTERED', 'PENDING_PASSWORD'][i % 3], createdAt: new Date(now.getTime() + i) } }));
  const secondProduct = await db.product.create({ data: { name: product.name, slug: 'list-different-identity', price: 99999,
    privateCost: { create: { unitCostCents: 1000 } }, variants: { create: { sku: 'LIST-SECOND', size: 'M', stockQty: 100 } } }, include: { variants: true } });
  const otherSize = await db.productVariant.create({ data: { productId: product.id, sku: 'LIST-SIZE-L', size: 'L', stockQty: 100 } });
  const purchase = async (owner, lines, excludedFromStatistics = false) => (await manual.create(owner.id, admin.id, randomUUID(), {
    paymentMethod: 'CASH', stockHandling: 'ALREADY_ADJUSTED', purchasedAt: now.toISOString(), excludedFromStatistics, items: lines,
  })).order;
  await purchase(fixtures[0], [{ variantId, quantity: 3, unitPriceCents: 2500 }, { variantId: otherSize.id, quantity: 1, unitPriceCents: 2500 }]);
  await purchase(fixtures[0], [{ variantId: secondProduct.variants[0].id, quantity: 1, unitPriceCents: 5000 }]);
  await purchase(fixtures[1], [{ variantId, quantity: 1, unitPriceCents: 9000 }]);
  await purchase(fixtures[2], [{ variantId, quantity: 1, unitPriceCents: 500 }]);
  await purchase(fixtures[2], [{ variantId, quantity: 1, unitPriceCents: 500 }]);
  const exception = await purchase(fixtures[3], [{ variantId, quantity: 1, unitPriceCents: 999999 }], true);
  const refundWeb = await db.order.create({ data: { userId: fixtures[4].id, customerEmail: fixtures[4].email, source: 'ONLINE', status: 'PAID', paidAt: now,
    providerRef: 'pi_users_full', subtotal: '20', total: '25', shippingCost: 500, taxRate: '0.21', taxAmount: '3.47', currency: 'EUR',
    items: { create: { productId: product.id, variantId, title: 'Full refund fixture', quantity: 2, unitPrice: '10', lineTotal: '20',
      financialSnapshot: { create: { productName: product.name, unitCostCents: 1500 } } } } } });
  await db.financeEventArchive.create({ data: { id: 'users-list-full-refund', paymentIntentId: 'pi_users_full', occurredAt: now,
    snapshot: { id: 'users-list-full-refund', type: 'charge.refunded', paymentIntentId: 'pi_users_full', refundCumulativeCents: 2500, lifecycleStatus: 'REFUNDED' } } });
  await db.order.update({ where: { id: refundWeb.id }, data: { status: 'REFUNDED' } });
  const original = await users.listUsers({ q: 'LIST local', pageSize: 100 });
  assert.equal(original.meta.total, 106); assert.equal(original.meta.sort, 'id'); assert.equal(original.meta.order, 'desc');
  assert.equal(original.data[0].registrationNumber, fixtures.at(-1).id);
  const all = [...original.data, ...(await users.listUsers({ q: 'LIST local', page: 2, pageSize: 100 })).data];
  assert.equal(all.length, 106);
  const metric = id => all.find(u => u.id === id);
  assert.equal(metric(fixtures[0].id).revenueCents, 15000); assert.equal(metric(fixtures[0].id).ordersCount, 2); assert.equal(metric(fixtures[0].id).distinctProducts, 2);
  assert.equal(metric(fixtures[2].id).distinctProducts, 1);
  assert.equal(metric(fixtures[3].id).revenueCents, 0); assert.equal(metric(fixtures[3].id).ordersCount, 0);
  assert.equal(metric(fixtures[4].id).revenueCents, 0); assert.equal(metric(fixtures[4].id).ordersCount, 1); assert.equal(metric(fixtures[4].id).distinctProducts, 0);
  for (const sort of ['id', 'revenue', 'orders', 'distinctProducts']) for (const order of ['asc', 'desc']) {
    const field = { id: 'id', revenue: 'revenueCents', orders: 'ordersCount', distinctProducts: 'distinctProducts' }[sort];
    const expected = [...all].sort((a, b) => (order === 'asc' ? a[field] - b[field] : b[field] - a[field]) || b.id - a.id);
    const pages = [...(await users.listUsers({ q: 'LIST local', sort, order, pageSize: 100 })).data, ...(await users.listUsers({ q: 'LIST local', sort, order, pageSize: 100, page: 2 })).data];
    assert.deepEqual(pages.map(u => u.id), expected.map(u => u.id));
  }
  assert.equal((await users.listUsers({ q: 'LIST local', accountState: 'ACTIVE' })).meta.total, 106);
  const pending = await users.listUsers({ q: 'users-list-1@example.test' }); assert.equal(pending.meta.total, 1); assert.equal(pending.data[0].accountState, 'PRE_REGISTERED');
  const stock = (await db.productVariant.findUnique({ where: { id: variantId } })).stockQty;
  await manual.setStatisticsExclusion(exception.id, admin.id, randomUUID(), false);
  assert.equal((await users.listUsers({ q: 'LIST local', sort: 'revenue', order: 'desc' })).data[0].id, fixtures[3].id);
  await manual.setStatisticsExclusion(exception.id, admin.id, randomUUID(), true);
  assert.equal((await db.productVariant.findUnique({ where: { id: variantId } })).stockQty, stock);
  return { ids: fixtures.map(u => u.id), zeroId: fixtures.at(-1).id, topRevenueId: fixtures[0].id, total: 106 };
};
