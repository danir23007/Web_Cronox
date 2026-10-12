import { loadUserPurchaseMetrics, sortUsersByMetrics } from './user-purchase-metrics';
import { AdminUsersService } from './admin-users.service';
import { calculateFinance, FinanceOrder } from '../finance/financial-calculations';
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
  it('uses paid snapshots, includes excluded purchases and omits pending/cancelled orders and counts sizes/units of the same product once', async () => {
    const tx = fixture([sale(1), sale(2, { excludedFromStatistics: true }), sale(3), sale(4, { status: 'CANCELLED' }), sale(5, { status: 'PENDING' })],
      [1, 2, 3, 4, 5].map(id => ({ id, userId: 1 })));
    const metrics = await loadUserPurchaseMetrics(tx as any, [1, 2], now);
    expect(metrics.get(1)).toEqual({ revenueCents: 15300, ordersCount: 3, distinctProducts: 1 });
    expect(metrics.get(2)).toEqual({ revenueCents: 0, ordersCount: 0, distinctProducts: 0 });
  });
  it('nets partial/full refunds and discounts and includes delivery in personal spending; full refunds without restocking have no acquired products', async () => {
    const orders = [sale(1), sale(2), sale(3, { source: 'ONLINE', total: '53', shippingCost: 500, discountCents: 300 })];
    const events = [1, 2].map(id => ({ paymentIntentId: `pi_${id}`, occurredAt: new Date('2026-10-02T12:00:00Z'), snapshot: {
      id: String(id), paymentIntentId: `pi_${id}`, type: 'charge.refunded', refundCumulativeCents: id === 1 ? 5100 : 2550, lifecycleStatus: id === 1 ? 'REFUNDED' : null,
    } }));
    const stocks = [{ orderId: 2, createdAt: new Date('2026-10-02T12:00:00Z'), snapshot: { variantId: 2, delta: 1, reason: 'refund' } }];
    const metrics = await loadUserPurchaseMetrics(fixture(orders, undefined, events, stocks) as any, [1, 2, 3], now);
    expect(metrics.get(1)).toEqual({ revenueCents: 0, ordersCount: 1, distinctProducts: 0 });
    expect(metrics.get(2)).toEqual({ revenueCents: 2550, ordersCount: 1, distinctProducts: 1 });
    expect(metrics.get(3)).toEqual({ revenueCents: 5300, ordersCount: 1, distinctProducts: 1 });
  });
  it.each(['IN_PERSON_ADMIN', 'ONLINE'])('keeps spending unchanged when inclusion changes for %s', async source => {
    const included = sale(1, { total: '50', items: [{ ...sale(1).items[0], lineTotal: '50' }] });
    const excluded = sale(2, { source, excludedFromStatistics: true, total: '30', items: [{ ...sale(2).items[0], lineTotal: '30' }] });
    const tx = fixture([included, excluded], [{ id: 1, userId: 1 }, { id: 2, userId: 1 }]);
    expect((await loadUserPurchaseMetrics(tx as any, [1], now)).get(1)!.revenueCents).toBe(8000);
    const general = calculateFinance([included, excluded], [], '2026-10-01', '2026-10-12', 'months', false);
    expect(general.totals.revenueCents).toBe(source === 'IN_PERSON_ADMIN' ? 5000 : 8000);
    expect(general.totals.profitCents).toBe(2000);
    expect(excluded.excludedFromStatistics).toBe(true);
    excluded.excludedFromStatistics = false;
    expect((await loadUserPurchaseMetrics(tx as any, [1], now)).get(1)!.revenueCents).toBe(8000);
  });
  it('uses the same persisted spending in list and detail after exclusion changes and reloads', async () => {
    const orders = [sale(1), sale(2, { excludedFromStatistics: true })];
    const tx: any = fixture(orders, orders.map(o => ({ id: o.id, userId: 1 })));
    const user = { id: 1, email: 'buyer@example.test', createdAt: now };
    tx.user = { findMany: jest.fn().mockResolvedValue([user]), findUnique: jest.fn().mockResolvedValue(user) };
    tx.circleUpgradeRequest = { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) };
    tx.promoCodeRedemption = { findMany: jest.fn().mockResolvedValue([]) };
    tx.discountCode = tx.promoCode = { findFirst: jest.fn().mockResolvedValue(null) };
    tx.$transaction = jest.fn(callback => callback(tx));
    // The same order delegate serves operational history and ownership lookup.
    for (const excluded of [true, false, true]) {
      orders[1].excludedFromStatistics = excluded;
      const service = new AdminUsersService(tx);
      const list = await service.listUsers({});
      const detail = await service.getUserById(1);
      expect(list.data[0].revenueCents).toBe(10200);
      expect(detail.stats.totalSpent).toBe(102);
    }
  });
  it('applies partial/full refunds and voids to excluded purchases without duplicating cumulative refunds', async () => {
    const orders = [sale(1, { excludedFromStatistics: true }), sale(2, { excludedFromStatistics: true }),
      sale(3, { excludedFromStatistics: true, voidedAt: new Date('2026-10-02T12:00:00Z') })];
    const events = [1, 2, 3].map(id => ({ paymentIntentId: `pi_${id}`, occurredAt: new Date('2026-10-02T12:00:00Z'), snapshot: {
      id: String(id), type: 'charge.refunded', paymentIntentId: `pi_${id}`, refundCumulativeCents: id === 1 ? 2550 : 5100,
    } }));
    events.push({ ...events[0], snapshot: { ...events[0].snapshot, id: 'duplicate-cumulative' } });
    const result = await loadUserPurchaseMetrics(fixture(orders, undefined, events) as any, [1, 2, 3], now);
    expect(result.get(1)!.revenueCents).toBe(2550);
    expect(result.get(2)!.revenueCents).toBe(0);
    expect(result.get(3)!.revenueCents).toBe(0);
  });
  it('deducts a known partial refund from actual paid spending even when product/delivery allocation is unknown', async () => {
    const order = sale(1, { source: 'ONLINE', excludedFromStatistics: true, total: '53', shippingCost: 500, discountCents: 300 });
    const events = [{ paymentIntentId: 'pi_1', occurredAt: new Date('2026-10-02T12:00:00Z'), snapshot: {
      id: 'refund', type: 'charge.refunded', paymentIntentId: 'pi_1', refundCumulativeCents: 1000,
    } }];
    expect((await loadUserPurchaseMetrics(fixture([order], undefined, events) as any, [1], now)).get(1)!.revenueCents).toBe(4300);
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
