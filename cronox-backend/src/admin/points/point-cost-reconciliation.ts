import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FrozenLotCost, frozenCost } from '../../inventory-lots/lot-costs';
import { resolveHistoricalLotParts } from '../../inventory-lots/historical-lot-cost';
import { pointPartialCost } from './point-partial-cost';
import { PointDelta, PointState } from './point-calculations';
import { historicalEdition } from './point-historical-evidence';

/** Recover from saved receipts, allocations and edition history, never from
 * the active edition of a different sale.
 * Financially edited/returned sales need a coordinated manual reconciliation. */
export async function reconcilePointCosts(db: Pick<PrismaClient,'$transaction'>, options:{pointId?:string;apply?:boolean;actorId?:number}={}) {
  return db.$transaction(async (tx:Prisma.TransactionClient)=>{
    if(!options.apply)await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    else {
      if(!options.actorId || !await tx.user.findFirst({where:{id:options.actorId,role:'SUPERADMIN'}}))throw Error('SUPERADMIN_REQUIRED');
      await tx.$queryRaw`SELECT id FROM "SalePoint" WHERE (${options.pointId ?? null}::text IS NULL OR id=${options.pointId ?? null}) ORDER BY id FOR UPDATE`;
    }
    return pointCostPlan(tx,options);
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
}

/** Read projection shares the reconciliation evidence policy, without exposing
 * its write mode. Applying revisions still requires the authorised wrapper. */
export function planPointCosts(tx:Prisma.TransactionClient, options:{entryIds:string[];projection:true}) {
  return pointCostPlan(tx,options);
}

async function pointCostPlan(tx:Prisma.TransactionClient, options:{pointId?:string;entryIds?:string[];apply?:boolean;actorId?:number;projection?:boolean}={}) {
    const resolved:Array<{entryId:string;lineIndex:number;after:PointDelta}>=[];
    const entries=await tx.pointEntry.findMany({where:{pointId:options.pointId,id:options.entryIds ? {in:options.entryIds}:undefined,kind:'SALE'},include:{sale:{include:{entries:true}}},orderBy:{id:'asc'}});
    const rows:Array<{entryId:string;saleId:string|null;date:string;lineIndex:number;productId:number;product:string;size:string;units:number;lotIds:string[];editionNumbers:(number|null)[];status:string;reason:string;previousCostCents:number|null;costCents:number|null;profitImpactCents:number|null;recoveredProfitCents:number|null;sources:string[];evidenceIds:string[]}> = [];
    for(const entry of entries)for(const [index,original] of (entry.lines as unknown as PointDelta[]).entries()){
      const revision=await tx.inventoryPointCostRevision.findFirst({where:{entryId:entry.id,lineIndex:index},orderBy:{revision:'desc'}});
      const current=(revision?.after ?? original) as unknown as PointDelta;
      const row={entryId:entry.id,saleId:entry.saleId,date:entry.occurredAt.toISOString(),lineIndex:index,productId:current.productId,product:current.name,size:current.size,units:Math.abs(current.unitsSold),lotIds:[] as string[],editionNumbers:[] as (number|null)[],status:'PRESERVED',reason:'Coste histórico ya conocido',previousCostCents:current.costCents,costCents:current.costCents,profitImpactCents:null as number|null,recoveredProfitCents:null as number|null,sources:[] as string[],evidenceIds:[] as string[]};
      rows.push(row);if(current.costCents!==null)continue;
      row.status='PENDING';row.reason='Falta evidencia histórica de la tirada y su coste';
      const later=entry.sale?.entries.some(e=>e.kind!=='SALE' && !(e.after as {dateTransfer?:boolean}|null)?.dateTransfer && Array.isArray(e.lines) && e.lines.length);
      // A date transfer copies the old financial line too; it must be reconciled together.
      if((later || entry.sale?.entries.some(e=>(e.after as {dateTransfer?:boolean}|null)?.dateTransfer)) && !(options.projection && entry.sale?.entries.filter(e=>e.kind!=='SALE').every(e=>Array.isArray(e.lines) && (e.lines as unknown as PointDelta[]).every(l=>l.costCents!==null)))){row.reason='Conciliar conjuntamente la venta y sus correcciones, cambios de fecha o devoluciones';continue;}
      const snapshot=entry.after as unknown as PointState;
      const savedLine=snapshot?.lines?.find(l=>l.id===current.lineId) ?? snapshot?.lines?.[index];
      if(!savedLine || savedLine.variantId!==current.variantId){row.reason='Falta la línea original que identifica las unidades';continue;}
      const lots=await tx.inventoryLot.findMany({where:{productId:current.productId},include:{history:true,slices:true}});
      const allocations=entry.saleId ? await tx.inventoryLotAllocation.findMany({where:{sourceKey:entry.sale?.orderId?'order:'+entry.sale.orderId:'point:'+entry.saleId,slice:{variantId:current.variantId}},include:{slice:true}}) : [];
      let parts=current.lotCosts;
      if(!parts?.length || parts.some(p=>p.lotId==='unreconciled')) {
        if(allocations.length && allocations.reduce((n,a)=>n+a.quantity,0)===row.units)
          parts=allocations.map(a=>({lotId:a.slice.lotId,sliceId:a.sliceId,quantity:a.quantity,productionCents:a.productionCents,freightCents:a.freightCents,otherCents:a.otherCents,quality:a.costQuality}));
        else {
          const lot=historicalEdition(lots,entry.occurredAt,savedLine.lotId);
          if(!lot){row.reason='Falta una salida vinculada o una tirada única aplicable en la fecha de venta';continue;}
          parts=[{lotId:lot.id,sliceId:'historical:'+savedLine.id,quantity:row.units,productionCents:null,freightCents:null,otherCents:null,quality:'UNKNOWN'}];
        }
      }
      const resolution=resolveHistoricalLotParts(parts,lots,current.variantId,entry.occurredAt,savedLine.unitCostCents ?? null,savedLine.id,allocations);
      const proposed=resolution.parts;
      row.reason=resolution.reason;row.evidenceIds.push(...resolution.evidenceIds);
      for(const part of parts){row.lotIds.push(part.lotId);row.editionNumbers.push(lots.find(l=>l.id===part.lotId)?.number ?? null);}
      if(proposed.reduce((n,p)=>n+p.quantity,0)!==row.units){row.reason='La cantidad de las asignaciones no coincide con la venta original';continue;}
      const cost=frozenCost(proposed);if(cost===null)continue;
      row.status='PROPOSED';row.costCents=cost;row.sources=[...new Set(proposed.map(p=>p.costSource ?? 'RECEIPT'))];row.evidenceIds=[...new Set(row.evidenceIds)];
      row.recoveredProfitCents=current.revenueCents-current.commissionCents-cost;
      row.profitImpactCents=row.recoveredProfitCents-pointPartialCost(current).knownProfitCents;
      row.reason='Coste de las unidades originales acreditado por '+row.sources.join(', ');
      const after:PointDelta={...current,lineId:current.lineId ?? savedLine.id,lotCosts:proposed,costCents:cost};
      resolved.push({entryId:entry.id,lineIndex:index,after});
      if(!options.apply)continue;
      await tx.inventoryPointCostRevision.create({data:{id:randomUUID(),entryId:entry.id,lineIndex:index,revision:(revision?.revision ?? 0)+1,actorId:options.actorId!,reason:'Conciliación verificable de coste; evidencia: '+row.evidenceIds.join(', '),before:current as unknown as Prisma.InputJsonValue,after:after as unknown as Prisma.InputJsonValue}});
      if(entry.sale){
        const saved=await tx.pointSale.findUniqueOrThrow({where:{id:entry.sale.id}});
        const state=saved.state as unknown as PointState;
        const originalState=entry.after as unknown as PointState;
        const lineId=originalState.lines[index]?.id;
        const matching=state.lines.find(l=>l.id===lineId && l.variantId===current.variantId && l.quantity===row.units);
        if(!matching)throw Error('SALE_STATE_CHANGED');
        matching.lotCosts=proposed;matching.lotId=proposed.every(p=>p.lotId===proposed[0].lotId)?proposed[0].lotId:matching.lotId;matching.unitCostCents=null;matching.costSource='HISTORICAL_RECONCILIATION';
        await tx.pointSale.update({where:{id:saved.id},data:{state:state as unknown as Prisma.InputJsonValue,revision:{increment:1}}});
      }
      for(const lotId of new Set(proposed.map(p=>p.lotId)))await tx.inventoryLotAudit.create({data:{id:randomUUID(),lotId,actorId:options.actorId,reason:'Conciliar coste de venta física sin cambiar stock',after:{entryId:entry.id,lineIndex:index,evidenceIds:row.evidenceIds,costCents:cost,stockChanged:false}}});
      row.status='APPLIED';
    }
    return {apply:!!options.apply,rows,resolved,summary:Object.fromEntries(['PRESERVED','PROPOSED','PENDING','APPLIED'].map(status=>[status,rows.filter(r=>r.status===status).reduce((n,r)=>n+r.units,0)]))};
}
