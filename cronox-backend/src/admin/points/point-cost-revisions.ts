import { Prisma } from '@prisma/client';
import { planPointCosts } from './point-cost-reconciliation';
import { PointDelta, PointState } from './point-calculations';
import { frozenCost } from '../../inventory-lots/lot-costs';
import { takeCosts } from '../../inventory-lots/lot-ledger';
/** Explicit financial corrections overlay the immutable point ledger. Original
 * entries and every revision remain available for audit; no extra revenue,
 * unit or stock movement is introduced by a cost correction. */
export async function applyPointCostRevisions<T extends { id: string; lines: Prisma.JsonValue }>(db: Prisma.TransactionClient, entries: T[]): Promise<T[]> {
  if (!entries.length) return entries;
  const revisions = await db.$queryRaw<Array<{ entryId: string; lineIndex: number; after: Prisma.JsonValue }>>(Prisma.sql`SELECT DISTINCT ON ("entryId","lineIndex") "entryId","lineIndex",after FROM "InventoryPointCostRevision" WHERE "entryId" IN (${Prisma.join(entries.map(e => e.id))}) ORDER BY "entryId","lineIndex",revision DESC`);
  const unresolved=entries.filter(e=>Array.isArray(e.lines) && (e.lines as unknown as PointDelta[]).some(l=>l.costCents===null));
  // Resolve sufficient historical evidence when reading, without demanding an
  // optional persisted reconciliation. Explicit revisions always win.
  const resolved: Array<{entryId:string;lineIndex:number;after:PointDelta}>=unresolved.length ? (await planPointCosts(db,{entryIds:unresolved.map(e=>e.id),projection:true})).resolved : [];
  return entries.map(entry => {
    const changes = revisions.filter(r => r.entryId === entry.id);
    const inferred=resolved.filter(r=>r.entryId===entry.id && !changes.some(c=>c.lineIndex===r.lineIndex));
    if ((!changes.length && !inferred.length) || !Array.isArray(entry.lines)) return entry;
    const lines = [...entry.lines]; for (const change of [...inferred,...changes]) lines[change.lineIndex] = change.after as unknown as Prisma.JsonValue;
    return { ...entry, lines };
  });
}

/** Presentation and subsequent edits use the same original frozen units as
 * the ledger. Never fill costs from the product's currently active edition. */
export async function pointSaleCostState(db:Prisma.TransactionClient,saleId:string,state:PointState):Promise<PointState> {
  if(!state.lines.some(l=>l.lotCosts ? frozenCost(l.lotCosts)===null : l.unitCostCents===null))return state;
  const entries=await applyPointCostRevisions(db,await db.pointEntry.findMany({where:{saleId,kind:'SALE'}}));
  const deltas=entries.flatMap(e=>e.lines as unknown as PointDelta[]);
  return {...state,lines:state.lines.map(line=>{
    if(line.lotCosts ? frozenCost(line.lotCosts)!==null : line.unitCostCents!==null)return line;
    const original=deltas.find(d=>d.lineId===line.id && d.variantId===line.variantId && d.costCents!==null && d.unitsSold>=line.quantity && d.lotCosts?.length);
    return original ? {...line,lotCosts:takeCosts(original.lotCosts!,line.quantity),costSource:'HISTORICAL_EVIDENCE'} : line;
  })};
}
