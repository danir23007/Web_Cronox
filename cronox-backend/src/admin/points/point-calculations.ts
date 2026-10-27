import { BadRequestException } from '@nestjs/common';
import {
  calculateFinance,
  madridDate,
  validateRange,
} from '../finance/financial-calculations';

export type PointLine = {
  id: string;
  variantId: number;
  productId: number;
  name: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  commissionBp: number;
  commissionCents: number;
  returned: number;
};
export type PointDelta = {
  productId: number;
  variantId: number;
  name: string;
  size: string;
  revenueCents: number;
  costCents: number;
  commissionCents: number;
  unitsSold: number;
  unitsReturned: number;
};
export type PointState = {
  stockHandling?: 'DEDUCT_NOW' | 'ALREADY_ADJUSTED';
  lines: PointLine[];
  note: string;
  paymentMethod: string;
};
export const commission = (revenue: number, bp: number) =>
  Number((BigInt(revenue) * BigInt(bp) + 5000n) / 10000n);
export function lineDelta(line: PointLine, sign = 1): PointDelta {
  return {
    productId: line.productId,
    variantId: line.variantId,
    name: line.name,
    size: line.size,
    revenueCents: sign * line.unitPriceCents * line.quantity,
    costCents: sign * line.unitCostCents * line.quantity,
    commissionCents: sign * line.commissionCents,
    unitsSold: sign * line.quantity,
    unitsReturned: 0,
  };
}
// datetime-local inputs are explicitly Madrid, never the server/browser timezone.
export function pointDate(value: string): Date {
  if (typeof value !== 'string')
    throw new BadRequestException('Fecha obligatoria.');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    validateRange(value.slice(0, 10), value.slice(0, 10));
    const target = Date.parse(value + ':00Z');
    const format = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    // Earliest occurrence on the autumn overlap; reject nonexistent spring times.
    for (const offset of [120, 60]) {
      const date = new Date(target - offset * 60000);
      if (
        Number.isFinite(+date) &&
        format.format(date).replace(' ', 'T') === value
      )
        return date;
    }
    throw new BadRequestException('La hora no existe en Europe/Madrid.');
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new BadRequestException('Fecha inválida.');
  validateRange(value.slice(0, 10), value.slice(0, 10));
  const date = new Date(value);
  validateRange(madridDate(date), madridDate(date));
  return date;
}
export type LedgerEntry = {
  kind: string;
  occurredAt: Date;
  lines: unknown;
  expenseCents: number;
  after?: unknown;
};
export function calculatePoints(
  entries: LedgerEntry[],
  from: string,
  to: string,
  aggregation: 'days' | 'months' = 'days',
  collectBuckets = true,
) {
  const base = calculateFinance([], [], from, to, aggregation, collectBuckets);
  const extra = () => ({
    commissionCents: 0,
    fixedExpenseCents: 0,
    salesCount: 0,
  });
  const totals = { ...base.totals, ...extra() };
  const buckets = base.buckets.map((b) => ({ ...b, ...extra() }));
  const products = new Map<
    number,
    typeof totals & { productId: number; name: string; imageUrl: null }
  >();
  const variants = new Map<
    number,
    typeof totals & {
      variantId: number;
      productId: number;
      name: string;
      size: string;
    }
  >();
  const apply = (target: typeof totals, d: PointDelta) => {
    target.revenueCents! += d.revenueCents;
    target.costCents! += d.costCents;
    target.commissionCents += d.commissionCents;
    target.profitCents! += d.revenueCents - d.costCents - d.commissionCents;
    target.unitsSold += d.unitsSold;
    target.unitsReturned += d.unitsReturned;
    if (
      Object.values(target).some(
        (v) => typeof v === 'number' && !Number.isSafeInteger(v),
      )
    )
      throw new Error('Importe fuera de precisión.');
  };
  for (const entry of entries) {
    const day = madridDate(entry.occurredAt);
    if (day < from || day > to) continue;
    const bucket = buckets.find(
      (b) => b.date === (aggregation === 'months' ? day.slice(0, 7) : day),
    )!;
    for (const target of [totals, ...(bucket ? [bucket] : [])]) {
      target.fixedExpenseCents += entry.expenseCents;
      target.profitCents! -= entry.expenseCents;
      if (entry.kind === 'SALE') target.salesCount++;
      const transfer = entry.after as { dateTransfer?: boolean; salesCountDelta?: number } | null;
      if (entry.kind === 'CORRECTION' && transfer?.dateTransfer === true && [1, -1].includes(transfer.salesCountDelta!))
        target.salesCount += transfer.salesCountDelta!;
      if(Object.values(target).some(v=>typeof v==='number'&&!Number.isSafeInteger(v)))throw new Error('Importe fuera de precisión.');
    }
    for (const d of entry.lines as PointDelta[]) {
      if (!products.has(d.productId))
        products.set(d.productId, {
          ...calculateFinance([], [], from, to, aggregation, false).totals,
          ...extra(),
          productId: d.productId,
          name: d.name,
          imageUrl: null,
        });
      if (!variants.has(d.variantId))
        variants.set(d.variantId, {
          ...calculateFinance([], [], from, to, aggregation, false).totals,
          ...extra(),
          variantId: d.variantId,
          productId: d.productId,
          name: d.name,
          size: d.size,
        });
      for (const target of [
        totals,
        ...(bucket ? [bucket] : []),
        products.get(d.productId)!,
        variants.get(d.variantId)!,
      ])
        apply(target, d);
    }
  }
  return {
    ...base,
    totals,
    buckets,
    products: [...products.values()],
    variants: [...variants.values()],
    netUnits: totals.unitsSold - totals.unitsReturned,
    cronoxCents: totals.revenueCents! - totals.commissionCents,
    averageTicketCents: totals.salesCount
      ? Math.round(totals.revenueCents! / totals.salesCount)
      : 0,
  };
}
