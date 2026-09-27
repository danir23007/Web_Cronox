import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const FINANCE_ZONE = 'Europe/Madrid';
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: FINANCE_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export const madridDate = (value: Date) => dateFormatter.format(value);
export const nextDate = (value: string) => new Date(Date.parse(`${value}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

export function validateRange(from: string, to: string) {
  for (const value of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Introduce fechas válidas con formato AAAA-MM-DD.');
    }
  }
  if (from > to || from < '2000-01-01' || to > '2100-12-31') throw new BadRequestException('El intervalo de fechas no es válido (2000–2100).');
}

// Resolve each midnight separately: DST days are 23/25 hours, never a fixed 24h.
export function madridMidnight(value: string): Date {
  const target = Date.parse(`${value}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: FINANCE_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const local = Date.parse(`${formatter.format(new Date(instant)).replace(' ', 'T')}Z`);
    instant += target - local;
  }
  return new Date(instant);
}

export function cents(value: Prisma.Decimal | string | number): number {
  const exact = new Prisma.Decimal(value).mul(100);
  if (!exact.isInteger() || !Number.isSafeInteger(exact.toNumber())) throw new Error('Importe histórico fuera de precisión.');
  return exact.toNumber();
}

// Largest remainder with line-ID order as tie break. BigInt avoids imprecise products.
export function allocate(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(amount) || amount < 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0) || !Number.isSafeInteger(sum)) throw new Error('Importe de reparto inválido.');
  if (!sum) return weights.map(() => 0);
  const total = BigInt(sum);
  const parts = weights.map((weight, index) => ({ index, value: Number(BigInt(amount) * BigInt(weight) / total), remainder: BigInt(amount) * BigInt(weight) % total }));
  const missing = amount - parts.reduce((sum, part) => sum + part.value, 0);
  [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1).slice(0, missing).forEach(part => part.value++);
  return parts.map(part => part.value);
}

export type FinanceLine = {
  id: number; productId: number; variantId: number | null; title: string; quantity: number; lineTotal: Prisma.Decimal | string;
  financialSnapshot?: { unitCostCents: number | null; productName: string; imageUrl: string | null } | null;
};
export type FinanceOrder = {
  id: number; status: string; currency: string; providerRef: string | null; source: string;
  paidAt: Date | null; purchasedAt: Date | null; createdAt: Date; voidedAt: Date | null;
  total: Prisma.Decimal | string; shippingCost: number; discountCents: number; disputeLostCents: number;
  items: FinanceLine[];
  stockMovements: { variantId: number; delta: number; reason: string | null; createdAt: Date }[];
};
export type FinanceEvent = {
  id: string; type: string; paymentIntentId: string | null; occurredAt: Date; lifecycleStatus: string | null;
  refundCumulativeCents: number | null; amountCents: number | null;
};
type Amounts = { revenueCents: number | null; costCents: number | null; profitCents: number | null; unitsSold: number; unitsReturned: number };
type Product = Amounts & { productId: number; name: string; imageUrl: string | null };
const empty = (): Amounts => ({ revenueCents: 0, costCents: 0, profitCents: 0, unitsSold: 0, unitsReturned: 0 });
function add(target: Amounts, revenue: number | null, cost: number | null, sold: number, returned: number) {
  target.revenueCents = target.revenueCents === null || revenue === null ? null : target.revenueCents + revenue;
  target.costCents = target.costCents === null || cost === null ? null : target.costCents + cost;
  target.profitCents = target.revenueCents === null || target.costCents === null ? null : target.revenueCents - target.costCents;
  target.unitsSold += sold;
  target.unitsReturned += returned;
  for (const value of Object.values(target)) if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('El total supera la precisión monetaria admitida.');
}

export function calculateFinance(orders: FinanceOrder[], events: FinanceEvent[], from: string, to: string, aggregation: 'days' | 'months') {
  validateRange(from, to);
  const buckets = new Map<string, Amounts>();
  const key = (date: string) => aggregation === 'months' ? date.slice(0, 7) : date;
  for (let date = from; date <= to; date = nextDate(date)) if (!buckets.has(key(date))) buckets.set(key(date), empty());
  const totals = empty();
  const products = new Map<number, Product>();
  const warnings = new Set<string>();
  const recentOrders: { id: number; paidAt: Date; totalCents: number; status: string; refundedCents: number | null }[] = [];
  const byPayment = new Map<string, FinanceEvent[]>();
  for (const event of events) {
    if (!event.paymentIntentId) continue;
    const list = byPayment.get(event.paymentIntentId) ?? [];
    list.push(event); byPayment.set(event.paymentIntentId, list);
  }
  const post = (line: FinanceLine, date: Date, revenue: number | null, cost: number | null, sold = 0, returned = 0) => {
    const day = madridDate(date);
    if (day < from || day > to) return;
    if (!products.has(line.productId)) products.set(line.productId, { ...empty(), productId: line.productId, name: line.financialSnapshot?.productName ?? line.title.replace(/ \([^)]*\)$/, ''), imageUrl: line.financialSnapshot?.imageUrl ?? null });
    add(products.get(line.productId)!, revenue, cost, sold, returned);
    add(buckets.get(key(day))!, revenue, cost, sold, returned);
    add(totals, revenue, cost, sold, returned);
    if (cost === null) warnings.add('Faltan costes históricos: el beneficio afectado no está disponible.');
    if (revenue === null) warnings.add('Hay reembolsos sin importe o reparto fiable entre productos y envío. La facturación y el beneficio afectados no están disponibles.');
  };
  for (const order of orders) {
    const ledger = [...(byPayment.get(order.providerRef ?? '') ?? [])].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.refundCumulativeCents ?? 0) - (b.refundCumulativeCents ?? 0) || a.id.localeCompare(b.id));
    const success = ledger.find(e => e.type === 'payment_intent.succeeded');
    const paidStatuses = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'REFUNDED', 'DISPUTED'];
    const qualifying = !!success || !!order.paidAt || (order.source === 'IN_PERSON_ADMIN' && !!order.purchasedAt) || paidStatuses.includes(order.status);
    if (!qualifying) continue;
    const paidAt = order.paidAt ?? success?.occurredAt ?? order.purchasedAt ?? order.createdAt;
    if (!order.paidAt && !success && !order.purchasedAt && madridDate(paidAt) >= from && madridDate(paidAt) <= to) warnings.add('Ventas antiguas sin fecha de cobro registrada: se usa la fecha de creación del pedido confirmado.');
    const lines = [...order.items].sort((a, b) => a.id - b.id);
    const gross = lines.map(line => cents(line.lineTotal));
    const discounts = allocate(order.discountCents, gross);
    const net = gross.map((amount, i) => amount - discounts[i]);
    const total = cents(order.total);
    const merchandise = net.reduce((sum, amount) => sum + amount, 0);
    const validAmounts = merchandise >= 0 && net.every(amount => amount >= 0) && merchandise + order.shippingCost === total;
    // Product costs are entered in EUR. Never silently treat euros as another currency.
    const historicalCost = (line: FinanceLine, quantity: number) => order.currency !== 'EUR' || line.financialSnapshot?.unitCostCents == null ? null : line.financialSnapshot.unitCostCents * quantity;
    if (order.currency !== 'EUR') warnings.add('Los costes se registran en EUR. El beneficio en otras monedas no está disponible sin un cambio histórico fiable.');
    lines.forEach((line, i) => post(line, paidAt, validAmounts ? net[i] : null, historicalCost(line, line.quantity), line.quantity));

    let previousRefund = 0;
    let refundUnknown = false;
    const refundEvents = ledger.filter(e => e.type === 'charge.refunded');
    const refunds = refundEvents.map(event => ({ date: event.occurredAt, amount: event.refundCumulativeCents ?? (event.lifecycleStatus === 'REFUNDED' ? total : null) }));
    if (order.voidedAt) refunds.push({ date: order.voidedAt, amount: total });
    if (order.status === 'REFUNDED' && !refundEvents.length) {
      // Never fabricate a refund date from updatedAt (fulfillment edits can change it).
      refundUnknown = true;
      warnings.add(`Pedido #${order.id}: falta el evento fechado del reembolso; los periodos posteriores al cobro están incompletos.`);
      if (madridDate(paidAt) <= to) {
        const start = from > madridDate(paidAt) ? from : madridDate(paidAt);
        // The date is unknown, so every potentially affected bucket is unknown;
        // marking just one day would incorrectly label the others as known zero.
        for (const bucket of buckets.keys()) {
          const candidate = aggregation === 'months' ? `${bucket}-01` : bucket;
          const day = candidate < start ? start : candidate;
          if (key(day) === bucket) lines.forEach(line => post(line, madridMidnight(day), null, 0));
        }
      }
    }
    for (const refund of refunds) {
      if (madridDate(refund.date) > to) continue;
      const cumulative = refund.amount;
      if (cumulative === null || cumulative > total || cumulative < 0) {
        refundUnknown = true;
        lines.forEach(line => post(line, refund.date, null, 0));
        continue;
      }
      if (cumulative <= previousRefund) continue; // cumulative ledger is idempotent even across distinct event IDs
      const full = cumulative === total;
      // Full refunds have a known final allocation. Partial refunds only have a
      // reliable product allocation for one product with no delivery charge.
      const singleProduct = new Set(lines.map(line => line.productId)).size === 1 && order.shippingCost === 0;
      if (full && previousRefund === 0 && !refundUnknown) {
        lines.forEach((line, i) => post(line, refund.date, validAmounts ? -net[i] : null, 0));
      } else if (singleProduct && !refundUnknown) {
        const amounts = allocate(cumulative - previousRefund, net);
        lines.forEach((line, i) => post(line, refund.date, validAmounts ? -amounts[i] : null, 0));
      } else {
        lines.forEach(line => post(line, refund.date, null, 0));
      }
      previousRefund = cumulative;
    }
    // Stock evidence, not the refund amount, reverses unit cost. Limit to sold quantity.
    const remaining = new Map(lines.map(line => [line.id, line.quantity]));
    for (const movement of [...order.stockMovements].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      if (movement.delta <= 0 || !['refund', 'manual_sale_void'].includes(movement.reason ?? '')) continue;
      let quantity = movement.delta;
      for (const line of lines.filter(line => line.variantId === movement.variantId)) {
        const units = Math.min(quantity, remaining.get(line.id)!);
        if (!units) continue;
        quantity -= units; remaining.set(line.id, remaining.get(line.id)! - units);
        post(line, movement.createdAt, 0, historicalCost(line, -units), 0, units);
      }
    }
    if (order.disputeLostCents > 0) {
      const lost = ledger.find(e => e.type === 'charge.dispute.closed' && (e.amountCents ?? 0) > 0);
      warnings.add(`Pedido #${order.id}: disputa perdida sin reparto por producto; importe afectado no disponible.`);
      const date = lost?.occurredAt ?? paidAt;
      lines.forEach(line => post(line, date, null, 0));
    }
    if (madridDate(paidAt) >= from && madridDate(paidAt) <= to) recentOrders.push({ id: order.id, paidAt, totalCents: total, status: order.status, refundedCents: refundUnknown ? null : previousRefund });
  }
  const allProducts = [...products.values()];
  return { totals, buckets: [...buckets].map(([date, amounts]) => ({ date, ...amounts })), products: allProducts,
    recentOrders: recentOrders.sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime() || b.id - a.id).slice(0, 5), warnings: [...warnings] };
}

export function sortProducts<T extends Product>(products: T[], sort: 'revenue' | 'profit' | 'units', direction: 'asc' | 'desc') {
  const field = { revenue: 'revenueCents', profit: 'profitCents', units: 'unitsSold' }[sort] as 'revenueCents' | 'profitCents' | 'unitsSold';
  return [...products].sort((a, b) => {
    const left = a[field], right = b[field];
    if (left === null || right === null) return left === right ? a.productId - b.productId : left === null ? 1 : -1;
    return (direction === 'asc' ? left - right : right - left) || a.productId - b.productId;
  });
}
