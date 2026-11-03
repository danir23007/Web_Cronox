import { Prisma } from '@prisma/client';
import { allocate, calculateFinance, cents, FinanceEvent, FinanceOrder, validateRange } from '../finance/financial-calculations';
import { archiveUtcDate } from '../finance/historical-cost';
import { pointLedger, pointOrderIds } from '../points/point-report';
import { PointDelta } from '../points/point-calculations';
import { frozenCost } from '../../inventory-lots/lot-costs';

export async function lotReport(tx: Prisma.TransactionClient, productId: number, from: string, to: string) {
  validateRange(from, to);
  const lots = await tx.inventoryLot.findMany({ where: { productId }, include: { slices: true }, orderBy: { createdAt: 'asc' } });
  const rows = [...lots.map((lot, i) => ({ key: i + 1, lotId: lot.id as string | null, name: lot.name, revenueCents: 0 as number | null, costCents: 0 as number | null, profitCents: 0 as number | null, unitsSold: 0, unitsReturned: 0, available: lot.slices.reduce((s,l) => s+l.available,0), stockValueCents: lot.costQuality === 'CONFIRMED' && lot.slices.every(l => l.available === 0 || l.productionCents !== null && l.freightCents !== null && l.otherCents !== null) ? lot.slices.reduce((s,l) => s+l.available*(l.productionCents!+l.freightCents!+l.otherCents!),0) : null, quality: lot.costQuality })), { key: lots.length + 1, lotId: null, name: 'Ventas pendientes de identificar lote', revenueCents: 0 as number | null, costCents: 0 as number | null, profitCents: 0 as number | null, unitsSold: 0, unitsReturned: 0, available: 0, stockValueCents: null, quality: 'UNKNOWN' }];
  const key = (id?: string) => rows.find(r => r.lotId === id)?.key ?? rows[rows.length - 1].key;
  const evidence = new Map<number, Set<string>>();
  const add = (id: number, value: { revenueCents: number | null; costCents: number | null; profitCents: number | null; unitsSold: number; unitsReturned: number }, quality?: string) => {
    const row = rows.find(r => r.key === id); if (!row) return;
    if (!evidence.has(id)) evidence.set(id,new Set()); evidence.get(id)!.add(quality ?? (value.costCents === null ? 'UNKNOWN' : 'CONFIRMED'));
    for (const field of ['revenueCents', 'costCents', 'profitCents'] as const) row[field] = row[field] === null || value[field] === null ? null : row[field]! + value[field]!;
    row.unitsSold += value.unitsSold; row.unitsReturned += value.unitsReturned;
  };
  const linked = await pointOrderIds(tx);
  let cursor = 0;
  const warnings = new Set<string>();
  for (;;) {
    const batch = await tx.financeArchive.findMany({ where: { orderId: { gt: cursor }, currency: 'EUR' }, orderBy: { orderId: 'asc' }, take: 200 });
    if (!batch.length) break;
    cursor = batch[batch.length - 1].orderId;
    for (const archive of batch) {
      if (linked.has(archive.orderId)) continue;
      const order = archive.snapshot as unknown as FinanceOrder;
      if (!order.items.some(i => i.productId === productId)) continue;
      for (const field of ['paidAt','purchasedAt','createdAt','voidedAt'] as const) if (order[field]) order[field] = archiveUtcDate(order[field]!);
      order.stockMovements = (await tx.financeStockArchive.findMany({ where: { orderId: archive.orderId } })).map(s => { const value = s.snapshot as unknown as FinanceOrder['stockMovements'][number]; return { ...value, createdAt: archiveUtcDate(value.createdAt) }; });
      const original = [...order.items].sort((a,b) => a.id-b.id);
      const discounts = allocate(order.discountCents, original.map(i => cents(i.lineTotal)));
      let id = 0;
      order.items = original.flatMap((line, index) => {
        const parts = line.financialSnapshot?.lotCosts;
        if (!parts?.length) return [{ ...line, id: ++id, physicalProductId: line.productId, productId: line.productId === productId ? key() : -line.productId, allocatedDiscountCents: discounts[index] }];
        const amounts = allocate(cents(line.lineTotal), parts.map(p => p.quantity)), reductions = allocate(discounts[index], parts.map(p => p.quantity));
        return parts.map((part, i) => ({ ...line, id: ++id, physicalProductId: line.productId, productId: line.productId === productId ? key(part.lotId) : -line.productId, quantity: part.quantity, lineTotal: new Prisma.Decimal(amounts[i]).div(100).toFixed(2), allocatedDiscountCents: reductions[i], financialSnapshot: { ...line.financialSnapshot!, lotCosts: [part] } }));
      });
      const events = (await tx.financeEventArchive.findMany({ where: { paymentIntentId: archive.providerRef ?? '' } })).map(e => ({ ...(e.snapshot as unknown as FinanceEvent), occurredAt: e.occurredAt }));
      const result = calculateFinance([order], events, from, to, 'months', false);
      result.products.forEach(p => { const qualities = order.items.filter(i => i.productId === p.productId).flatMap(i => i.financialSnapshot?.lotCosts?.map(c => c.quality) ?? [i.financialSnapshot?.unitCostCents == null ? 'UNKNOWN' : 'CONFIRMED']); add(p.productId, p, qualities.includes('UNKNOWN') ? 'UNKNOWN' : qualities.includes('ESTIMATED') ? 'ESTIMATED' : 'CONFIRMED'); }); result.warnings.forEach(w => warnings.add(w));
    }
  }
  for (const entry of await pointLedger(tx, from, to)) for (const line of entry.lines as unknown as PointDelta[]) {
    if (line.productId !== productId) continue;
    const parts = line.lotCosts;
    if (!parts?.length) { add(key(), { ...line, profitCents: line.costCents === null ? null : line.revenueCents-line.costCents-line.commissionCents }); continue; }
    const signed = (v: number) => allocate(Math.abs(v), parts.map(p => p.quantity)).map(n => Math.sign(v)*n);
    const revenues = signed(line.revenueCents), commissions = signed(line.commissionCents), units = signed(line.unitsSold), returns = signed(line.unitsReturned);
    parts.forEach((part,i) => { const own = frozenCost([part]); const cost = line.costCents === 0 ? 0 : own === null ? null : (line.unitsReturned > 0 || line.unitsSold < 0 ? -1 : 1)*own;
      add(key(part.lotId), { revenueCents: revenues[i], costCents: cost, profitCents: cost === null ? null : revenues[i]-cost-commissions[i], unitsSold: units[i], unitsReturned: returns[i] }, part.quality); });
  }
  return { from, to, rows: rows.map(({ key: _, ...r }) => ({ ...r, stockQuality: r.quality, quality: evidence.get(_)?.has('UNKNOWN') ? 'UNKNOWN' : evidence.get(_)?.has('ESTIMATED') ? 'ESTIMATED' : evidence.has(_) ? 'CONFIRMED' : r.quality, marginPercent: r.profitCents === null || !r.revenueCents ? null : r.profitCents/r.revenueCents*100 })), warnings: [...warnings], definition: 'Ingresos cobrados después de descuentos, IVA incluido y envío al cliente excluido. Costes históricos por lote. Comisiones de puntos incluidas; sus gastos fijos, sin atribución verificable a un producto, permanecen en el informe global.' };
}
