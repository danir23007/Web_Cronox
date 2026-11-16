import { Prisma } from '@prisma/client';
import { FrozenLotCost, frozenCost } from './lot-costs';
import { adjustedPointParts, pricePointParts } from '../admin/points/point-lot-costs';
import { historicalEditionCost } from '../admin/points/point-historical-evidence';

export type HistoricalLot = Prisma.InventoryLotGetPayload<{ include: { history: true; slices: true } }>;
type Allocation = { id: string; sliceId: string; productionCents: number | null; freightCents: number | null; otherCents: number | null; costQuality: string };

/** Shared evidence policy for original sold units. Never consult the active
 * product or replace a known snapshot, partial receipt, or estimated receipt. */
export function resolveHistoricalLotParts(parts: FrozenLotCost[], lots: HistoricalLot[], variantId: number, at: Date, savedCost: number | null, lineId: string, allocations: Allocation[] = []) {
  let reason = 'Falta un coste de la tirada verificable: vacío o historial contradictorio';
  const evidenceIds: string[] = [];
  const proposed: FrozenLotCost[] = [];
  for (const part of parts) {
    const lot = lots.find(l => l.id === part.lotId);
    if (frozenCost([part]) !== null) { proposed.push(part); continue; }
    const receipt = pricePointParts([part], { id: part.lotId, profile: null })[0];
    if (frozenCost([receipt]) !== null) { proposed.push({ ...receipt, costSource: 'SAVED_RECEIPT_COMPONENTS' }); evidenceIds.push(part.sliceId); continue; }
    if ([part.productionCents, part.freightCents, part.otherCents].some(v => v !== null)) { reason = 'Recepción parcialmente valorada: faltan componentes del coste'; proposed.push(part); continue; }
    const allocation = allocations.find(a => a.sliceId === part.sliceId);
    const slice = lot?.slices.find(s => s.id === part.sliceId && s.variantId === variantId);
    const evidence = allocation ?? slice;
    if (evidence) {
      const received = pricePointParts([{ ...part, productionCents: evidence.productionCents, freightCents: evidence.freightCents, otherCents: evidence.otherCents, quality: allocation?.costQuality ?? lot!.costQuality }], { id: part.lotId, profile: null })[0];
      if (frozenCost([received]) !== null) { proposed.push({ ...received, costSource: 'LINKED_RECEIPT', evidenceIds: [evidence.id] }); evidenceIds.push(evidence.id); continue; }
      if ([received.productionCents, received.freightCents, received.otherCents].some(v => v !== null) || received.quality === 'ESTIMATED') { reason = 'Recepción vinculada incompleta o estimada'; proposed.push(part); continue; }
    }
    // An estimated saved snapshot cannot become a confirmed default.
    if (part.quality === 'ESTIMATED') { reason = 'Recepción guardada estimada'; proposed.push(part); continue; }
    const historical = lot && historicalEditionCost(lot, at, savedCost);
    const receiptCosts = lot?.slices.filter(s => s.variantId === variantId && s.received > 0).map(s => [s.productionCents, s.freightCents, s.otherCents]).filter(v => v.some(n => n !== null)) ?? [];
    if (!slice && receiptCosts.length) {
      const uniform = adjustedPointParts({ ...lot!, profile: null }, variantId, part.quantity, lineId);
      if (frozenCost(uniform) !== null) { proposed.push(...uniform); evidenceIds.push(...uniform.flatMap(p => p.evidenceIds ?? [])); continue; }
      reason = 'Falta la recepción exacta de la salida histórica'; proposed.push(part); continue;
    }
    if (historical) {
      const priced = pricePointParts([part], { id: part.lotId, profile: { unitCostCents: historical.cost } })[0];
      proposed.push({ ...priced, costSource: historical.source, evidenceIds: historical.evidenceIds }); evidenceIds.push(...historical.evidenceIds);
    } else proposed.push(part);
  }
  return { parts: proposed, reason, evidenceIds };
}

export async function historicalLotParts(tx: Prisma.TransactionClient, parts: FrozenLotCost[], variantId: number, at: Date, savedCost: number | null, lineId: string) {
  if (!parts.length || frozenCost(parts) !== null) return parts;
  const lots = await tx.inventoryLot.findMany({ where: { id: { in: [...new Set(parts.map(p => p.lotId))] } }, include: { history: true, slices: true } });
  return resolveHistoricalLotParts(parts, lots, variantId, at, savedCost, lineId).parts;
}
