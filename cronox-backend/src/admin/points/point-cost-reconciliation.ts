import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FrozenLotCost, frozenCost } from '../../inventory-lots/lot-costs';
import { pricePointParts } from './point-lot-costs';
import { PointDelta, PointState } from './point-calculations';

/** Conservative plan: never price old sales from today's product/edition.
 * Existing frozen receipt components or a dated edition audit are evidence.
 * Financially edited/returned sales need a coordinated manual reconciliation. */
export async function reconcilePointCosts(db: Pick<PrismaClient,'$transaction'>, options:{pointId?:string;apply?:boolean;actorId?:number}={}) {
  return db.$transaction(async (tx:Prisma.TransactionClient)=>{
    if(!options.apply)await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    else {
      if(!options.actorId || !await tx.user.findFirst({where:{id:options.actorId,role:'SUPERADMIN'}}))throw Error('SUPERADMIN_REQUIRED');
      await tx.$queryRaw`SELECT id FROM "SalePoint" WHERE (${options.pointId ?? null}::text IS NULL OR id=${options.pointId ?? null}) ORDER BY id FOR UPDATE`;
    }
    const entries=await tx.pointEntry.findMany({where:{pointId:options.pointId,kind:'SALE'},include:{sale:{include:{entries:true}}},orderBy:{id:'asc'}});
    const rows:Array<{entryId:string;lineIndex:number;productId:number;units:number;status:string;reason:string;costCents:number|null;evidenceIds:string[]}> = [];
    for(const entry of entries)for(const [index,original] of (entry.lines as unknown as PointDelta[]).entries()){
      const revision=await tx.inventoryPointCostRevision.findFirst({where:{entryId:entry.id,lineIndex:index},orderBy:{revision:'desc'}});
      const current=(revision?.after ?? original) as unknown as PointDelta;
      const row={entryId:entry.id,lineIndex:index,productId:current.productId,units:Math.abs(current.unitsSold),status:'PRESERVED',reason:'Coste histórico ya conocido',costCents:current.costCents,evidenceIds:[] as string[]};
      rows.push(row);if(current.costCents!==null)continue;
      row.status='PENDING';row.reason='Falta evidencia histórica de la tirada y su coste';
      const later=entry.sale?.entries.some(e=>e.kind!=='SALE' && !(e.after as {dateTransfer?:boolean}|null)?.dateTransfer && Array.isArray(e.lines) && e.lines.length);
      // A date transfer copies the old financial line too; it must be reconciled together.
      if(later || entry.sale?.entries.some(e=>(e.after as {dateTransfer?:boolean}|null)?.dateTransfer)){row.reason='Conciliar conjuntamente la venta y sus correcciones, cambios de fecha o devoluciones';continue;}
      const parts=current.lotCosts;
      if(!parts?.length || parts.some(p=>p.lotId==='unreconciled'))continue;
      const proposed:FrozenLotCost[]=[];
      for(const part of parts){
        if(frozenCost([part])!==null){proposed.push(part);continue;}
        // Complete components already captured in the sale remain the best evidence.
        const receipt=pricePointParts([part],{id:part.lotId,profile:null})[0];
        if(frozenCost([receipt])!==null){proposed.push({...receipt,costSource:'SAVED_RECEIPT_COMPONENTS'});row.evidenceIds.push(part.sliceId);continue;}
        if([part.productionCents,part.freightCents,part.otherCents].some(v=>v!==null)){proposed.push(part);continue;}
        const audit=await tx.inventoryLotAudit.findFirst({where:{lotId:part.lotId,createdAt:{lte:entry.occurredAt},after:{path:['profile'],not:Prisma.JsonNull}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
        const profile=(audit?.after as {profile?:Prisma.JsonValue}|null)?.profile ?? null;
        const priced=pricePointParts([part],{id:part.lotId,profile})[0];
        if(audit && frozenCost([priced])!==null){proposed.push({...priced,costSource:'DATED_EDITION_DEFAULT',evidenceIds:[audit.id]});row.evidenceIds.push(audit.id);}else proposed.push(part);
      }
      if(proposed.reduce((n,p)=>n+p.quantity,0)!==row.units)continue;
      const cost=frozenCost(proposed);if(cost===null)continue;
      row.status='PROPOSED';row.costCents=cost;row.reason='Componentes congelados o configuración de la tirada documentada antes de la venta';
      if(!options.apply)continue;
      const after:PointDelta={...current,lotCosts:proposed,costCents:cost};
      await tx.inventoryPointCostRevision.create({data:{id:randomUUID(),entryId:entry.id,lineIndex:index,revision:(revision?.revision ?? 0)+1,actorId:options.actorId!,reason:'Conciliación verificable de coste; evidencia: '+row.evidenceIds.join(', '),before:current as unknown as Prisma.InputJsonValue,after:after as unknown as Prisma.InputJsonValue}});
      if(entry.sale){
        const saved=await tx.pointSale.findUniqueOrThrow({where:{id:entry.sale.id}});
        const state=saved.state as unknown as PointState;
        const originalState=entry.after as unknown as PointState;
        const lineId=originalState.lines[index]?.id;
        const matching=state.lines.find(l=>l.id===lineId && l.variantId===current.variantId && l.quantity===row.units);
        if(!matching)throw Error('SALE_STATE_CHANGED');
        matching.lotCosts=proposed;matching.unitCostCents=null;matching.costSource='HISTORICAL_RECONCILIATION';
        await tx.pointSale.update({where:{id:saved.id},data:{state:state as unknown as Prisma.InputJsonValue,revision:{increment:1}}});
      }
      for(const lotId of new Set(proposed.map(p=>p.lotId)))await tx.inventoryLotAudit.create({data:{id:randomUUID(),lotId,actorId:options.actorId,reason:'Conciliar coste de venta física sin cambiar stock',after:{entryId:entry.id,lineIndex:index,evidenceIds:row.evidenceIds,costCents:cost,stockChanged:false}}});
      row.status='APPLIED';
    }
    return {apply:!!options.apply,rows,summary:Object.fromEntries(['PRESERVED','PROPOSED','PENDING','APPLIED'].map(status=>[status,rows.filter(r=>r.status===status).reduce((n,r)=>n+r.units,0)]))};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
}
