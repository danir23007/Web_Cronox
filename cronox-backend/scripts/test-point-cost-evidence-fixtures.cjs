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
  await db.inventoryLot.create({data:{id:lotId,productId:p.id,name:'1 tirada',number:1,openingBalance:true,costQuality:'UNKNOWN',requestKey:randomUUID(),requestHash:'test',profile:{unitCostCents:cost,variants:[{id:v.id,size:v.size,stockQty:0}]}}});
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
 // The report must not require these optional persisted revisions. It should
 // derive exactly the same eligible costs on the original, untouched records.
 const originalSales=await db.pointSale.findMany({where:{pointId:point.id},orderBy:{id:'asc'}});
 const originalEntries=await db.pointEntry.findMany({where:{pointId:point.id},orderBy:{id:'asc'}});
 const read=await points.detail(point.id,'2026-10-01','2026-11-12');
 assert.equal(read.report.totals.pendingCostUnits,3);assert.equal(read.report.totals.knownCostCents,5225);assert.equal(read.report.totals.knownProfitCents,4775);
 assert.deepEqual((await points.detail(point.id,'2026-10-01','2026-11-12')).report,read.report);
 assert.deepEqual(await db.pointSale.findMany({where:{pointId:point.id},orderBy:{id:'asc'}}),originalSales);
 assert.deepEqual(await db.pointEntry.findMany({where:{pointId:point.id},orderBy:{id:'asc'}}),originalEntries);
 // Check every point and the unfiltered general report on the same dates.
 // This includes genuine unknown, explicit zero and recovered historical costs.
 const {AdminFinanceService}=require('../src/admin/finance/admin-finance.service');
 const finance=new AdminFinanceService(db),query={from:'2026-10-01',to:'2026-11-12',source:'points',currency:'EUR',aggregation:'days',sort:'revenue',direction:'desc',search:'',page:1};
 const allPoints=await db.salePoint.findMany(),details=await Promise.all(allPoints.map(p=>points.detail(p.id,query.from,query.to)));
 const general=await finance.getReport(query);
 for(const field of ['revenueCents','knownCostCents','knownProfitCents','pendingCostUnits','knownCostUnits','unitsSold','unitsReturned'])
  assert.equal(general.totals[field],details.reduce((n,d)=>n+d.report.totals[field],0),'General/individual mismatch: '+field);
 for(const field of ['costCents','profitCents'])assert.equal(general.totals[field],details.some(d=>d.report.totals[field]===null)?null:details.reduce((n,d)=>n+d.report.totals[field],0));
 const list=(await points.list('Evidence reconciliation'))[0];
 for(const field of ['costCents','profitCents','knownCostCents','knownProfitCents','pendingCostUnits'])assert.equal(list.totals[field],read.report.totals[field],'Point list bypassed history: '+field);
 const filtered=await finance.getReport({...query,pointId:point.id});
 for(const field of ['costCents','profitCents','knownCostCents','knownProfitCents','pendingCostUnits'])assert.equal(filtered.totals[field],read.report.totals[field],'Filtered general mismatch: '+field);
 const map=await new(require('../src/admin/map/admin-map.service').AdminMapService)(db).getReport({from:query.from,to:query.to,page:1}),allFinance=await finance.getReport({...query,source:'all'});
 for(const field of ['revenueCents','profitCents','knownProfitCents','pendingCostUnits'])assert.equal(map.total[field],allFinance.totals[field],'Map/Finance mismatch: '+field);
 checks.push('Read-time historical costs agree across every point, point-list cards, general report, point filter, Finance and Map; explicit zero and genuine pending units preserved without reconciliation');
 const applied=await reconcilePointCosts(db,{pointId:point.id,apply:true,actorId:admin.id});assert.equal(applied.summary.APPLIED,4);
 const count=await db.inventoryPointCostRevision.count();const replay=await reconcilePointCosts(db,{pointId:point.id,apply:true,actorId:admin.id});assert.equal(replay.summary.APPLIED,0);assert.equal(await db.inventoryPointCostRevision.count(),count);
 const after=await points.detail(point.id,'2026-10-01','2026-11-12');assert.equal(after.report.totals.pendingCostUnits,3);assert.equal(after.report.totals.knownCostCents,5225);assert.equal(after.report.totals.knownProfitCents,4775);
 assert.deepEqual(await db.inventoryLotSlice.findMany({where:{id:{in:stock.map(s=>s.id)}},orderBy:{id:'asc'}}),stock);
 // Editing or returning an unreconciled legacy sale must freeze the resolved
 // original units, rather than reintroducing UNKNOWN allocation components.
 for(const action of ['edit','return']){
  await seed('saved edition');const id=cases.at(-1).saleId,sale=await db.pointSale.findUniqueOrThrow({where:{id}}),line=sale.state.lines[0];
  if(action==='edit')await points.sale(point.id,admin.id,randomUUID(),{occurredAt:'2026-11-12T12:00',stockHandling:'ALREADY_ADJUSTED',revision:sale.revision,reason:'Preserve original evidence',lines:[{id:line.id,variantId:line.variantId,lotId:line.lotId,quantity:1,unitPriceCents:4100,commissionBp:5000}]},id);
  else await points.refund(point.id,id,admin.id,randomUUID(),{occurredAt:'2026-11-12T12:00',revision:sale.revision,reason:'Return original units',lines:[{id:line.id,quantity:1,restock:true,recoveredCommissionCents:2000}]});
  const ledger=await require('../src/admin/points/point-cost-revisions').applyPointCostRevisions(db,await db.pointEntry.findMany({where:{saleId:id}}));
  assert.ok(ledger.every(e=>e.lines.every(l=>l.costCents!==null)),'Historical '+action+' lost a known cost');
  assert.equal(ledger.find(e=>e.kind==='SALE').lines[0].costCents,1375);
  if(action==='return')assert.equal(ledger.find(e=>e.kind==='RETURN').lines[0].costCents,-1375);
 }
 checks.push('Historical reconciliation: sole edition, saved edition, explicit zero, uniform receipt, unknown/ambiguous/changed cost, preserved snapshots, profit impact, replay and unchanged stock');
};
