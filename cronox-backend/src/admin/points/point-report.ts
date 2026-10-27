import type { Prisma } from '@prisma/client';
import { countsInStatistics } from '../../common/statistics-eligibility';
import { madridMidnight, nextDate } from '../finance/financial-calculations';

export const pointEntryIncluded = (entry: { sale?: { order?: { source: string; excludedFromStatistics: boolean } | null } | null }) =>
  !entry.sale?.order || countsInStatistics(entry.sale.order);

// The same immutable ledger powers point details, Finance and Map. Archived or
// logically deleted points remain included; only the live operational list hides them.
export async function pointLedger(tx: Prisma.TransactionClient, from: string, to: string, pointId?: string) {
  const entries = await tx.pointEntry.findMany({where:{pointId,occurredAt:{gte:madridMidnight(from),lt:madridMidnight(nextDate(to))}},
    include:{point:true,sale:{select:{orderId:true,order:{select:{source:true,excludedFromStatistics:true}}}}},
    orderBy:[{occurredAt:'asc'},{id:'asc'}]});
  return entries.filter(pointEntryIncluded);
}
export async function pointOrderIds(tx: Prisma.TransactionClient) {
  const sales=await tx.pointSale.findMany({where:{orderId:{not:null},entries:{some:{kind:'SALE'}}},select:{orderId:true}});
  return new Set(sales.flatMap(s=>s.orderId===null?[]:[s.orderId]));
}
