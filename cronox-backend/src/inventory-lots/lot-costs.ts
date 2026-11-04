import { BadRequestException } from '@nestjs/common';

export type LotReceiptLine = { variantId: number; quantity: number; productionCents: number | null };
export type CostSlice = LotReceiptLine & { freightCents: number | null; otherCents: number | null };

/** Split into homogeneous integer-cent slices. Remainders go to variant-ID
 * order, then unit order; no rounding loss, even when expenses < unit count. */
export function receiptSlices(lines: LotReceiptLine[], freight: number | null, other: number | null): CostSlice[] {
  if (!lines.length || lines.length > 100 || new Set(lines.map(l => l.variantId)).size !== lines.length)
    throw new BadRequestException('Indica una línea por variante.');
  const validMoney = (n: number | null) => n === null || (Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000);
  if (!validMoney(freight) || !validMoney(other) || lines.some(l => !Number.isSafeInteger(l.variantId) || l.variantId <= 0 || !Number.isSafeInteger(l.quantity) || l.quantity <= 0 || l.quantity > 100_000 || !validMoney(l.productionCents)))
    throw new BadRequestException('Cantidades o costes de lote inválidos.');
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = lines.reduce((s,l) => s + BigInt(l.quantity)*BigInt(l.productionCents ?? 0), BigInt(freight ?? 0) + BigInt(other ?? 0));
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new BadRequestException('El coste total supera la precisión admitida.');
  const result: CostSlice[] = [];
  let offset = 0;
  for (const line of [...lines].sort((a, b) => a.variantId - b.variantId)) {
    const end = offset + line.quantity;
    const boundaries = [...new Set([offset, end, ...[freight, other].filter((v): v is number => v !== null).map(v => v % count).filter(v => v > offset && v < end)])].sort((a, b) => a - b);
    const costAt = (total: number | null, i: number) => total === null ? null : Math.floor(total / count) + (i < total % count ? 1 : 0);
    for (let i = 0; i < boundaries.length - 1; i++) result.push({ ...line, quantity: boundaries[i + 1] - boundaries[i], freightCents: costAt(freight, boundaries[i]), otherCents: costAt(other, boundaries[i]) });
    offset = end;
  }
  return result;
}

export type FrozenLotCost = { lotId: string; sliceId: string; quantity: number; productionCents: number | null; freightCents: number | null; otherCents: number | null; quality: string; legacyUnitCostCents?: number | null };
export function frozenCost(parts: FrozenLotCost[]): number | null {
  if (parts.some(p => p.quality !== 'CONFIRMED' || (p.legacyUnitCostCents === undefined ? p.productionCents === null || p.freightCents === null || p.otherCents === null : p.legacyUnitCostCents === null))) return null;
  const total = parts.reduce((s, p) => s + p.quantity * (p.legacyUnitCostCents ?? (p.productionCents! + p.freightCents! + p.otherCents!)), 0);
  if (!Number.isSafeInteger(total)) throw new BadRequestException('El coste histórico supera la precisión admitida.');
  return total;
}

export function retainPhysicalIdentity(before: FrozenLotCost[] | null | undefined, corrected: FrozenLotCost[]): FrozenLotCost[] {
  const known = (before ?? []).filter(p => p.lotId !== 'unreconciled' && !p.sliceId.startsWith('historical:') && !p.sliceId.startsWith('point-historical:')).map(p => ({ ...p }));
  if (!known.length) return corrected;
  const result: FrozenLotCost[] = [];
  for (const part of corrected) {
    let remaining = part.quantity;
    for (const physical of known.filter(p => p.lotId === part.lotId)) {
      const quantity = Math.min(remaining,physical.quantity); if (!quantity) continue;
      result.push({ ...part, sliceId: physical.sliceId, quantity }); physical.quantity -= quantity; remaining -= quantity;
    }
    if (remaining) result.push({ ...part, quantity: remaining });
  }
  if (known.some(p => p.quantity)) throw new BadRequestException('Conserva los lotes físicos ya asignados al corregir los costes históricos.');
  return result;
}
