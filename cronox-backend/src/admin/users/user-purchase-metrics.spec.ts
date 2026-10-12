import { loadUserPurchaseMetrics, sortUsersByMetrics } from './user-purchase-metrics';
import { FinanceOrder } from '../finance/financial-calculations';
import { validate } from 'class-validator';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';

const sale = (id: number, overrides: Partial<FinanceOrder> = {}): FinanceOrder => ({
  id, source: 'IN_PERSON_ADMIN', status: 'PAID', currency: 'EUR', providerRef: `pi_${id}`,
  paidAt: null, purchasedAt: new Date('2026-10-01T12:00:00Z'), createdAt: new Date('2026-10-01T12:00:00Z'), voidedAt: null,
  total: '51', shippingCost: 0, discountCents: 0, disputeLostCents: 0, stockMovements: [],
  items: [{ id, productId: 1, variantId: id, title: 'Same shirt', quantity: 2, lineTotal: '51', financialSnapshot: { unitCostCents: 1500, productName: 'Shirt', imageUrl: null } }], ...overrides,
});
function fixture(orders: FinanceOrder[], owners = orders.map(order => ({ id: order.id, userId: order.id })), events: any[] = [], stocks: any[] = []) {
  return {
    order: { findMany: jest.fn().mockResolvedValue(owners) },
    financeArchive: { findMany: jest.fn(({ where }) => orders.filter(o => where.orderId.in.includes(o.id)).map(order => ({ orderId: order.id, providerRef: order.providerRef, snapshot: order }))) },
    financeEventArchive: { findMany: jest.fn().mockResolvedValue(events) },
    financeStockArchive: { findMany: jest.fn().mockResolvedValue(stocks) },
  };
}
const now = new Date('2026-10-12T12:00:00Z');
describe('customer list purchase metrics', () => {
  it('uses paid snapshots, excludes manual exceptions/cancellations and counts sizes/units of the same product once', async () => {
    const tx = fixture([sale(1), sale(2, { excludedFromStatistics: true }), sale(3), sale(4, { status: 'CANCELLED' })],
      [1, 2, 3, 4].map(id => ({ id, userId: 1 })));
    const metrics = await loadUserPurchaseMetrics(tx as any, [1, 2], now);
    expect(metrics.get(1)).toEqual({ revenueCents: 10200, ordersCount: 2, distinctProducts: 1 });
    expect(metrics.get(2)).toEqual({ revenueCents: 0, ordersCount: 0, distinctProducts: 0 });
  });
  it('nets partial/full refunds, shipping and discounts using the finance engine; full refunds without restocking have no acquired products', async () => {
    const orders = [sale(1), sale(2), sale(3, { source: 'ONLINE', total: '53', shippingCost: 500, discountCents: 300 })];
    const events = [1, 2].map(id => ({ paymentIntentId: `pi_${id}`, occurredAt: new Date('2026-10-02T12:00:00Z'), snapshot: {
      id: String(id), paymentIntentId: `pi_${id}`, type: 'charge.refunded', refundCumulativeCents: id === 1 ? 5100 : 2550, lifecycleStatus: id === 1 ? 'REFUNDED' : null,
    } }));
    const stocks = [{ orderId: 2, createdAt: new Date('2026-10-02T12:00:00Z'), snapshot: { variantId: 2, delta: 1, reason: 'refund' } }];
    const metrics = await loadUserPurchaseMetrics(fixture(orders, undefined, events, stocks) as any, [1, 2, 3], now);
    expect(metrics.get(1)).toEqual({ revenueCents: 0, ordersCount: 1, distinctProducts: 0 });
    expect(metrics.get(2)).toEqual({ revenueCents: 2550, ordersCount: 1, distinctProducts: 1 });
    expect(metrics.get(3)).toEqual({ revenueCents: 4800, ordersCount: 1, distinctProducts: 1 });
  });
  it('batches the complete cohort instead of querying once per customer', async () => {
    const orders = Array.from({ length: 205 }, (_, i) => sale(i + 1));
    const tx = fixture(orders);
    const result = await loadUserPurchaseMetrics(tx as any, orders.map(o => o.id), now);
    expect(result.size).toBe(205); expect(tx.order.findMany).toHaveBeenCalledTimes(1);
    for (const name of ['financeArchive', 'financeEventArchive', 'financeStockArchive'] as const) expect(tx[name].findMany).toHaveBeenCalledTimes(2);
  });
  it.each(['id', 'revenue', 'orders', 'distinctProducts'] as const)('sorts %s numerically in both directions with stable registration ties', sort => {
    const metrics = new Map([[1, { revenueCents: 10000, ordersCount: 10, distinctProducts: 10 }], [2, { revenueCents: 900, ordersCount: 2, distinctProducts: 2 }], [3, { revenueCents: 900, ordersCount: 2, distinctProducts: 2 }], [4, { revenueCents: 0, ordersCount: 0, distinctProducts: 0 }]]);
    const users = [1, 2, 3, 4].map(id => ({ id }));
    expect(sortUsersByMetrics([...users], metrics, sort, 'desc').map(u => u.id)).toEqual(sort === 'id' ? [4, 3, 2, 1] : [1, 3, 2, 4]);
    expect(sortUsersByMetrics([...users], metrics, sort, 'asc').map(u => u.id)).toEqual(sort === 'id' ? [1, 2, 3, 4] : [4, 3, 2, 1]);
  });
  it('rejects unsupported sort/direction fields', async () => {
    expect((await validate(Object.assign(new AdminUserQueryDto(), { sort: 'email', order: 'sideways' }))).map(e => e.property).sort()).toEqual(['order', 'sort']);
  });
});
