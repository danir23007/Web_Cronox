'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Called only by the disposable PostgreSQL test harness; never imports a live environment.
module.exports = async ({ db, service, users, adminId, checks }) => {
  const { calculateFinance } = require('../src/admin/finance/financial-calculations');
  const buyer = await db.user.create({ data: { email: 'edit-buyer@manual-purchase.test' } });
  const product = await db.product.create({ data: { name: 'Edit fixture', slug: 'edit-fixture', price: 2500,
    privateCost: { create: { unitCostCents: 1000 } }, variants: { create: [
      { size: 'M', sku: 'EDIT-M', stockQty: 10 }, { size: 'L', sku: 'EDIT-L', stockQty: 10 },
    ] } }, include: { variants: { orderBy: { id: 'asc' } } } });
  const [m, l] = product.variants.map(row => row.id);
  const originalPayload = { items: [{ variantId: m, quantity: 2, unitPriceCents: 2500 }], paymentMethod: 'CASH',
    stockHandling: 'DEDUCT_NOW', purchasedAt: '2026-10-01T12:00:33.123Z', note: 'Original' };
  const created = await service.create(buyer.id, adminId, randomUUID(), originalPayload);
  const id = created.order.id;
  const stock = async () => (await db.productVariant.findMany({ where: { productId: product.id }, orderBy: { id: 'asc' } })).map(row => row.stockQty);
  const editor = async () => service.getForEdit(buyer.id, id);
  const payload = form => ({ expectedVersion: form.expectedVersion, items: form.order.items.map(({ itemId, variantId, quantity, unitPriceCents }) => ({ itemId, variantId, quantity, unitPriceCents })),
    paymentMethod: form.order.paymentMethod, purchasedAt: form.order.purchasedAt, note: form.order.note, excludedFromStatistics: form.order.excludedFromStatistics });
  const state = async () => ({ edit: await editor(), stock: await stock(),
    archive: await db.financeArchive.findUniqueOrThrow({ where: { orderId: id } }), movements: await db.stockMovement.count(), audits: await db.auditLog.count() });
  const verifyMoney = async (amount, revenue, profit) => {
    assert.equal((await users.getUserById(buyer.id)).stats.totalSpent, amount);
    assert.equal((await users.listUsers({ q: buyer.email })).data[0].revenueCents, amount * 100);
    const archive = await db.financeArchive.findUniqueOrThrow({ where: { orderId: id } });
    const order = { ...archive.snapshot };
    for (const field of ['paidAt', 'purchasedAt', 'createdAt', 'voidedAt']) if (order[field]) order[field] = require('../src/admin/finance/historical-cost').archiveUtcDate(order[field]);
    order.stockMovements = [];
    const report = calculateFinance([order], [], '2026-01-01', '2026-12-31', 'months');
    assert.equal(report.totals.revenueCents, revenue);
    if (profit !== undefined) assert.equal(report.totals.profitCents, profit);
  };
  const initial = await editor();
  assert.equal(initial.editable, true); assert.equal(initial.order.purchasedAt, originalPayload.purchasedAt);
  assert.deepEqual(await stock(), [8, 10]);
  const noChange = await state();
  await service.edit(buyer.id, id, adminId, randomUUID(), payload(initial));
  assert.equal((await editor()).expectedVersion, initial.expectedVersion);
  assert.deepEqual(await stock(), noChange.stock);
  assert.equal((await db.financeArchive.findUniqueOrThrow({ where: { orderId: id } })).revision, noChange.archive.revision);
  await db.productCost.update({ where: { productId: product.id }, data: { unitCostCents: 9999 } });
  const firstPayload = { ...payload(initial), items: [{ ...payload(initial).items[0], quantity: 3, unitPriceCents: 2600 }],
    purchasedAt: '2026-10-02T15:12:45.456Z', excludedFromStatistics: true, paymentMethod: 'BANK_TRANSFER', note: 'Edited' };
  const key = randomUUID();
  await service.edit(buyer.id, id, adminId, key, firstPayload);
  assert.deepEqual(await stock(), [7, 10]);
  const financial = await db.orderItemFinancial.findUniqueOrThrow({ where: { itemId: initial.order.items[0].itemId } });
  assert.equal(financial.unitCostCents, 1000);
  assert.equal((await editor()).order.id, id);
  await verifyMoney(78, 0, 0);
  const currentArchive = await db.financeArchive.findUniqueOrThrow({ where: { orderId: id } });
  assert.equal(currentArchive.snapshot.total, '78'); assert.equal(currentArchive.paidDate.toISOString().slice(0, 10), '2026-10-02');
  const originalArchive = await db.financeArchiveRevision.findUniqueOrThrow({ where: { orderId_revision: { orderId: id, revision: 1 } } });
  assert.equal(Number(originalArchive.snapshot.total), 50); assert.equal(originalArchive.snapshot.items[0].financialSnapshot.unitCostCents, 1000);
  const afterFirst = await state();
  assert.equal((await service.edit(buyer.id, id, adminId, key, firstPayload)).replayed, true);
  assert.deepEqual(await state(), afterFirst);
  await assert.rejects(service.edit(buyer.id, id, adminId, key, { ...firstPayload, note: 'different' }), /clave/);
  await assert.rejects(service.edit(buyer.id, id, adminId, randomUUID(), firstPayload), /ha cambiado/);
  const second = await editor();
  await service.edit(buyer.id, id, adminId, randomUUID(), { ...payload(second), excludedFromStatistics: false });
  await verifyMoney(78, 7800, 4800);
  assert.deepEqual(await stock(), [7, 10]);
  const replacement = await editor();
  await service.edit(buyer.id, id, adminId, randomUUID(), { ...payload(replacement), items: [
    { ...payload(replacement).items[0], quantity: 1 }, { variantId: l, quantity: 2, unitPriceCents: 3000 },
  ] });
  assert.deepEqual(await stock(), [9, 8]); await verifyMoney(86, 8600, -12398);
  const replaced = await editor();
  const costs = await db.orderItem.findMany({ where: { orderId: id }, orderBy: { id: 'asc' }, include: { financialSnapshot: true } });
  assert.equal(costs[0].financialSnapshot.unitCostCents, 1000); assert.equal(costs[1].financialSnapshot.unitCostCents, 9999);
  const beforeFailure = await state();
  const lLine = payload(replaced).items.find(item => item.variantId === l);
  await assert.rejects(service.edit(buyer.id, id, adminId, randomUUID(), { ...payload(replaced), items: [{ ...lLine, quantity: 100 }] }), /stock suficiente/);
  assert.deepEqual(await state(), beforeFailure);
  await assert.rejects(service.edit(buyer.id, id, 2147483647, randomUUID(), { ...payload(replaced), items: [{ ...lLine, quantity: 1 }] }), error => error.code === 'P2003');
  assert.deepEqual(await state(), beforeFailure);
  await assert.rejects(service.edit(buyer.id, id, adminId, randomUUID(), { ...payload(replaced), items: [{ ...lLine, itemId: 2147483647 }] }), /no pertenece/);
  await assert.rejects(service.getForEdit(2147483647, id), /no encontrada/);
  const concurrent = await Promise.allSettled([10, 20].map(price => service.edit(buyer.id, id, adminId, randomUUID(), {
    ...payload(replaced), items: payload(replaced).items.map(item => ({ ...item, unitPriceCents: price })),
  })));
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.deepEqual(await stock(), [9, 8]);
  const edited = await editor();
  const replayKey = randomUUID(), same = { ...payload(edited), note: 'Concurrent same retry' };
  const retries = await Promise.allSettled([service.edit(buyer.id, id, adminId, replayKey, same), service.edit(buyer.id, id, adminId, replayKey, same)]);
  assert.equal(retries.filter(result => result.status === 'fulfilled').length, 2, retries.filter(result => result.status === 'rejected').map(result => result.reason.message).join('; '));
  assert.equal(await db.order.count({ where: { userId: buyer.id } }), 1);
  assert.equal(await db.auditLog.count({ where: { requestKey: replayKey } }), 1);
  const record = await db.auditLog.findUniqueOrThrow({ where: { requestKey: key } });
  assert.equal(record.actorId, adminId); assert.ok(record.createdAt); assert.equal(record.metadata.before.items[0].quantity, 2); assert.equal(record.metadata.after.items[0].quantity, 3);
  assert.equal((await service.create(buyer.id, adminId, created.order.manualIdempotencyKey || (await db.order.findUniqueOrThrow({ where: { id } })).manualIdempotencyKey, originalPayload)).created, false);
  await service.void(id, adminId, 'Cancel edited fixture');
  assert.deepEqual(await stock(), [10, 10]); assert.equal((await editor()).editable, false);
  await assert.rejects(service.edit(buyer.id, id, adminId, randomUUID(), payload(edited)), /anuladas/);
  assert.equal((await users.getUserById(buyer.id)).stats.totalSpent, 0);
  checks.push('Edit same purchase: net stock differences, historical costs, date/payment/note/exclusion, current finance archive plus immutable originals, user spending, retries, concurrency and rollback verified');
  const adjustedBuyer = await db.user.create({ data: { email: 'edit-adjusted@manual-purchase.test' } });
  const adjusted = await service.create(adjustedBuyer.id, adminId, randomUUID(), { ...originalPayload, stockHandling: 'ALREADY_ADJUSTED' });
  const adjustedForm = await service.getForEdit(adjustedBuyer.id, adjusted.order.id);
  const adjustedKey = randomUUID();
  const adjustedEdit = { ...payload(adjustedForm), items: [{ ...payload(adjustedForm).items[0], variantId: l, quantity: 5, unitPriceCents: 1000 }], excludedFromStatistics: true };
  await db.productVariant.update({ where: { id: l }, data: { stockQty: 0 } });
  await service.edit(adjustedBuyer.id, adjusted.order.id, adminId, adjustedKey, adjustedEdit);
  assert.deepEqual(await stock(), [10, 0]);
  assert.equal(await db.stockMovement.count({ where: { orderId: adjusted.order.id } }), 0);
  assert.equal((await users.getUserById(adjustedBuyer.id)).stats.totalSpent, 50);
  await db.productVariant.update({ where: { id: l }, data: { isActive: false } });
  await db.productCost.update({ where: { productId: product.id }, data: { unitCostCents: 12000 } });
  const inactive = await service.getForEdit(adjustedBuyer.id, adjusted.order.id);
  const inactivePayload = payload(inactive);
  await assert.rejects(service.edit(adjustedBuyer.id, adjusted.order.id, adminId, randomUUID(), { ...inactivePayload,
    items: [{ ...inactivePayload.items[0], quantity: 6 }] }), /no está disponible/);
  await assert.rejects(service.edit(adjustedBuyer.id, adjusted.order.id, adminId, randomUUID(), { ...inactivePayload,
    items: [inactivePayload.items[0], inactivePayload.items[0]] }), /no son válidos/);
  await service.edit(adjustedBuyer.id, adjusted.order.id, adminId, randomUUID(), { ...inactivePayload,
    items: [{ ...inactivePayload.items[0], quantity: 4, unitPriceCents: 1250 }] });
  assert.equal((await db.orderItemFinancial.findUniqueOrThrow({ where: { itemId: inactivePayload.items[0].itemId } })).unitCostCents, 9999);
  assert.deepEqual(await stock(), [10, 0]);
  assert.equal((await users.getUserById(adjustedBuyer.id)).stats.totalSpent, 50);
  await db.order.update({ where: { id: adjusted.order.id }, data: { status: 'REFUNDED' } });
  assert.equal((await service.getForEdit(adjustedBuyer.id, adjusted.order.id)).editable, false);
  await db.order.update({ where: { id: adjusted.order.id }, data: { status: 'PAID', providerRef: 'pi_external_fixture' } });
  assert.match((await service.getForEdit(adjustedBuyer.id, adjusted.order.id)).limitation, /pago integrado/);
  await assert.rejects(service.edit(adjustedBuyer.id, adjusted.order.id, adminId, randomUUID(), adjustedEdit), /pago integrado/);
  checks.push('Already-adjusted edit leaves stock untouched even with zero availability; cancelled/refunded/external-payment restrictions and same-order identity verified');
};
