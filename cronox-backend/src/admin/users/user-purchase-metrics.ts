import { Prisma } from '@prisma/client';
import { countsInStatistics } from '../../common/statistics-eligibility';
import { archiveUtcDate } from '../finance/historical-cost';
import { calculateFinance, FinanceEvent, FinanceOrder, madridDate } from '../finance/financial-calculations';

export type UserSort = 'id' | 'revenue' | 'orders' | 'distinctProducts';
export type UserPurchaseMetrics = { revenueCents: number | null; ordersCount: number; distinctProducts: number };
const empty = (): UserPurchaseMetrics => ({ revenueCents: 0, ordersCount: 0, distinctProducts: 0 });

// Reuses archived paid prices, discounts, refunds and exclusion rules. Batch
// queries serve the entire result set; no per-customer database requests.
export async function loadUserPurchaseMetrics(tx: Prisma.TransactionClient, userIds: number[], now = new Date()) {
  const metrics = new Map(userIds.map(id => [id, empty()]));
  if (!userIds.length) return metrics;
  const owners = await tx.order.findMany({ where: { userId: { in: userIds } }, select: { id: true, userId: true } });
  const userByOrder = new Map(owners.map(row => [row.id, row.userId!]));
  const productsByUser = new Map<number, Map<number, number>>();
  const to = madridDate(now);
  for (let offset = 0; offset < owners.length; offset += 200) {
    const ids = owners.slice(offset, offset + 200).map(row => row.id);
    const archives = await tx.financeArchive.findMany({ where: { orderId: { in: ids } } });
    const [events, stocks] = await Promise.all([
      tx.financeEventArchive.findMany({ where: { paymentIntentId: { in: archives.flatMap(row => row.providerRef ? [row.providerRef] : []) } } }),
      tx.financeStockArchive.findMany({ where: { orderId: { in: ids } } }),
    ]);
    const eventsByPayment = new Map<string, FinanceEvent[]>();
    for (const row of events) {
      if (!row.paymentIntentId) continue;
      const list = eventsByPayment.get(row.paymentIntentId) ?? [];
      list.push({ ...(row.snapshot as unknown as FinanceEvent), occurredAt: row.occurredAt });
      eventsByPayment.set(row.paymentIntentId, list);
    }
    const stockByOrder = new Map<number, FinanceOrder['stockMovements']>();
    for (const row of stocks) {
      const list = stockByOrder.get(row.orderId) ?? [];
      list.push({ ...(row.snapshot as unknown as FinanceOrder['stockMovements'][number]), createdAt: row.createdAt });
      stockByOrder.set(row.orderId, list);
    }
    for (const archive of archives) {
      const order = { ...(archive.snapshot as unknown as FinanceOrder) };
      if (!countsInStatistics(order) || order.status === 'CANCELLED') continue;
      for (const field of ['paidAt', 'purchasedAt', 'createdAt', 'voidedAt'] as const) if (order[field]) order[field] = archiveUtcDate(order[field]!);
      order.stockMovements = stockByOrder.get(order.id) ?? [];
      const report = calculateFinance([order], eventsByPayment.get(order.providerRef ?? '') ?? [], '2000-01-01', to, 'months', false);
      const userId = userByOrder.get(order.id)!;
      const metric = metrics.get(userId)!;
      metric.revenueCents = metric.revenueCents === null || report.totals.revenueCents === null || order.currency !== 'EUR' ? null : metric.revenueCents + report.totals.revenueCents;
      // Match finance's paid-sales count: a refund adjusts money/units, it does
      // not create/delete the original paid order. Cancelled orders are omitted.
      metric.ordersCount += report.recentOrders.length;
      if (metric.revenueCents !== null && !Number.isSafeInteger(metric.revenueCents)) throw new Error('La facturación supera la precisión monetaria admitida.');
      const paid = report.recentOrders[0];
      const fullyReturned = order.status === 'REFUNDED' || (paid && paid.refundedCents !== null && paid.totalCents > 0 && paid.refundedCents === paid.totalCents);
      const products = productsByUser.get(userId) ?? new Map<number, number>();
      for (const product of report.products) {
        const units = fullyReturned ? 0 : Math.max(0, product.unitsSold - product.unitsReturned);
        products.set(product.productId, (products.get(product.productId) ?? 0) + units);
      }
      productsByUser.set(userId, products);
    }
  }
  for (const [id, products] of productsByUser) metrics.get(id)!.distinctProducts = [...products.values()].filter(units => units > 0).length;
  return metrics;
}

export function sortUsersByMetrics<T extends { id: number }>(users: T[], metrics: Map<number, UserPurchaseMetrics>, sort: UserSort, direction: 'asc' | 'desc') {
  const field = { revenue: 'revenueCents', orders: 'ordersCount', distinctProducts: 'distinctProducts' } as const;
  return users.sort((a, b) => {
    const left = sort === 'id' ? a.id : metrics.get(a.id)![field[sort]];
    const right = sort === 'id' ? b.id : metrics.get(b.id)![field[sort]];
    if (left === null || right === null) return left === right ? b.id - a.id : left === null ? 1 : -1;
    return (direction === 'asc' ? left - right : right - left) || b.id - a.id;
  });
}
