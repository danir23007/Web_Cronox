'use strict';
module.exports=async({db,points,admin,checks})=>{
 const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
 const {reconcilePointCosts}=require('../src/admin/points/point-cost-reconciliation');
 const {lineDelta}=require('../src/admin/points/point-calculations');
 const point=await db.salePoint.create({data:{name:'Evidence reconciliation',type:'STORE',provinceId:'28'}}),at=new Date('2026-10-25T12:00:00Z');
 const cases=[];
 async function seed(kind,cost=1375){
  const p=await db.product.create({data:{name:kind,slug:randomUUID(),price:4000,lotManaged:true,variants:{create:{size:'M',stockQty:0,sku:randomUUID()}}},include:{variants:true}});
  const v=p.variants[0],id=randomUUID(),lotId=randomUUID();
  await db.inventoryLot.create({data:{id:lotId,productId:p.id,name:'1 tirada',number:1,openingBalance:true,costQuality:'UNKNOWN',requestKey:randomUUID(),requestHash:'test',profile:{unitCostCents:cost}}});
  const line={id,lotId,productId:p.id,variantId:v.id,name:kind,size:'M',quantity:1,returned:0,unitPriceCents:4000,unitCostCents:cost,commissionBp:5000,commissionCents:2000,lotCosts:[{lotId,sliceId:'historical:'+id,quantity:1,productionCents:null,freightCents:null,otherCents:null,quality:'UNKNOWN'}]};
  if(kind==='sole edition'){delete line.lotId;delete line.lotCosts;line.unitCostCents=null;}
  if(kind==='ambiguous editions'){delete line.lotId;delete line.lotCosts;line.unitCostCents=null;await db.inventoryLot.create({data:{id:randomUUID(),productId:p.id,name:'2 tirada',number:2,openingBalance:true,costQuality:'UNKNOWN',requestKey:randomUUID(),requestHash:'test',profile:{unitCostCents:cost}}});}
  if(kind==='changed cost')await db.inventoryLotAudit.create({data:{id:randomUUID(),lotId,actorId:admin.id,reason:'Changed after sale',createdAt:new Date('2026-11-01'),before:{profile:{unitCostCents:1200}},after:{profile:{unitCostCents:1375}}}});
  if(kind==='uniform receipt')await db.inventoryLotSlice.create({data:{id:randomUUID(),lotId,variantId:v.id,received:1,available:0,productionCents:1200,freightCents:100,otherCents:75}});
  if(kind==='preserved'){delete line.lotCosts;line.unitCostCents=1100;}
  const state={stockHandling:'ALREADY_ADJUSTED',note:'Synthetic evidence test',paymentMethod:'CASH',lines:[line]};
  const sale=await db.pointSale.create({data:{pointId:point.id,soldAt:at,state}}),delta=lineDelta(line);
  await db.pointEntry.create({data:{pointId:point.id,saleId:sale.id,actorId:admin.id,kind:'SALE',occurredAt:at,requestKey:randomUUID(),requestHash:'test',description:'Synthetic historical sale',after:state,lines:[delta]}});
  cases.push({kind,saleId:sale.id});
 }
 await seed('sole edition');await seed('saved edition');await seed('zero',0);await seed('unknown',null);await seed('ambiguous editions');await seed('changed cost');await seed('uniform receipt');await seed('preserved');
 const stock=await db.inventoryLotSlice.findMany({where:{lot:{productId:{in:(await db.pointSale.findMany({where:{pointId:point.id}})).map(s=>s.state.lines[0].productId)}}},orderBy:{id:'asc'}});
 const preview=await reconcilePointCosts(db,{pointId:point.id});assert.equal(preview.summary.PROPOSED,4);assert.equal(preview.summary.PENDING,3);assert.equal(preview.summary.PRESERVED,1);
 assert.equal(preview.rows.find(r=>r.saleId===cases.find(c=>c.kind==='sole edition').saleId).profitImpactCents,625);
 assert.equal(preview.rows.find(r=>r.saleId===cases.find(c=>c.kind==='zero').saleId).costCents,0);
 assert.equal(preview.rows.find(r=>r.saleId===cases.find(c=>c.kind==='uniform receipt').saleId).costCents,1375);
 const applied=await reconcilePointCosts(db,{pointId:point.id,apply:true,actorId:admin.id});assert.equal(applied.summary.APPLIED,4);
 const count=await db.inventoryPointCostRevision.count();const replay=await reconcilePointCosts(db,{pointId:point.id,apply:true,actorId:admin.id});assert.equal(replay.summary.APPLIED,0);assert.equal(await db.inventoryPointCostRevision.count(),count);
 const after=await points.detail(point.id,'2026-10-01','2026-11-12');assert.equal(after.report.totals.pendingCostUnits,3);assert.equal(after.report.totals.knownCostCents,5225);assert.equal(after.report.totals.knownProfitCents,4775);
 assert.deepEqual(await db.inventoryLotSlice.findMany({where:{id:{in:stock.map(s=>s.id)}},orderBy:{id:'asc'}}),stock);
 checks.push('Historical reconciliation: sole edition, saved edition, explicit zero, uniform receipt, unknown/ambiguous/changed cost, preserved snapshots, profit impact, replay and unchanged stock');
};
