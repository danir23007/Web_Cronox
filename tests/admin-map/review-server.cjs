// Isolated, in-memory review: no database, credentials, payments or mail services.
const express = require('../../cronox-backend/node_modules/express');
const path = require('node:path');
const fs = require('node:fs');
const { AdminMapService } = require('../../cronox-backend/dist/admin/map/admin-map.service');
const { PROVINCES } = require('../../cronox-backend/dist/admin/map/spain-geography');
const { madridDate } = require('../../cronox-backend/dist/admin/finance/financial-calculations');

function createFixture() {
  const now = new Date();
  const rows = Array.from({length:93},(_,i) => {
    const id = i + 1;
    const o = { historicalQualified:true,id,status:i % 2 ? 'SHIPPED' : 'DELIVERED',currency:'EUR',providerRef:`pi_fixture_${id}`,source:'ONLINE',paidAt:now,purchasedAt:null,createdAt:now,voidedAt:null,total:'48.00',shippingCost:0,discountCents:200,disputeLostCents:0,
      items:[{id,productId:1,variantId:1,title:'Producto de prueba',quantity:2,lineTotal:'50.00',financialSnapshot:{unitCostCents:500,productName:'Prueba',imageUrl:null}}] };
    return {orderId:id,currency:'EUR',paidDate:new Date(madridDate(now)),lastDate:new Date(madridDate(now)),providerRef:o.providerRef,snapshot:o};
  });
  const live = rows.map((r,i) => {
    const province = i < 36 ? PROVINCES[27] : PROVINCES[(i-36)%52];
    let shippingAddr = {country:'ES',zip:province.id+'001',state:province.name};
    if (i===89) shippingAddr = {country:'ES',state:'Andalucía'};
    if (i===90) shippingAddr = {country:'ES',zip:'28001',state:'Barcelona'};
    if (i===91) shippingAddr = {country:'France',zip:'75001'};
    if (i===92) shippingAddr = {};
    return {id:r.orderId,shippingAddr};
  });
  const events = [{id:'partial',paymentIntentId:rows[88].providerRef,occurredAt:now,snapshot:{id:'partial',type:'charge.refunded',paymentIntentId:rows[88].providerRef,occurredAt:now,lifecycleStatus:null,refundCumulativeCents:800,amountCents:null}}];
  const tx = {
    financeArchive:{findMany:async({where,take})=>rows.filter(r => r.orderId > where.orderId.gt && r.currency===where.currency && r.paidDate <= where.paidDate.lte && (r.lastDate >= where.OR[0].lastDate.gte)).slice(0,take)},
    order:{findMany:async({where})=>live.filter(o=>where.id.in.includes(o.id))},
    financeEventArchive:{findMany:async({where})=>events.filter(e=>where.paymentIntentId.in.includes(e.paymentIntentId))},
    financeStockArchive:{findMany:async()=>[]},
  };
  return new AdminMapService({$transaction:fn=>fn(tx)});
}
function start(port=43127) {
  const app=express(), service=createFixture();
  app.use((req,res,next)=> { if (req.method!=='GET') return res.status(405).json({message:'Read-only review'}); next(); });
  app.get('/api/me',(req,res)=>res.json({id:1,role:'ADMIN',email:'review@example.test',name:'Revisión local'}));
  app.get('/api/admin/map',async(req,res)=> {
    try { res.json(await service.getReport({from:req.query.from,to:req.query.to,division:req.query.division,region:req.query.region,page:Number(req.query.page)||1})); }
    catch(e) { res.status(400).json({message:e.message}); }
  });
  app.get('/api/admin/orders/:id',(req,res)=>res.json({id:Number(req.params.id),status:'DELIVERED',paymentStatus:'PAID',fulfillmentStatus:'DELIVERED',customer:{name:'Cliente simulado',email:'review@example.test'},shippingAddress:{province:'Madrid',country:'España'},items:[],total:'48.00'}));
  app.use('/api',(req,res)=>res.json({data:[],items:[],pending23:0,pending34:0}));
  app.get('/admin.html',(req,res)=>res.type('html').send(fs.readFileSync(path.resolve(__dirname,'../../cronox-front/admin.html'),'utf8').replace('<head>',`<head><meta name="cronox:api-base" content="http://127.0.0.1:${port}">`)));
  app.use(express.static(path.resolve(__dirname,'../../cronox-front')));
  return app.listen(port,'127.0.0.1');
}
module.exports={start,createFixture};
if (require.main===module) { start(); console.log('Isolated review: http://127.0.0.1:43127/admin.html#section-map'); }
