import { allocate } from '../finance/financial-calculations';
import { frozenCost } from '../../inventory-lots/lot-costs';
import type { PointDelta } from './point-calculations';

export function pointPartialCost(line: PointDelta) {
  if (line.costCents !== null) return { knownCostCents:line.costCents,knownProfitCents:line.revenueCents-line.costCents-line.commissionCents,pending:[] as {key:string;units:number}[] };
  const parts=line.lotCosts ?? [];
  const sign=line.unitsReturned>0 || line.unitsSold<0 ? -1 : 1;
  const result={knownCostCents:0,knownProfitCents:0,pending:[] as {key:string;units:number}[]};
  if(!parts.length) { result.pending.push({key:line.lineId ?? 'variant:'+line.variantId,units:sign*(Math.abs(line.unitsSold)||line.unitsReturned||1)});return result; }
  const revenues=allocate(Math.abs(line.revenueCents),parts.map(p=>p.quantity)).map(n=>Math.sign(line.revenueCents)*n);
  const fees=allocate(Math.abs(line.commissionCents),parts.map(p=>p.quantity)).map(n=>Math.sign(line.commissionCents)*n);
  parts.forEach((part,i)=>{
    const cost=frozenCost([part]);
    if(cost===null)result.pending.push({key:(line.lineId ?? String(line.variantId))+(part.sliceId.startsWith('point-historical:')? '':':'+part.sliceId),units:sign*part.quantity});
    else { result.knownCostCents+=sign*cost;result.knownProfitCents+=revenues[i]-sign*cost-fees[i]; }
  });
  return result;
}

export type PartialAmounts = { knownCostCents?: number; knownProfitCents?: number; knownCostUnits?: number; pendingCostUnits?: number; costCents?: number|null; profitCents:number|null };
/** Preserve partial evidence when point results feed Finance, Map and rankings.
 * Total cost/profit stay null until every constituent is known. */
export function mergePartialAmounts(target: PartialAmounts, value: PartialAmounts) {
  if(target.knownProfitCents === undefined && value.knownProfitCents === undefined)return;
  target.knownCostCents=(target.knownCostCents ?? target.costCents ?? 0)+(value.knownCostCents ?? value.costCents ?? 0);
  target.knownProfitCents=(target.knownProfitCents ?? target.profitCents ?? 0)+(value.knownProfitCents ?? value.profitCents ?? 0);
  target.pendingCostUnits=(target.pendingCostUnits ?? 0)+(value.pendingCostUnits ?? 0);
  target.knownCostUnits=(target.knownCostUnits ?? 0)+(value.knownCostUnits ?? 0);
}
