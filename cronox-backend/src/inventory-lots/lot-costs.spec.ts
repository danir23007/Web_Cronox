import { frozenCost, receiptSlices, retainPhysicalIdentity } from './lot-costs';

describe('lot monetary allocation', () => {
  it('keeps original stock identity during an audited monetary correction', () => {
    const original = [{ lotId: 'lot-a', sliceId: 'physical-slice', quantity: 2, productionCents: 100, freightCents: 1, otherCents: 0, quality: 'CONFIRMED' }];
    const correction = [{ ...original[0], sliceId: 'historical:1', productionCents: 120 }];
    expect(retainPhysicalIdentity(original, correction)[0]).toMatchObject({ sliceId: 'physical-slice', productionCents: 120 });
    expect(() => retainPhysicalIdentity(original, [{ ...correction[0], lotId: 'another-lot' }])).toThrow();
    expect(frozenCost([{ ...original[0], productionCents: null, freightCents: null, legacyUnitCostCents: 150 }])).toBe(300);
  });
  it('conserves each expense independently with deterministic integer-cent slices', () => {
    const slices = receiptSlices([{ variantId: 2, quantity: 2, productionCents: 500 }, { variantId: 1, quantity: 3, productionCents: 600 }], 7, 3);
    expect(slices.reduce((s, l) => s + l.quantity, 0)).toBe(5);
    expect(slices.reduce((s, l) => s + l.quantity * l.freightCents!, 0)).toBe(7);
    expect(slices.reduce((s, l) => s + l.quantity * l.otherCents!, 0)).toBe(3);
    expect(slices[0].variantId).toBe(1);
    expect(slices.every(l => Number.isInteger(l.freightCents) && Number.isInteger(l.otherCents))).toBe(true);
  });
  it('keeps unknown and estimated costs out of confirmed profit', () => {
    const cost = { lotId: 'a', sliceId: 'b', quantity: 2, productionCents: 100, freightCents: 1, otherCents: 0, quality: 'CONFIRMED' };
    expect(frozenCost([cost])).toBe(202);
    expect(frozenCost([{ ...cost, quality: 'ESTIMATED' }])).toBeNull();
    expect(frozenCost([{ ...cost, productionCents: null }])).toBeNull();
  });
  it('rejects repeated variants, fractional cents and negative quantities', () => {
    expect(() => receiptSlices([{ variantId: 1, quantity: 2, productionCents: 0.5 }], 0, 0)).toThrow();
    expect(() => receiptSlices([{ variantId: 1, quantity: -1, productionCents: 0 }], 0, 0)).toThrow();
    expect(() => receiptSlices([{ variantId: 1, quantity: 1, productionCents: 0 }, { variantId: 1, quantity: 1, productionCents: 0 }], 0, 0)).toThrow();
  });
});
