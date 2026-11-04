import { Prisma } from '@prisma/client';
import { managedVariant, sourceCosts, takeCosts, removeCostParts } from './lot-ledger';
import { FrozenLotCost } from './lot-costs';

export async function freezeCheckoutLots(tx: Prisma.TransactionClient, checkoutId: string) {
  const items = await tx.checkoutSnapshotItem.findMany({ where: { checkoutSnapshotId: checkoutId }, orderBy: { id: 'asc' } });
  const offsets = new Map<number, number>();
  for (const item of items) {
    if (!await managedVariant(tx, item.variantId)) continue;
    const parts = takeCosts(await sourceCosts(tx, 'checkout:' + checkoutId, item.variantId), item.quantity, offsets.get(item.variantId) ?? 0);
    offsets.set(item.variantId, (offsets.get(item.variantId) ?? 0) + item.quantity);
    await tx.checkoutItemFinancial.update({ where: { itemId: item.id }, data: { unitCostCents: null, lotCosts: parts as unknown as Prisma.InputJsonValue } });
  }
}

export async function freezeOrderLots(tx: Prisma.TransactionClient, orderId: number, alreadyAdjusted = false, previous: Array<{ id: number; variantId: number | null; quantity: number; financialSnapshot: { unitCostCents: number | null; lotCosts: Prisma.JsonValue | null } | null }> = []) {
  const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
  const offsets = new Map<number, number>();
  const costs = new Map<number, FrozenLotCost[]>();
  const retained = new Map<number, FrozenLotCost[]>();
  for (const item of items) {
    if (!item.variantId || !await managedVariant(tx, item.variantId)) continue;
    // An unlinked historical sale never consumes stock again. Unknown provenance
    // is explicitly represented, rather than priced from today's product cost.
    if (!costs.has(item.variantId)) {
      const sourced = alreadyAdjusted ? [] : await sourceCosts(tx, 'order:' + orderId, item.variantId);
      const needed = items.filter(i => i.variantId === item.variantId).reduce((s,i) => s+i.quantity,0);
      let missing = needed - sourced.reduce((s,p) => s+p.quantity,0);
      if (missing > 0 && !alreadyAdjusted && !previous.length) throw new Error('LOT_FINANCIAL_ALLOCATION_MISSING');
      const historical: FrozenLotCost[] = [];
      for (const old of previous.filter(i => i.variantId === item.variantId)) {
        const quantity = Math.min(missing, old.quantity); if (quantity <= 0) break;
        if (Array.isArray(old.financialSnapshot?.lotCosts) && old.financialSnapshot.lotCosts.length) historical.push(...takeCosts(old.financialSnapshot.lotCosts as unknown as FrozenLotCost[], quantity));
        else historical.push({ lotId: 'unreconciled', sliceId: 'historical:' + old.id, quantity, productionCents: null, freightCents: null, otherCents: null, quality: old.financialSnapshot?.unitCostCents == null ? 'UNKNOWN' : 'CONFIRMED', legacyUnitCostCents: old.financialSnapshot?.unitCostCents ?? null });
        missing -= quantity;
      }
      if (missing > 0) historical.push({ lotId: 'unreconciled', sliceId: 'unreconciled', quantity: missing, productionCents: null, freightCents: null, otherCents: null, quality: 'UNKNOWN' });
      costs.set(item.variantId, [...historical, ...sourced]);
      const pool = costs.get(item.variantId)!;
      for (const current of items.filter(i => i.variantId === item.variantId)) {
        const old = previous.find(i => i.id === current.id && i.variantId === current.variantId);
        if (!old) continue;
        const quantity = Math.min(old.quantity, current.quantity);
        const oldParts = Array.isArray(old.financialSnapshot?.lotCosts) && old.financialSnapshot.lotCosts.length
          ? takeCosts(old.financialSnapshot.lotCosts as unknown as FrozenLotCost[], quantity)
          : pool.some(p => p.sliceId === 'historical:' + old.id) ? takeCosts(pool.filter(p => p.sliceId === 'historical:' + old.id), quantity) : [];
        removeCostParts(pool, oldParts); retained.set(current.id, oldParts);
      }
    }
    const kept = retained.get(item.id) ?? [], pool = costs.get(item.variantId)!;
    const extra = takeCosts(pool, item.quantity - kept.reduce((s,p) => s+p.quantity,0));
    removeCostParts(pool, extra);
    const parts: FrozenLotCost[] = [...kept, ...extra];
    await tx.orderItemFinancial.update({ where: { itemId: item.id }, data: { unitCostCents: null, lotCosts: parts as unknown as Prisma.InputJsonValue } });
  }
}
