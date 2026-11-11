import { Prisma } from '@prisma/client';
import { configuredManualCost } from '../finance/historical-cost';

type Audit = { id:string; createdAt:Date; before:Prisma.JsonValue|null; after:Prisma.JsonValue };
type Edition = { id:string; number:number|null; openingBalance:boolean; createdAt:Date; receivedAt:Date|null; profile:Prisma.JsonValue|null; history:Audit[] };
const profileCost=(value:Prisma.JsonValue|null) => configuredManualCost({unitCostCents:(value as {unitCostCents?:number|null}|null)?.unitCostCents ?? null});
const auditProfile=(value:Prisma.JsonValue|null) => (value as {profile?:Prisma.JsonValue}|null)?.profile ?? null;

/** A migration opening balance represents earlier stock, not a new receipt.
 * Infer only one applicable edition; never substitute the active edition. */
export function historicalEdition(lots:Edition[], at:Date, savedId?:string) {
  const candidates=lots.filter(l=>savedId ? l.id===savedId :
    l.openingBalance || (l.receivedAt ? l.receivedAt<=at : l.createdAt<=at));
  return candidates.length===1 ? candidates[0] : null;
}

/** Dated configuration wins. Otherwise the configured edition default is
 * usable only with a consistent history and no conflicting saved sale cost.
 * This explicitly includes zero and excludes an empty field. */
export function historicalEditionCost(lot:Edition, at:Date, savedCost:number|null) {
  const history=[...lot.history].sort((a,b)=>+a.createdAt-+b.createdAt || a.id.localeCompare(b.id));
  const dated=history.filter(a=>a.createdAt<=at && auditProfile(a.after)!==null).at(-1);
  if(dated) {
    const cost=profileCost(auditProfile(dated.after));
    return cost===null ? null : {cost,source:'DATED_EDITION_DEFAULT',evidenceIds:[dated.id]};
  }
  const cost=profileCost(lot.profile);
  if(cost===null || (savedCost!==null && savedCost!==cost))return null;
  for(const audit of history)for(const snapshot of [audit.before,audit.after]) {
    const profile=auditProfile(snapshot);
    if(profile!==null && profileCost(profile)!==cost)return null;
  }
  return {cost,source:savedCost!==null?'SAVED_SALE_EDITION_DEFAULT':'STABLE_EDITION_DEFAULT',evidenceIds:[lot.id,...history.map(a=>a.id)]};
}
