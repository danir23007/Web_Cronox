import { allocate, calculateFinance, cents, FinanceEvent, FinanceOrder, madridDate, madridMidnight, sortProducts, validateRange } from './financial-calculations';

const order = (overrides: Partial<FinanceOrder> = {}): FinanceOrder => ({
  id:1, status:'PAID', currency:'EUR', providerRef:'pi_1', source:'ONLINE',
  paidAt:new Date('2026-03-28T12:00:00Z'), purchasedAt:null, createdAt:new Date('2026-03-28T12:00:00Z'), voidedAt:null,
  total:'20.00', shippingCost:0, discountCents:0, disputeLostCents:0,
  items:[{ id:1, productId:1, variantId:1, title:'Producto (M)', quantity:2, lineTotal:'20.00', financialSnapshot:{ unitCostCents:600, productName:'Producto original', imageUrl:null } }],
  stockMovements:[], ...overrides,
});
const refund = (id: string, value: number | null, date = '2026-03-29T12:00:00Z'): FinanceEvent => ({ id, type:'charge.refunded', paymentIntentId:'pi_1', occurredAt:new Date(date), lifecycleStatus:value === 2000 ? 'REFUNDED' : null, refundCumulativeCents:value, amountCents:null });
const report = (orders = [order()], events: FinanceEvent[] = [], aggregation: 'days' | 'months' = 'days') => calculateFinance(orders, events, '2026-03-28', '2026-03-30', aggregation);

describe('Private financial calculations', () => {
  it('allocates discounts exactly with stable largest-remainder rounding', () => {
    expect(allocate(2, [100,100,100])).toEqual([1,1,0]);
    expect(allocate(1, [333,667])).toEqual([0,1]);
    expect(allocate(999999999, [2147483647,2147483646]).reduce((a,b) => a+b,0)).toBe(999999999);
    expect(cents('12345678.91')).toBe(1234567891);
  });
  it('excludes unpaid, failed and cancelled unpaid orders', () => {
    expect(report([order({ status:'PENDING', paidAt:null }), order({ id:2, status:'CANCELLED', paidAt:null })]).totals.revenueCents).toBe(0);
  });
  it('uses immutable line amounts, discounts and costs; excludes shipping', () => {
    const result = report([order({ total:'22.00', shippingCost:500, discountCents:300 })]);
    expect(result.totals).toMatchObject({ revenueCents:1700, costCents:1200, profitCents:500, unitsSold:2 });
    expect(result.products[0].name).toBe('Producto original');
    expect(result.recentOrders[0].totalCents).toBe(2200);
  });
  it('distinguishes unknown costs, deliberate zero, and losses', () => {
    const base = order();
    for (const [cost,expected] of [[null,null],[0,2000],[1500,-1000]] as const) {
      base.items[0].financialSnapshot!.unitCostCents = cost;
      expect(report([base]).totals.profitCents).toBe(expected);
    }
  });
  it('does not present a known subtotal as complete profit', () => {
    const missing = order({ id:2 }); missing.items[0].financialSnapshot = null;
    expect(report([order(), missing]).totals).toMatchObject({ revenueCents:4000, costCents:null, profitCents:null });
  });
  it('never treats an EUR product cost as a foreign-currency cost', () => {
    expect(report([order({ currency:'GBP' })]).totals).toMatchObject({ revenueCents:2000, costCents:null, profitCents:null });
  });
  it('deduplicates cumulative partial refunds, including different event IDs and out-of-order delivery', () => {
    const result = report([order()], [refund('b',700),refund('a',300),refund('c',700)]);
    expect(result.totals).toMatchObject({ revenueCents:1300, costCents:1200, profitCents:100, unitsSold:2, unitsReturned:0 });
  });
  it('a full money refund alone does not reverse product cost or sold units', () => {
    expect(report([order()], [refund('a',2000)]).totals).toMatchObject({ revenueCents:0, costCents:1200, profitCents:-1200, unitsSold:2, unitsReturned:0 });
  });
  it('reverses only documented returned units, on the movement date', () => {
    const item = order({ stockMovements:[{ variantId:1, delta:1, reason:'refund', createdAt:new Date('2026-03-30T12:00:00Z') }] });
    const result = report([item], [refund('a',500)]);
    expect(result.totals).toMatchObject({ revenueCents:1500, costCents:600, profitCents:900, unitsReturned:1 });
    expect(result.buckets[1]).toMatchObject({ revenueCents:-500, costCents:0 });
    expect(result.buckets[2]).toMatchObject({ revenueCents:0, costCents:-600 });
  });
  it('does not guess the merchandise/shipping split of a partial refund', () => {
    const result = report([order({ total:'25.00', shippingCost:500 })], [refund('a',300)]);
    expect(result.totals.profitCents).toBeNull();
    expect(result.totals.revenueCents).toBeNull();
    expect(result.buckets[0].revenueCents).toBe(2000);
  });
  it('keeps full refunds traceable and uses their event date, even in a later period', () => {
    const result = calculateFinance([order({ status:'REFUNDED' })], [refund('a',2000)], '2026-03-29','2026-03-30','days');
    expect(result.totals.revenueCents).toBe(-2000);
    expect(result.recentOrders).toEqual([]);
  });
  it('marks legacy partial refunds without recorded amounts unavailable', () => {
    expect(report([order()], [refund('legacy',null)]).totals.revenueCents).toBeNull();
  });
  it('preserves missing refund-date uncertainty rather than trusting updatedAt', () => {
    const result = report([order({ status:'REFUNDED' })]);
    expect(result.totals.revenueCents).toBeNull();
    expect(result.warnings.join(' ')).toContain('evento fechado');
    expect(result.buckets.every(bucket => bucket.revenueCents === null)).toBe(true);
  });
  it('uses Madrid inclusive days through both daylight-saving boundaries', () => {
    expect(madridMidnight('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(madridMidnight('2026-03-30').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(madridMidnight('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(madridMidnight('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(madridDate(new Date('2026-03-30T21:59:59.999Z'))).toBe('2026-03-30');
    expect(madridDate(new Date('2026-03-30T22:00:00Z'))).toBe('2026-03-31');
  });
  it('reconciles days, months, products and totals, with genuine zero buckets', () => {
    const day = report(), month = report(undefined,undefined,'months');
    expect(day.totals).toEqual(month.totals);
    expect(day.products.reduce((sum,p) => sum+p.revenueCents!,0)).toBe(day.totals.revenueCents);
    expect(day.buckets.map(b => b.revenueCents)).toEqual([2000,0,0]);
  });
  it('sorts the whole product dataset, units independently of price and null profits last both ways', () => {
    const make = (productId: number, revenueCents: number, unitsSold: number, profitCents: number | null) => ({ productId,name:'P',imageUrl:null,revenueCents,costCents:0,profitCents,unitsSold,unitsReturned:0 });
    const products = [make(1,900,1,null),make(2,200,8,-20),make(3,100,9,80),make(4,100,9,0)];
    expect(sortProducts(products,'units','desc').map(p => p.productId)).toEqual([3,4,2,1]);
    expect(sortProducts(products,'profit','asc').map(p => p.productId)).toEqual([2,4,3,1]);
    expect(sortProducts(products,'profit','desc').map(p => p.productId)).toEqual([3,4,2,1]);
  });
  it('rejects invalid calendar dates and reversed ranges', () => {
    expect(() => validateRange('2026-02-30','2026-03-01')).toThrow();
    expect(() => validateRange('2026-04-01','2026-03-01')).toThrow();
  });
});
