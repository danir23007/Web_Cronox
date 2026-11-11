'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
module.exports=async({db,app,users,root,out})=>{
 const editions=app.get(require('../src/admin/lots/product-editions.service').ProductEditionsService);
 const points=app.get(require('../src/admin/points/admin-points.service').AdminPointsService);
 const {reconcilePointCosts}=require('../src/admin/points/point-cost-reconciliation');
 const {frozenCost}=require('../src/inventory-lots/lot-costs');
 const date='2026-11-11T12:00',range={from:'2026-10-25',to:'2026-11-12'};
 const create=async(label,cost,stock=0,sizes=['M','L','S'])=>{
  const p=await db.product.create({data:{name:'PRUEBA COSTES '+label,slug:'costes-'+randomUUID(),price:4000,privateCost:{create:{unitCostCents:cost}},variants:{create:sizes.map(size=>({size,stockQty:stock,sku:'costes-'+randomUUID()}))}}});
  let state=await editions.list(p.id),lot=state.lots.find(l=>l.id===state.product.activeLotId);
  state=await editions.save(p.id,lot.id,{revision:lot.revision,receivedAt:'2026-01-01',unitCostCents:cost},users.admin.id,randomUUID());
  lot=state.lots.find(l=>l.id===state.product.activeLotId);
  return {id:p.id,name:p.name,lot1:lot.id,variants:Object.fromEntries(lot.profile.variants.map(v=>[v.size,v.id]))};
 };
 const two=await create('DOS TIRADAS',1375);
 let state=await editions.list(two.id),lot=state.lots.find(l=>l.id===two.lot1);
 state=await editions.save(two.id,lot.id,{revision:lot.revision,receivedAt:'2026-01-01',expectedStocks:lot.profile.variants.map(v=>({size:v.size,available:v.stockQty})),variants:lot.profile.variants.map(v=>({size:v.size,stockQty:20}))},users.admin.id,randomUUID());
 lot=state.lots.find(l=>l.id===two.lot1);state=await editions.duplicate(two.id,lot.id,lot.revision,randomUUID(),users.admin.id);
 two.lot2=state.id;lot=state.lots.find(l=>l.id===two.lot2);
 state=await editions.save(two.id,lot.id,{revision:lot.revision,unitCostCents:2200,receivedAt:'2026-02-01',expectedStocks:lot.profile.variants.map(v=>({size:v.size,available:v.stockQty})),variants:lot.profile.variants.map(v=>({size:v.size,stockQty:20}))},users.admin.id,randomUUID());
 lot=state.lots.find(l=>l.id===two.lot2);await editions.activate(two.id,lot.id,lot.revision,users.admin.id);
 const fallback=await create('PREDETERMINADO',1375,8),zero=await create('CERO',0,0),unknown=await create('PENDIENTE',null,0);
 const newPoint=async name=>(await points.savePoint(users.admin.id,randomUUID(),{name,type:'STORE',city:'Madrid',provinceId:'28',venue:'Prueba local',notes:'Datos sintéticos aislados',commissionBp:5000,participationCents:0,expenseDate:date,archived:false}));
 const reference=await newPoint('PRUEBA COSTES · Referencia y revisión');
 const referenceId=reference.pointId;
 // Reproduce the exact 410/205/9 shape through the previous implementation,
 // loaded from the published base, against synthetic products in this clone.
 const cp=require('node:child_process'),Module=require('node:module'),ts=require('typescript');
 const filename=path.join(root,'cronox-backend/src/admin/points/admin-points.service.ts');
 const source=cp.execFileSync('git',['show','77b268a8aa036d889a7330530f263b870220132c:cronox-backend/src/admin/points/admin-points.service.ts'],{cwd:root,encoding:'utf8'});
 const oldModule=new Module(filename,module);oldModule.filename=filename;oldModule.paths=Module._nodeModulePaths(path.dirname(filename));
 oldModule._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText,filename);
 const previous=new oldModule.exports.AdminPointsService(db);
 const red=await create('CONTROL RED',1375,10,['XL','M','L']),black=await create('CONTROL BLACK',1100,10,['L','S']),ashen=await create('CONTROL ASHEN',3500,10,['S']);
 // A documented L receipt provides the known control. Blank opening units of
 // the other sizes remain unresolved in the previous implementation.
 await db.inventoryLotSlice.updateMany({where:{lotId:red.lot1,variantId:red.variants.L},data:{productionCents:1375,freightCents:0,otherCents:0}});
 await db.inventoryLot.update({where:{id:red.lot1},data:{costQuality:'CONFIRMED'}});
 const reproduction=await newPoint('PRUEBA COSTES · Reproducción 410 €');
 let legacyInserted=false;
 for(const [product,size,price,mode] of [[red,'XL',4000,'DEDUCT_NOW'],[red,'XL',4000,'ALREADY_ADJUSTED'],[red,'XL',4000,'DEDUCT_NOW'],[red,'M',4000,'ALREADY_ADJUSTED'],[red,'M',4000,'DEDUCT_NOW'],[red,'L',4000,'DEDUCT_NOW'],[black,'L',4000,'DEDUCT_NOW'],[black,'S',4000,'ALREADY_ADJUSTED'],[ashen,'S',9000,'ALREADY_ADJUSTED']]){
  if(product===red&&size==='XL'&&!legacyInserted){
   legacyInserted=true;
   const line={id:randomUUID(),productId:product.id,variantId:product.variants[size],lotId:product.lot1,name:product.name,size,quantity:1,unitPriceCents:price,unitCostCents:1375,commissionBp:5000,commissionCents:2000,returned:0};
   const state={stockHandling:'DEDUCT_NOW',lines:[line],note:'Snapshot histórico sintético anterior al coste por tiradas',paymentMethod:'CASH'};
   await db.$transaction(async tx=>{const sale=await tx.pointSale.create({data:{pointId:reproduction.pointId,soldAt:new Date('2026-11-11T11:00:00Z'),state}});const entry=await tx.pointEntry.create({data:{pointId:reproduction.pointId,saleId:sale.id,actorId:users.admin.id,kind:'SALE',occurredAt:new Date('2026-11-11T11:00:00Z'),requestKey:randomUUID(),requestHash:'synthetic-legacy',description:state.note,after:state,lines:[require('../src/admin/points/point-calculations').lineDelta(line)]}});await require('../src/inventory-lots/lot-ledger').allocateLots(tx,line.variantId,1,'point:'+sale.id,'SOLD',product.lot1);await tx.stockMovement.create({data:{variantId:line.variantId,delta:-1,userId:users.admin.id,reason:'point_sale',note:'PointEntry:'+entry.id}});});
   continue;
  }
  await previous.sale(reproduction.pointId,users.admin.id,randomUUID(),{occurredAt:date,stockHandling:mode,note:'Reproducción sintética',paymentMethod:'CASH',lines:[{variantId:product.variants[size],lotId:product.lot1,quantity:1,unitPriceCents:price,commissionBp:5000}]});
 }
 const baseline=await points.detail(reproduction.pointId,range.from,range.to);
 assert.equal(baseline.report.totals.revenueCents,41000);assert.equal(baseline.report.totals.commissionCents,20500);assert.equal(baseline.report.netUnits,9);
 assert.equal(baseline.report.totals.knownCostCents,2750);assert.equal(baseline.report.totals.knownProfitCents,1250);assert.equal(baseline.report.totals.pendingCostUnits,7);
 // Dated audit evidence allows safe recovery of one old sale; absence of such
 // evidence stays pending. Known costs must survive both preview and replay.
 const recovery=await newPoint('PRUEBA COSTES · Conciliación');
 const old=await previous.sale(recovery.pointId,users.admin.id,randomUUID(),{occurredAt:date,stockHandling:'ALREADY_ADJUSTED',note:'Coste perdido por versión anterior',paymentMethod:'CASH',lines:[{variantId:fallback.variants.M,lotId:fallback.lot1,quantity:1,unitPriceCents:4000,commissionBp:5000}]});
 const audit=await db.inventoryLotAudit.create({data:{id:randomUUID(),lotId:fallback.lot1,actorId:users.admin.id,createdAt:new Date('2026-11-01T12:00:00Z'),reason:'Configuración histórica sintética documentada',after:{profile:{unitCostCents:1375}}}});
 const preview=await reconcilePointCosts(db,{pointId:recovery.pointId});assert.equal(preview.summary.PROPOSED,1);
 const beforeStock=await db.productVariant.findUniqueOrThrow({where:{id:fallback.variants.M}});
 const applied=await reconcilePointCosts(db,{pointId:recovery.pointId,apply:true,actorId:users.admin.id});assert.equal(applied.summary.APPLIED,1);
 const replay=await reconcilePointCosts(db,{pointId:recovery.pointId,apply:true,actorId:users.admin.id});assert.equal(replay.summary.PRESERVED,1);
 assert.equal((await db.productVariant.findUniqueOrThrow({where:{id:fallback.variants.M}})).stockQty,beforeStock.stockQty);
 assert.equal(await db.inventoryPointCostRevision.count({where:{entryId:old.id}}),1);
 const fixed=await points.detail(recovery.pointId,range.from,range.to);assert.equal(fixed.report.totals.profitCents,625);
 const stateFn=async()=>({sales:await db.pointSale.findMany({where:{pointId:referenceId}}),variants:await db.productVariant.findMany({where:{productId:{in:[two.id,fallback.id,zero.id,unknown.id]}}}),lots:await db.inventoryLot.findMany({where:{productId:{in:[two.id,fallback.id,zero.id,unknown.id]}},include:{slices:true}}),report:await points.detail(referenceId,range.from,range.to),baseline:baseline.report,plan:await reconcilePointCosts(db,{pointId:reproduction.pointId})});
 app.use('/__review/point-costs',async(req,res)=>{try{
  if(req.method==='POST'&&req.body?.op==='change-default')await db.productCost.update({where:{productId:two.id},data:{unitCostCents:9900}});
  if(req.method==='POST'&&req.body?.op==='activate-first'){const s=await editions.list(two.id),l=s.lots.find(l=>l.id===two.lot1);await editions.activate(two.id,l.id,l.revision,users.admin.id);}
  res.json(await stateFn());
 }catch(e){res.status(500).json({error:e.message});}});
 fs.writeFileSync(path.join(out,'diagnosis.json'),JSON.stringify({baseline:baseline.report.totals,reconciliation:{preview:preview.summary,applied:applied.summary,replay:replay.summary,unchangedStock:true,evidenceAudit: audit.id},mode:'local isolated synthetic data only'},null,2));
 return {two,fallback,zero,unknown,pointId:referenceId,reproductionPointId:reproduction.pointId,recoveryPointId:recovery.pointId,range,date};
};
