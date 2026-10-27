'use strict';
// Called only by the existing disposable-loopback sale-points test harness.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
module.exports=async({db,points,finance,admin,customer,app,token,userToken,checks})=>{
  const {AdminMapService}=require('../src/admin/map/admin-map.service');
  const {FinanceQuery}=require('../src/admin/finance/admin-finance.controller');
  const {PROVINCES}=require('../src/admin/map/spain-geography');
  const map=new AdminMapService(db),from='2027-04-01',to='2027-04-30';
  const check=name=>checks.push('Map/point integration: '+name);
  const mapReport=(patch={})=>map.getReport({from,to,page:1,...patch});
  const financeReport=(patch={})=>finance.getReport(Object.assign(new FinanceQuery(),{from,to,...patch}));
  const product=await db.product.create({data:{name:'Prueba mapa física',slug:'map-points-'+randomUUID(),price:1000,privateCost:{create:{unitCostCents:200}},variants:{create:{size:'M',sku:'MAP-'+randomUUID(),stockQty:100}}},include:{variants:true}});
  const variantId=product.variants[0].id;
  const pointDto=(name,city,extra={})=>({name,type:'EVENT',city,venue:'Lugar ficticio',notes:'Prueba local',commissionBp:1000,archived:false,...extra});
  const createPoint=async(name,city,extra={})=>{
    const entry=await points.savePoint(admin.id,randomUUID(),pointDto(name,city,extra));return db.salePoint.findUniqueOrThrow({where:{id:entry.pointId}});
  };
  const saleDto=(quantity=2,unitPriceCents=1000,extra={})=>({occurredAt:'2027-04-03T12:00',stockHandling:'DEDUCT_NOW',paymentMethod:'CASH',note:'Venta ficticia',lines:[{variantId,quantity,unitPriceCents,commissionBp:1000}],...extra});
  const bilbao=await createPoint('Mapa Bilbao','Bilbao',{participationCents:500,expenseDate:'2027-04-01T12:00'});
  const madrid=await createPoint('Mapa Madrid','Madrid'),unknown=await createPoint('Sin provincia','Localización incompleta');
  assert.equal(bilbao.provinceId,'48');assert.equal(madrid.provinceId,'28');assert.equal(unknown.provinceId,null);
  // Replay the real normalization migration over simulated legacy null columns.
  const legacy=await db.salePoint.create({data:{name:'Legado Vizcaya',type:'EVENT',city:'Vizcaya'}});
  const accented=await db.salePoint.create({data:{name:'Legado Coruña',type:'EVENT',city:'A Coruña'}});
  const sql=fs.readFileSync(path.resolve(__dirname,'../prisma/migrations/20261027231000_point_place_normalization/migration.sql'),'utf8');
  const {Client}=require('pg'),connection=new Client({connectionString:process.env.DATABASE_URL});await connection.connect();try{await connection.query(sql);}finally{await connection.end();}
  assert.equal((await db.salePoint.findUniqueOrThrow({where:{id:legacy.id}})).provinceId,'48');assert.equal((await db.salePoint.findUniqueOrThrow({where:{id:accented.id}})).provinceId,'15');
  const sale=await points.sale(bilbao.id,admin.id,randomUUID(),saleDto());
  const state=await db.pointSale.findUniqueOrThrow({where:{id:sale.saleId}});
  await points.refund(bilbao.id,state.id,admin.id,randomUUID(),{occurredAt:'2027-04-05T12:00',revision:state.revision,reason:'Devolución',lines:[{id:state.state.lines[0].id,quantity:1,restock:true,recoveredCommissionCents:100}]});
  await points.sale(madrid.id,admin.id,randomUUID(),saleDto(1,300,{lines:[{variantId,quantity:1,unitPriceCents:300,commissionBp:3333}]}));
  await points.expense(madrid.id,admin.id,randomUUID(),{occurredAt:'2027-04-02T12:00',description:'Gasto fijo',amountCents:500});
  await points.expense(unknown.id,admin.id,randomUUID(),{occurredAt:'2027-04-02T12:00',description:'Gasto sin ubicación',amountCents:123});
  // Frozen costs survive a later catalogue cost change.
  await db.productCost.update({where:{productId:product.id},data:{unitCostCents:9999}});
  assert.equal((await points.detail(bilbao.id,from,to)).report.totals.costCents,200);
  const order=async(province,amount=600,source='ONLINE')=>db.order.create({data:{userId:customer.id,customerEmail:customer.email,status:'PAID',source,provider:'manual',paidAt:new Date('2027-04-04T10:00Z'),purchasedAt:source==='IN_PERSON_ADMIN'?new Date('2027-04-04T10:00Z'):null,
    subtotal:amount/100,taxAmount:0,taxRate:0,total:amount/100,currency:'EUR',shippingAddr:{country:'ES',postalCode:province+'001'},items:{create:{productId:product.id,variantId,title:'Prueba web',quantity:1,unitPrice:amount/100,lineTotal:amount/100,financialSnapshot:{create:{unitCostCents:100,productName:'Coste congelado'}}}}}});
  const web=await order('48'),webMadrid=await order('28',400);
  const manual=await order('28',1000,'IN_PERSON_ADMIN');
  await assert.rejects(points.sale(bilbao.id,admin.id,randomUUID(),saleDto(1,600,{orderId:web.id,stockHandling:'ALREADY_ADJUSTED'})),/presencial/);
  await assert.rejects(points.sale(bilbao.id,admin.id,randomUUID(),saleDto(1,999,{orderId:manual.id,stockHandling:'ALREADY_ADJUSTED'})),/Importes/);
  await db.order.update({where:{id:manual.id},data:{paymentMethod:'STRIPE'}});
  await assert.rejects(points.sale(bilbao.id,admin.id,randomUUID(),saleDto(1,1000,{orderId:manual.id,stockHandling:'ALREADY_ADJUSTED'})),/pago integrado/);
  await db.order.update({where:{id:manual.id},data:{paymentMethod:null}});
  await points.sale(bilbao.id,admin.id,randomUUID(),saleDto(1,1000,{orderId:manual.id,stockHandling:'ALREADY_ADJUSTED'}));
  await assert.rejects(points.sale(madrid.id,admin.id,randomUUID(),saleDto(1,1000,{orderId:manual.id,stockHandling:'ALREADY_ADJUSTED'})),/vinculado/);
  const linked=await db.pointSale.findUniqueOrThrow({where:{orderId:manual.id}});assert.equal(linked.state.lines[0].unitCostCents,100);
  const {AdminManualPurchasesService}=require('../dist/admin/manual-purchases/admin-manual-purchases.service');
  const manualPurchases=app.get(AdminManualPurchasesService);
  assert.equal((await manualPurchases.getForEdit(customer.id,manual.id)).editable,false);
  await assert.rejects(manualPurchases.void(manual.id,admin.id,'Prueba de bloqueo'),/vinculada/);
  const get=()=>mapReport();let result=await get();assert.equal(result.division,'provinces');
  const reconciliation=async()=>{
    const [r,f]=await Promise.all([get(),financeReport()]);
    assert.equal(r.total.revenueCents,f.totals.revenueCents);assert.equal(r.total.profitCents,f.totals.profitCents);assert.equal(r.total.units,f.totals.unitsSold-f.totals.unitsReturned);assert.equal(r.total.orders,f.salesCount);
    const communities=await mapReport({division:'communities'});
    for(const region of communities.regions){
      for(const field of ['orders','units','revenueCents','profitCents'])assert.equal(region[field],r.provinces.filter(p=>p.regionId===region.id).reduce((sum,p)=>sum+p[field],0)+region.unassignedProvince[field]);
    }
    return r;
  };
  result=await reconciliation();
  assert.equal(result.provinces.find(p=>p.id==='48').orders,3); // physical, linked manual once, web
  assert.equal(result.provinces.find(p=>p.id==='28').orders,2);
  assert.equal(result.provinces.find(p=>p.id==='48').revenueCents,2600);
  assert.equal(result.provinces.find(p=>p.id==='28').profitCents,-200);
  assert.equal(result.groups.find(g=>g.id==='unknownSpain').profitCents,-123);
  const pointFinance=await financeReport({source:'points',pointId:bilbao.id}),detail=await points.detail(bilbao.id,from,to);
  assert.equal(pointFinance.totals.profitCents,detail.report.totals.profitCents);assert.equal(pointFinance.totals.revenueCents,detail.report.totals.revenueCents);
  check('web + physical attribution by point INE code, Bizkaia/Vizcaya and accent normalization; linked manual order once; counts differ from units; negative profits, historical costs, fees and fixed costs reconcile with Finance and point details');
  // Date windows and refunds from a previous paid period use the same postings.
  const beforeMay=await mapReport({from:'2027-05-01',to:'2027-05-31'});assert.equal(beforeMay.total.revenueCents,0);
  const current=await db.pointSale.findUniqueOrThrow({where:{id:state.id}});
  await points.refund(bilbao.id,state.id,admin.id,randomUUID(),{occurredAt:'2027-05-02T12:00',revision:current.revision,reason:'Devolución en mayo',lines:[{id:current.state.lines[0].id,quantity:1,restock:false,recoveredCommissionCents:0}]});
  const may=await mapReport({from:'2027-05-01',to:'2027-05-31'}),mayFinance=await financeReport({from:'2027-05-01',to:'2027-05-31'});
  assert.equal(may.total.revenueCents,-1000);assert.equal(may.total.profitCents,mayFinance.totals.profitCents);assert.equal(may.total.units,-1);assert.equal(may.total.orders,0);
  assert.equal((await get()).total.revenueCents,result.total.revenueCents);
  check('later-period return remains in that period, including negative units/profit, without repeating historical sales or costs');
  await db.order.update({where:{id:manual.id},data:{excludedFromStatistics:true}});const excluded=await reconciliation();assert.equal(excluded.total.revenueCents,result.total.revenueCents-1000);
  await db.order.update({where:{id:manual.id},data:{excludedFromStatistics:false}});await reconciliation();
  const original=await db.salePoint.findUniqueOrThrow({where:{id:bilbao.id}}),beforeMove=await get();
  await points.savePoint(admin.id,randomUUID(),{...pointDto(original.name,original.city),revision:original.revision,provinceId:'28'},bilbao.id);
  const moved=await get();assert.deepEqual(moved.total,beforeMove.total);assert.equal(moved.provinces.find(p=>p.id==='48').orders,1);assert.equal(moved.provinces.find(p=>p.id==='28').orders,4);
  await points.savePoint(admin.id,randomUUID(),{...pointDto(original.name,original.city),revision:original.revision+1,provinceId:'48'},bilbao.id);await reconciliation();
  check('live manual statistics exclusions propagate through linked ledger; correcting location reattributes all point history without changing totals or using a cache');
  const usersBefore=await db.user.findMany({orderBy:{id:'asc'}}),ordersBefore=await db.order.findMany({orderBy:{id:'asc'}}),stockBefore=await db.productVariant.findUniqueOrThrow({where:{id:variantId}});
  const historyBefore=await db.pointEntry.findMany({where:{pointId:bilbao.id},orderBy:{id:'asc'}}),totalsBefore=(await get()).total;
  const plan=await points.previewDeletion(bilbao.id),dto={confirmed:true,mode:plan.mode,revision:plan.point.revision};assert.equal(plan.mode,'archive');
  assert.equal((await points.delete(bilbao.id,dto,admin.id)).mode,'archive');assert.equal((await points.delete(bilbao.id,dto,admin.id)).alreadyDeleted,true);
  assert.equal((await points.list()).some(p=>p.id===bilbao.id),false);
  assert.deepEqual((await get()).total,totalsBefore);assert.deepEqual(await db.pointEntry.findMany({where:{pointId:bilbao.id},orderBy:{id:'asc'}}),historyBefore);
  await assert.rejects(points.sale(bilbao.id,admin.id,randomUUID(),saleDto()),/eliminado/);
  await assert.rejects(points.expense(bilbao.id,admin.id,randomUUID(),{occurredAt:'2027-05-04T12:00',description:'No permitido',amountCents:1}),/eliminado/);
  await assert.rejects(points.savePoint(admin.id,randomUUID(),{...pointDto(original.name,original.city),revision:plan.point.revision+1},bilbao.id),/reactivar/);
  assert.deepEqual(await db.user.findMany({orderBy:{id:'asc'}}),usersBefore);assert.deepEqual(await db.order.findMany({orderBy:{id:'asc'}}),ordersBefore);assert.deepEqual(await db.productVariant.findUniqueOrThrow({where:{id:variantId}}),stockBefore);
  assert.equal(await db.auditLog.count({where:{actionType:'POINT_DELETE',targetId:bilbao.id}}),1);
  check('history point is retired once, blocks new operations/reactivation, preserves every ledger/user/order/stock field and stays in map totals');
  const empty=await createPoint('Vacío a borrar','Madrid'),emptyPlan=await points.previewDeletion(empty.id);assert.equal(emptyPlan.mode,'delete');
  await points.delete(empty.id,{confirmed:true,mode:'delete',revision:empty.revision},admin.id);
  assert.equal(await db.salePoint.findUnique({where:{id:empty.id}}),null);assert.equal(await db.pointEntry.count({where:{pointId:empty.id}}),0);
  // Existing parent-row locks serialize a new sale against a delete. A plan
  // computed while empty must not silently switch to a different deletion mode.
  const race=await createPoint('Carrera de venta','Madrid'),preview=await points.previewDeletion(race.id);
  await points.sale(race.id,admin.id,randomUUID(),saleDto(1,500));
  await assert.rejects(points.delete(race.id,{confirmed:true,mode:preview.mode,revision:race.revision},admin.id),/historial han cambiado/);
  assert.ok(await db.salePoint.findUnique({where:{id:race.id}}));
  check('empty-point real deletion cleans only zero-value metadata under the actual append-only SQL trigger; new history invalidates an old empty-point confirmation');
  const concurrent=await createPoint('Venta y borrado simultáneos','Madrid');
  let release,locked;const gate=new Promise(r=>release=r),ready=new Promise(r=>locked=r);
  const holding=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "SalePoint" WHERE id=${concurrent.id} FOR UPDATE`;locked();await gate;},{timeout:10000});
  await ready;
  const deleting=points.delete(concurrent.id,{confirmed:true,mode:'delete',revision:concurrent.revision},admin.id).then(value=>({value}),error=>({error}));
  const selling=points.sale(concurrent.id,admin.id,randomUUID(),saleDto(1,500)).then(value=>({value}),error=>({error}));
  let queued=false;
  try{for(let i=0;i<100;i++){
    const rows=await db.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SalePoint%FOR UPDATE%'`;
    if(rows[0].n>=2){queued=true;break;}await new Promise(r=>setTimeout(r,20));
  }}finally{release();await holding;}
  assert.ok(queued,'both financial write and deletion must actually wait on the same locked parent');
  const [removed,sold]=await Promise.all([deleting,selling]);
  assert.ok(Boolean(removed.error)!==Boolean(sold.error),'exactly one competing operation must succeed');
  if(sold.value){assert.equal(removed.error.getStatus(),409);assert.equal(await db.pointSale.count({where:{pointId:concurrent.id}}),1);}
  else{assert.equal(sold.error.getStatus(),404);assert.equal(await db.pointSale.count({where:{pointId:concurrent.id}}),0);}
  check('real simultaneous sale/delete transactions queue behind the same PostgreSQL row lock; either the sale wins and invalidates confirmation or deletion wins and rejects the sale');
  const {AuthSessionsService}=require('../dist/auth/auth-sessions.service'),auth=app.get(AuthSessionsService);
  const limited=await db.user.create({data:{email:'map-admin-only@example.test',role:'ADMIN'}}),limitedToken=await auth.create(limited);
  const httpPoint=await createPoint('HTTP point','Madrid');
  await assert.rejects(points.delete(httpPoint.id,{confirmed:true,mode:'delete',revision:1},limited.id),error=>error.getStatus()===403);
  const request=async(method,suffix,body,access)=>{
    const response=await fetch('http://127.0.0.1:43121/api/admin/sale-points/'+httpPoint.id+suffix,{method,headers:{Origin:'http://127.0.0.1:43121',Cookie:'cronox_csrf_token=map-test','x-csrf-token':'map-test','Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};
  };
  assert.equal((await request('DELETE','',{confirmed:true,mode:'delete',revision:1})).status,401);
  assert.equal((await request('DELETE','',{confirmed:true,mode:'delete',revision:1},limitedToken.accessToken)).status,403);
  assert.equal((await request('DELETE','',{confirmed:true,mode:'delete',revision:1},userToken.accessToken)).status,403);
  assert.equal((await request('GET','/deletion-preview',undefined,limitedToken.accessToken)).status,403);
  assert.equal((await request('DELETE','',{confirmed:false,mode:'delete',revision:1},token.accessToken)).status,400);
  assert.ok(await db.salePoint.findUnique({where:{id:httpPoint.id}}));
  assert.equal((await request('DELETE','',{confirmed:true,mode:'delete',revision:1},token.accessToken)).status,200);
  assert.equal((await request('DELETE','',{confirmed:true,mode:'delete',revision:1},token.accessToken)).body.alreadyDeleted,true);
  check('real HTTP guards and DTO: only SUPERADMIN previews/deletes, confirmation is mandatory, repeated deletion is safe');
  const browserEmpty=await createPoint('Borrado vacío navegador','Madrid');
  // A point with pending financial history stays available as a browser fixture.
  fs.mkdirSync(path.resolve(__dirname,'../../output/map-sale-points'),{recursive:true});
  fs.writeFileSync(path.resolve(__dirname,'../../output/map-sale-points/integration-results.json'),JSON.stringify({passed:true,isolated:true,from,to,checks:checks.filter(c=>c.startsWith('Map/point')),pointId:madrid.id,browserEmptyId:browserEmpty.id,total:(await reconciliation()).total},null,2));
};
