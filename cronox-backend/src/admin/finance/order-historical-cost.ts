import { Prisma } from '@prisma/client';
import { FinanceOrder } from './financial-calculations';
import { historicalLotParts } from '../../inventory-lots/historical-lot-cost';

/** Read-only projection: the archive and physical allocations stay immutable.
 * Missing provenance/quantities stay unknown; no current ProductCost fallback. */
export async function applyOrderHistoricalCosts(tx: Prisma.TransactionClient, order: FinanceOrder): Promise<FinanceOrder> {
  const at = order.source === 'IN_PERSON_ADMIN' ? order.purchasedAt ?? order.createdAt : order.paidAt ?? order.createdAt;
  const items = await Promise.all(order.items.map(async line => {
    const snapshot = line.financialSnapshot, parts = snapshot?.lotCosts;
    if (!snapshot || !parts?.length || !line.variantId || parts.reduce((n,p) => n+p.quantity,0) !== line.quantity) return line;
    const resolved = await historicalLotParts(tx, parts, line.variantId, at, snapshot.unitCostCents, String(line.id));
    return { ...line, financialSnapshot: { ...snapshot, lotCosts: resolved } };
  }));
  return { ...order, items };
}
