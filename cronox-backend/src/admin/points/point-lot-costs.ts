import { Prisma } from '@prisma/client';
import { FrozenLotCost, frozenCost } from '../../inventory-lots/lot-costs';
import { configuredManualCost } from '../finance/historical-cost';

type Lot = { id: string; profile: Prisma.JsonValue | null; costQuality: string; slices: { id: string; variantId: number; received: number; available: number; productionCents: number | null; freightCents: number | null; otherCents: number | null }[] };
/** Defaults belong to the chosen edition. They include freight already, and
 * never overwrite even a partially recorded receipt or a frozen sale. */
export function pricePointParts(parts: FrozenLotCost[], lot: Pick<Lot, 'id' | 'profile'>): FrozenLotCost[] {
  const profile = lot.profile as { unitCostCents?: number | null } | null;
  const fallback = configuredManualCost({unitCostCents:profile?.unitCostCents ?? null});
  return parts.map(part => {
    if (part.quality === 'CONFIRMED' && frozenCost([part]) !== null) return { ...part, costSource: part.costSource ?? 'RECEIPT' };
    const values = [part.productionCents, part.freightCents, part.otherCents];
    if (part.quality === 'UNKNOWN' && values.every(v => v !== null)) return { ...part, quality: 'CONFIRMED', costSource: 'RECEIPT' };
    if (part.quality === 'UNKNOWN' && part.lotId === lot.id && values.every(v => v === null) && fallback !== null)
      return { ...part, productionCents: fallback, freightCents: 0, otherCents: 0, quality: 'CONFIRMED', costSource: 'EDITION_DEFAULT' };
    return { ...part, costSource: part.costSource ?? 'PENDING' };
  });
}

/** Without a linked withdrawal, heterogeneous receipts cannot identify which
 * units left stock. A uniform receipt or an edition-specific default can. No
 * stock allocation is created or claimed by this financial snapshot. */
export function adjustedPointParts(lot: Lot, variantId: number, quantity: number, lineId: string): FrozenLotCost[] {
  if (!quantity) return [];
  const slices = lot.slices.filter(s => s.variantId === variantId && s.received > 0);
  const parts = slices.map(s => ({ lotId: lot.id, sliceId: s.id, quantity: 1, productionCents: s.productionCents, freightCents: s.freightCents, otherCents: s.otherCents, quality: lot.costQuality }));
  const complete = parts.map(p => pricePointParts([p], { ...lot, profile: null })[0]);
  const totals = complete.map(p => frozenCost([p]));
  if (complete.length && totals.every(n => n !== null && n === totals[0]))
    return [{ ...complete[0], sliceId: 'historical:' + lineId, quantity, costSource: 'UNIFORM_EDITION_RECEIPT', evidenceIds: slices.map(s => s.id) }];
  const unknown: FrozenLotCost = { lotId: lot.id, sliceId: 'historical:' + lineId, quantity, productionCents: null, freightCents: null, otherCents: null, quality: 'UNKNOWN', costSource: 'PENDING' };
  // An incomplete receipt or conflicting known receipt is not a blank opening balance.
  if (parts.some(p => [p.productionCents,p.freightCents,p.otherCents].some(v => v !== null) || p.quality === 'ESTIMATED')) return [unknown];
  return pricePointParts([unknown], lot);
}

export function pointLotOption(lot: Lot, variantId: number) {
  const availableCosts = pricePointParts(lot.slices.filter(s => s.variantId === variantId && s.available > 0).sort((a,b)=>a.id.localeCompare(b.id)).map(s => ({ lotId:lot.id,sliceId:s.id,quantity:s.available,productionCents:s.productionCents,freightCents:s.freightCents,otherCents:s.otherCents,quality:lot.costQuality })), lot);
  return { availableCosts, adjustedUnitCostCents: frozenCost(adjustedPointParts(lot,variantId,1,'preview')) };
}
