import {
  calculatePoints,
  commission,
  lineDelta,
  pointDate,
  PointLine,
} from './point-calculations';
const line = (bp = 0): PointLine => ({
  id: 'test',
  productId: 1,
  variantId: 1,
  name: 'Camiseta',
  size: 'M',
  quantity: 10,
  unitPriceCents: 5000,
  unitCostCents: 1500,
  commissionBp: bp,
  commissionCents: commission(50000, bp),
  returned: 0,
});
describe('External sale finance ledger', () => {
  it.each([
    [0, 20000, 15000],
    [6000, 0, 5000],
    [2000, 10000, 15000],
  ])('commission %i bp and expense %i => profit %i', (bp, expense, profit) => {
    const result = calculatePoints(
      [
        {
          kind: 'SALE',
          occurredAt: pointDate('2026-10-01T12:00'),
          lines: [lineDelta(line(bp))],
          expenseCents: 0,
        },
        {
          kind: 'EXPENSE',
          occurredAt: pointDate('2026-10-02T12:00'),
          lines: [],
          expenseCents: expense,
        },
      ],
      '2026-10-01',
      '2026-10-02',
    );
    expect(result.totals).toMatchObject({
      revenueCents: 50000,
      costCents: 15000,
      profitCents: profit,
      salesCount: 1,
    });
    expect(result.buckets.reduce((s, b) => s + b.profitCents!, 0)).toBe(profit);
    expect(result.products[0].profitCents).toBe(profit + expense);
    expect(result.buckets[1].profitCents).toBe(0 - expense);
  });
  it('reports real losses without sales and exact half-up commission', () => {
    const r = calculatePoints(
      [
        {
          kind: 'EXPENSE',
          occurredAt: pointDate('2026-10-01T12:00'),
          expenseCents: 200000,
          lines: [],
        },
      ],
      '2026-10-01',
      '2026-10-02',
    );
    expect(r.totals.profitCents).toBe(-200000);
    expect(r.products).toEqual([]);
    expect(r.averageTicketCents).toBe(0);
    expect(commission(1, 5000)).toBe(1);
    expect(commission(999999999, 6000)).toBe(599999999);
  });
  it('uses Madrid boundaries, rejects DST gaps, and resolves overlap deterministically', () => {
    expect(pointDate('2026-03-29T00:00').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(() => pointDate('2026-03-29T02:30')).toThrow();
    expect(() => pointDate('2026-02-30T12:00')).toThrow();
    expect(pointDate('2026-10-25T02:30').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
  it('keeps commission and cost for a non-restocked, non-recovered return', () => {
    const l = line(6000),
      delta = {
        ...lineDelta(l),
        revenueCents: -10000,
        costCents: 0,
        commissionCents: 0,
        unitsSold: 0,
        unitsReturned: 2,
      };
    const r = calculatePoints(
      [
        {
          kind: 'SALE',
          occurredAt: pointDate('2026-10-01T12:00'),
          expenseCents: 0,
          lines: [lineDelta(l)],
        },
        {
          kind: 'RETURN',
          occurredAt: pointDate('2026-10-02T12:00'),
          expenseCents: 0,
          lines: [delta],
        },
      ],
      '2026-10-01',
      '2026-10-02',
    );
    expect(r.totals).toMatchObject({
      revenueCents: 40000,
      costCents: 15000,
      commissionCents: 30000,
      profitCents: -5000,
    });
    expect(r.netUnits).toBe(8);
  });
});
