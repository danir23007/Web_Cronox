'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewLine } = require('./review-manual-finance-costs.cjs');
const { prepare } = require('./prepare-manual-finance-recovery.cjs');
const order = { id: 19, source: 'IN_PERSON_ADMIN', purchasedAt: '2026-09-23T12:00:00', currency: 'EUR' };
const line = { id: 24, productId: 2, quantity: 2, lineTotal: '51', financialSnapshot: { unitCostCents: null } };
test('preserves archived historical costs including explicit zero, regardless of current cost', () => {
  for (const cost of [0, 1500]) {
    const result = reviewLine(order, { ...line, financialSnapshot: { unitCostCents: cost } }, { unitCostCents: 9999 }, [], null);
    assert.equal(result.status, 'preserve'); assert.equal(result.unitCostCents, cost);
  }
});
test('preserves saved costs and accepts configured manual costs updated after purchase', () => {
  assert.equal(reviewLine(order, line, { unitCostCents: 0 }, [], null).unitCostCents, 0);
  const revisions = [{ revision: 1, snapshot: { items: [{ ...line, financialSnapshot: { unitCostCents: 1500 } }] } }];
  assert.equal(reviewLine(order, line, null, revisions, null).unitCostCents, 1500);
  assert.equal(reviewLine(order, line, { unitCostCents: 1200 }, revisions, null).status, 'needs_evidence');
  const reviewed = reviewLine(order, line, null, [], { unitCostCents: 1500, updatedAt: new Date('2026-10-07Z') });
  assert.equal(reviewed.status, 'proposed');
  assert.equal(reviewed.paidUnitCents, 2550); assert.equal(reviewed.revenueCents, 5100);
  assert.equal(reviewed.costCents, 3000); assert.equal(reviewed.profitCents, 2100);
  assert.equal(reviewLine(order, line, null, [], { unitCostCents: 0, updatedAt: new Date('2026-09-01Z') }).unitCostCents, 0);
  assert.equal(reviewLine(order, line, null, [], null).status, 'missing_cost');
  assert.throws(() => reviewLine({ ...order, source: 'ONLINE' }, line, null, [], { unitCostCents: 1500 }), /restricted to manual/);
});
test('preparation requires per-line evidence, explicit approval, revision and verified administrator', () => {
  const row = { orderId: 19, itemId: 24, productId: 2, status: 'needs_evidence', expectedRevision: 1 };
  const review = { rows: [row] };
  const evidence = { orderId: 19, itemId: 24, unitCostCents: 0, approved: true, source: "Supplier's invoice dated before sale" };
  assert.ok(prepare(review, [evidence], 1).includes("Supplier''s invoice"));
  const delimited = prepare(review, [{ ...evidence, source: "Invoice '$recovery$' including delimiter" }], 1);
  assert.ok(delimited.includes('DO $recovery_1$'));
  assert.ok(delimited.includes('END $recovery_1$;'));
  for (const patch of [{ approved: false }, { unitCostCents: null }, { unitCostCents: -1 }, { unitCostCents: 1.5 }, { source: '' }]) {
    assert.throws(() => prepare(review, [{ ...evidence, ...patch }], 1));
  }
  assert.throws(() => prepare(review, [evidence], 0));
  assert.throws(() => prepare(review, [evidence, evidence], 1));
  assert.throws(() => prepare({ rows: [{ ...row, status: 'preserve' }] }, [evidence], 1));
  assert.throws(() => prepare({ rows: [{ ...row, expectedRevision: null }] }, [evidence], 1));
});
