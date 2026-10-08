import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  calculateFinance,
  cents,
  FinanceEvent,
  FinanceOrder,
  madridDate,
  madridMidnight,
  nextDate,
  validateRange,
} from '../finance/financial-calculations';
import type { MapQuery } from './admin-map.controller';
import { classifyShipping, PROVINCES, REGIONS } from './spain-geography';

export type MapAmounts = {
  orders: number;
  units: number;
  revenueCents: number | null;
};
const empty = (): MapAmounts => ({ orders: 0, units: 0, revenueCents: 0 });
export function addAmounts(target: MapAmounts, amount: MapAmounts) {
  target.orders += amount.orders;
  target.units += amount.units;
  target.revenueCents =
    target.revenueCents === null || amount.revenueCents === null
      ? null
      : target.revenueCents + amount.revenueCents;
  if (
    [target.orders, target.units, target.revenueCents].some(
      (v) => v !== null && !Number.isSafeInteger(v),
    )
  )
    throw new Error('El total supera la precisión admitida.');
}

export function mapOrderAmounts(
  order: FinanceOrder,
  events: FinanceEvent[],
  from: string,
  to: string,
) {
  const end = madridMidnight(nextDate(to));
  const ledger = events.filter(
    (e) => e.paymentIntentId === order.providerRef && e.occurredAt < end,
  );
  const success = ledger
    .filter((e) => e.type === 'payment_intent.succeeded')
    .sort((a, b) => +a.occurredAt - +b.occurredAt)[0];
  const paidAt =
    order.paidAt ??
    success?.occurredAt ??
    (order.source === 'IN_PERSON_ADMIN' ? order.purchasedAt : null);
  if (!paidAt) return { excluded: 'undated' as const };
  if (madridDate(paidAt) < from || madridDate(paidAt) > to)
    return { excluded: 'outside' as const };
  const refunds = ledger.filter((e) => e.type === 'charge.refunded');
  const total = cents(order.total);
  const fullyRefunded =
    (order.voidedAt && order.voidedAt < end) ||
    refunds.some(
      (e) =>
        (e.refundCumulativeCents ??
          (e.lifecycleStatus === 'REFUNDED' ? total : -1)) === total,
    ) ||
    (order.status === 'REFUNDED' &&
      !events.some((e) => e.type === 'charge.refunded'));
  if (fullyRefunded) return { excluded: 'refunded' as const };
  const result = calculateFinance(
    [{ ...order, paidAt }],
    events,
    from,
    to,
    'months',
    false,
  );
  return {
    paidAt,
    amount: {
      orders: 1,
      units: result.totals.unitsSold - result.totals.unitsReturned,
      revenueCents: result.totals.revenueCents,
    },
    grossUnits: result.totals.unitsSold,
    returnedUnits: result.totals.unitsReturned,
    warnings: result.warnings.filter(
      (w) =>
        !w.includes('costes históricos') &&
        !w.includes('beneficio en otras monedas'),
    ),
  };
}

@Injectable()
export class AdminMapService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(query: MapQuery) {
    validateRange(query.from, query.to);
    const pageSize = 25;
    return this.prisma.$transaction(
      async (tx) => {
        const regions = REGIONS.map((r) => ({
          ...r,
          ...empty(),
          provinces: PROVINCES.filter((p) => p.regionId === r.id).map((p) => ({
            id: p.id,
            name: p.name,
            ...empty(),
          })),
        }));
        const groups = [
          {
            id: 'unknownSpain',
            name: 'España sin ubicación identificada',
            ...empty(),
          },
          { id: 'foreign', name: 'Fuera de España', ...empty() },
          {
            id: 'unresolved',
            name: 'País sin identificar o contradictorio',
            ...empty(),
          },
        ];
        const identified = empty(),
          total = empty();
        const financePeriod = {
          revenueCents: 0 as number | null,
          unitsSold: 0,
          unitsReturned: 0,
        };
        const warnings = new Set<string>();
        const exclusions = { undated: 0, refunded: 0 };
        const orders: {
          id: number;
          paidAt: Date;
          province: string | null;
          units: number;
          revenueCents: number | null;
          available: boolean;
        }[] = [];
        let cursor = 0,
          detailCount = 0,
          grossUnits = 0,
          returnedUnits = 0;
        while (true) {
          const batch = await tx.financeArchive.findMany({
            where: {
              currency: 'EUR',
              orderId: { gt: cursor },
              paidDate: { lte: new Date(query.to) },
              OR: [
                { lastDate: { gte: new Date(query.from) } },
                { uncertain: true },
              ],
            },
            orderBy: { orderId: 'asc' },
            take: 200,
          });
          if (!batch.length) break;
          cursor = batch[batch.length - 1].orderId;
          const ids = batch.map((row) => row.orderId);
          const refs = batch.flatMap((row) =>
            row.providerRef ? [row.providerRef] : [],
          );
          const [live, eventRows, stockRows] = await Promise.all([
            tx.order.findMany({
              where: { id: { in: ids } },
              select: { id: true, shippingAddr: true },
            }),
            tx.financeEventArchive.findMany({
              where: { paymentIntentId: { in: refs } },
            }),
            tx.financeStockArchive.findMany({
              where: { orderId: { in: ids } },
            }),
          ]);
          const shipping = new Map(
            live.map((row) => [row.id, row.shippingAddr]),
          );
          const events = new Map<string, FinanceEvent[]>();
          for (const row of eventRows) {
            if (!row.paymentIntentId) continue;
            const list = events.get(row.paymentIntentId) ?? [];
            list.push({
              ...(row.snapshot as unknown as FinanceEvent),
              occurredAt: row.occurredAt,
            });
            events.set(row.paymentIntentId, list);
          }
          const movements = new Map<number, FinanceOrder['stockMovements']>();
          for (const row of stockRows) {
            const list = movements.get(row.orderId) ?? [];
            list.push({
              ...(row.snapshot as unknown as FinanceOrder['stockMovements'][number]),
              createdAt: row.createdAt,
            });
            movements.set(row.orderId, list);
          }
          for (const row of batch) {
            const order = { ...(row.snapshot as unknown as FinanceOrder) };
            for (const key of [
              'paidAt',
              'purchasedAt',
              'createdAt',
              'voidedAt',
            ] as const)
              if (order[key]) order[key] = new Date(order[key]);
            order.stockMovements = movements.get(row.orderId) ?? [];
            const ledger = events.get(row.providerRef ?? '') ?? [];
            const financial = calculateFinance(
              [order],
              ledger,
              query.from,
              query.to,
              'months',
              false,
            ).totals;
            financePeriod.revenueCents =
              financePeriod.revenueCents === null ||
              financial.revenueCents === null
                ? null
                : financePeriod.revenueCents + financial.revenueCents;
            financePeriod.unitsSold += financial.unitsSold;
            financePeriod.unitsReturned += financial.unitsReturned;
            const value = mapOrderAmounts(order, ledger, query.from, query.to);
            if (value.excluded) {
              if (
                value.excluded !== 'outside' &&
                row.paidDate >= new Date(query.from)
              )
                exclusions[value.excluded]++;
              continue;
            }
            value.warnings.forEach((w) => {
              if (warnings.size < 20) warnings.add(w);
            });
            const location = classifyShipping(shipping.get(row.orderId));
            if (location.reason) warnings.add(location.reason);
            addAmounts(total, value.amount);
            grossUnits += value.grossUnits;
            returnedUnits += value.returnedUnits;
            if (location.group === 'identified') {
              addAmounts(identified, value.amount);
              const region = regions.find((r) => r.id === location.regionId)!;
              addAmounts(region, value.amount);
              addAmounts(
                region.provinces.find((p) => p.id === location.provinceId)!,
                value.amount,
              );
            } else
              addAmounts(
                groups.find((g) => g.id === location.group)!,
                value.amount,
              );
            if (
              query.region &&
              query.region === (location.regionId ?? location.group)
            ) {
              if (
                detailCount >= (query.page - 1) * pageSize &&
                orders.length < pageSize
              )
                orders.push({
                  id: row.orderId,
                  paidAt: value.paidAt,
                  province:
                    PROVINCES.find((p) => p.id === location.provinceId)?.name ??
                    null,
                  units: value.amount.units,
                  revenueCents: value.amount.revenueCents,
                  available: shipping.has(row.orderId),
                });
              detailCount++;
            }
          }
        }
        if (
          query.region &&
          query.page > Math.max(1, Math.ceil(detailCount / pageSize))
        )
          throw new BadRequestException(
            'La página solicitada no existe. Selecciona de nuevo el destino.',
          );
        if (
          Object.values(financePeriod).some(
            (value) => value !== null && !Number.isSafeInteger(value),
          )
        )
          throw new Error('El total supera la precisión admitida.');
        return {
          regions,
          groups,
          identified,
          total,
          orders,
          exclusions,
          warnings: [...warnings],
          reconciliation: {
            grossUnits,
            returnedUnits,
            netUnits: total.units,
            revenueCents: total.revenueCents,
            financePeriod,
            revenueDifferenceCents:
              total.revenueCents === null || financePeriod.revenueCents === null
                ? null
                : total.revenueCents - financePeriod.revenueCents,
          },
          pagination: {
            page: query.page,
            pageSize,
            total: detailCount,
            pages: Math.max(1, Math.ceil(detailCount / pageSize)),
          },
          range: { from: query.from, to: query.to, timeZone: 'Europe/Madrid' },
          currency: 'EUR',
          basis:
            'Productos después de descuentos, IVA incluido y envío excluido; solo EUR. Unidades netas = vendidas − devoluciones con reposición registrada. Un reembolso monetario no implica unidades devueltas. Pedidos seleccionados por fecha de cobro; reembolsos y devoluciones registrados hasta el final del intervalo. Se excluyen los totalmente reembolsados. Misma fórmula que Finanzas para este conjunto de pedidos; Finanzas también incluye devoluciones del período de ventas cobradas en fechas anteriores. Los importes sin reparto fiable se muestran como no disponibles.',
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 60000,
      },
    );
  }
}
