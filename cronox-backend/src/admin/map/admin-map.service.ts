import { countsInStatistics } from '../../common/statistics-eligibility';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  calculateFinance,
  FinanceEvent,
  FinanceOrder,
  validateRange,
} from '../finance/financial-calculations';
import type { MapQuery } from './admin-map.controller';
import { archiveUtcDate } from '../finance/historical-cost';
import { classifyShipping, PROVINCES, REGIONS } from './spain-geography';
import { pointLedger, pointOrderIds } from '../points/point-report';
import { pointLocation } from '../points/point-geography';
import { calculatePoints } from '../points/point-calculations';

export type MapAmounts = {
  orders: number;
  units: number;
  revenueCents: number | null;
  profitCents: number | null;
};
const empty = (): MapAmounts => ({ orders: 0, units: 0, revenueCents: 0, profitCents:0 });
export function addAmounts(target: MapAmounts, amount: MapAmounts) {
  target.orders += amount.orders;
  target.units += amount.units;
  target.revenueCents =
    target.revenueCents === null || amount.revenueCents === null
      ? null
      : target.revenueCents + amount.revenueCents;
  target.profitCents=target.profitCents===null||amount.profitCents===null?null:target.profitCents+amount.profitCents;
  if (
    [target.orders, target.units, target.revenueCents,target.profitCents].some(
      (v) => v !== null && !Number.isSafeInteger(v),
    )
  )
    throw new Error('El total supera la precisión admitida.');
}

export function mapOrderAmounts(order: FinanceOrder, events: FinanceEvent[], from: string, to: string) {
  if (!countsInStatistics(order)) return { excluded: 'outside' as const };
  const calculated=calculateFinance([order],events,from,to,'months',false),financial=calculated.totals;
  const success=events.filter(e=>e.paymentIntentId===order.providerRef&&e.type==='payment_intent.succeeded').sort((a,b)=>+a.occurredAt-+b.occurredAt||a.id.localeCompare(b.id))[0];
  const paidAt=order.source==='IN_PERSON_ADMIN'?order.purchasedAt??order.createdAt:order.paidAt??success?.occurredAt??order.purchasedAt??order.createdAt;
  const amount={orders:calculated.recentOrders.some(o=>o.id===order.id)?1:0,units:financial.unitsSold-financial.unitsReturned,revenueCents:financial.revenueCents,profitCents:financial.profitCents};
  if(Object.values(amount).every(v=>v===0))return {excluded:'outside' as const};
  return {paidAt,amount,grossUnits:financial.unitsSold,returnedUnits:financial.unitsReturned,warnings:calculated.warnings};
}

@Injectable()
export class AdminMapService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(query: MapQuery) {
    validateRange(query.from, query.to);
    const division = query.division ?? 'provinces';
    if (
      query.region &&
      /^\d+$/.test(query.region) &&
      !(division === 'provinces' ? PROVINCES : REGIONS).some(
        (r) => r.id === query.region,
      )
    )
      throw new BadRequestException(
        'El territorio no pertenece a la división seleccionada.',
      );
    const pageSize = 25;
    return this.prisma.$transaction(
      async (tx) => {
        const regions = REGIONS.map((r) => ({
          ...r,
          ...empty(),
          unassignedProvince: empty(),
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
          profitCents:0 as number|null,
          unitsSold: 0,
          unitsReturned: 0,
        };
        const warnings = new Set<string>();
        const exclusions = { undated: 0, refunded: 0 };
        const orders: {
          id: number | string;
          paidAt: Date;
          province: string | null;
          units: number;
          revenueCents: number | null;
          available: boolean;
          profitCents:number|null;
          pointId?: string;
          pointName?:string;
          source?:'order'|'point';
        }[] = [];
        let cursor = 0,
          detailCount = 0,
          grossUnits = 0,
          returnedUnits = 0;
        const linkedOrders=await pointOrderIds(tx);
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
            if (!countsInStatistics(order) || linkedOrders.has(row.orderId)) continue;
            for (const key of [
              'paidAt',
              'purchasedAt',
              'createdAt',
              'voidedAt',
            ] as const)
              if (order[key]) order[key] = archiveUtcDate(order[key]);
            order.stockMovements = movements.get(row.orderId) ?? [];
            const ledger = events.get(row.providerRef ?? '') ?? [];
            const value=mapOrderAmounts(order,ledger,query.from,query.to);
            if('excluded' in value)continue;
            financePeriod.revenueCents=financePeriod.revenueCents===null||value.amount.revenueCents===null?null:financePeriod.revenueCents+value.amount.revenueCents;
            financePeriod.profitCents=financePeriod.profitCents===null||value.amount.profitCents===null?null:financePeriod.profitCents+value.amount.profitCents;
            financePeriod.unitsSold+=value.grossUnits;
            financePeriod.unitsReturned+=value.returnedUnits;
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
                location.provinceId
                  ? region.provinces.find((p) => p.id === location.provinceId)!
                  : region.unassignedProvince,
                value.amount,
              );
            } else
              addAmounts(
                groups.find((g) => g.id === location.group)!,
                value.amount,
              );
            if (
              query.region &&
              (query.region ===
                (division === 'provinces'
                  ? (location.provinceId ?? location.group)
                  : (location.regionId ?? location.group)) ||
                (location.regionId &&
                  !location.provinceId &&
                  query.region === `communityOnly:${location.regionId}`))
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
                  profitCents:value.amount.profitCents,source:'order',
                });
              detailCount++;
            }
          }
        }
        const entries=await pointLedger(tx,query.from,query.to);
        const external=calculatePoints(entries,query.from,query.to,'months',false);
        financePeriod.revenueCents=financePeriod.revenueCents===null?null:financePeriod.revenueCents+external.totals.revenueCents!;
        financePeriod.profitCents=financePeriod.profitCents===null?null:financePeriod.profitCents+external.totals.profitCents!;
        financePeriod.unitsSold+=external.totals.unitsSold;financePeriod.unitsReturned+=external.totals.unitsReturned;
        for(const entry of entries){
          const stats=calculatePoints([entry],query.from,query.to,'months',false),t=stats.totals;
          const amount={orders:t.salesCount,units:t.unitsSold-t.unitsReturned,revenueCents:t.revenueCents,profitCents:t.profitCents};
          if(Object.values(amount).every(v=>v===0))continue;
          const location=pointLocation(entry.point);
          addAmounts(total,amount);grossUnits+=t.unitsSold;returnedUnits+=t.unitsReturned;
          if(location.group==='identified'){
            addAmounts(identified,amount);const region=regions.find(r=>r.id===location.regionId)!;addAmounts(region,amount);addAmounts(region.provinces.find(p=>p.id===location.provinceId)!,amount);
          }else addAmounts(groups.find(g=>g.id==='unknownSpain')!,amount);
          if(query.region===(division==='provinces'?(location.provinceId??location.group):(location.regionId??location.group))){
            if(detailCount>=(query.page-1)*pageSize&&orders.length<pageSize)orders.push({id:entry.id,source:'point',pointId:entry.pointId,pointName:entry.point.name,paidAt:entry.occurredAt,province:PROVINCES.find(p=>p.id===location.provinceId)?.name??null,units:amount.units,revenueCents:amount.revenueCents,profitCents:amount.profitCents,available:true});
            detailCount++;
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
          division,
          provinces: regions.flatMap((r) =>
            r.provinces.map((p) => ({
              ...p,
              regionId: r.id,
              regionName: r.name,
            })),
          ),
          communityOnly: regions.map((r) => ({
            id: `communityOnly:${r.id}`,
            regionId: r.id,
            name: `${r.name} · provincia sin identificar`,
            ...r.unassignedProvince,
          })),
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
            'Ventas web y físicas en EUR, después de descuentos, IVA incluido y envío excluido. Mismo criterio temporal que Finanzas: cobros por su fecha; ajustes, devoluciones y gastos por la fecha del movimiento, incluso de ventas anteriores. Unidades netas = vendidas menos devoluciones documentadas; un reembolso monetario no implica unidades devueltas. Beneficio neto = facturación menos costes históricos; en puntos también resta comisiones y gastos fijos, una sola vez. El número cuenta ventas/pedidos registrados, no prendas. Los pedidos vinculados a una venta física se incluyen una sola vez desde su libro de movimientos. Domicilio del pedido para web; provincia guardada en el punto para ventas físicas. Corregir esa provincia reasigna todo su historial sin alterar importes. Los puntos eliminados con historial siguen incluidos. Datos sin ubicación o coste fiable no se inventan.',
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 60000,
      },
    );
  }
}
