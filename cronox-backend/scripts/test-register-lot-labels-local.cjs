'use strict';
require('reflect-metadata');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
Object.assign(process.env,require('./start-local.cjs').loadLocalEnvironment());
const {PrismaClient}=require('@prisma/client');
const {AdminLabelsService}=require('../dist/admin/labels/admin-labels.service');
const {RegisterController,registerOptions}=require('../dist/admin/register/register.controller');
const {labelPdf,labelSvg}=require('../dist/admin/labels/label-document');
const {automaticLabelContent}=require('../dist/admin/labels/label-presentation');
const {automaticLabelTemplate}=require('../dist/admin/labels/label-template');
const db=new PrismaClient();
async function hashes(){
 const data={};
 for(const table of ['Product','ProductVariant','InventoryLot','InventoryLotSlice','InventoryLotAllocation','StockMovement','Order','OrderItem','PointSale','PointEntry','CheckoutStockReservation','historial','PhysicalBarcode'])
  data[table]=(await db.$queryRawUnsafe(`SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) hash FROM "${table}" t`))[0].hash;
 return data;
}
async function main(){
 const before=await hashes(),service=new AdminLabelsService(db),register=new RegisterController(db);
 const v=await db.productVariant.findFirstOrThrow({where:{stockQty:{gte:2},isActive:true,physicalBarcode:{isNot:null},product:{isActive:true,lotManaged:true}},include:{physicalBarcode:true,product:true}});
 const line={variantId:v.id,lotId:v.product.activeLotId,quantity:2};
 const results=await Promise.all(Array.from({length:12},()=>service.generate({lines:[line]})));
 const code=results[0].items[0].code;
 assert.ok(/^CR[XL]\d{10}$/.test(code));
 assert.ok(results.every(r=>r.items[0].code===code));
 assert.equal((await service.generate({lines:[line]})).items[0].code,code);
 const options=await register.barcode({code});
 assert.equal(options.length,1);assert.equal(options[0].lotId,line.lotId);
 assert.ok((await register.barcode({code:v.physicalBarcode.code})).length>=1);
 const quote=await register.quote({items:[line]});
 assert.equal(quote.totalCents,quote.items[0].unitPriceCents*2);
 const points=await register.points();
 if(points.length)assert.equal((await register.quote({items:[line],pointId:points[0].id})).totalCents,quote.totalCents);
 const preview=await service.preview({lines:[line]});assert.equal(preview.quantity,2);
 const out=path.resolve(__dirname,'../../output/playwright/register-lot-labels');fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'lot-labels.pdf'),await service.pdf({lines:[line]}));
 fs.writeFileSync(path.join(out,'lot-label.svg'),preview.firstLabelSvg);
 fs.writeFileSync(path.join(out,'quote.json'),JSON.stringify(quote,null,2));
 // Real stored offer evaluated at its recorded start, without changing it or the server clock.
 const real=await db.product.findFirstOrThrow({where:{inventoryLots:{some:{webOfferPriceCents:{not:null},webOfferDisabledAt:null}},isActive:true},include:{variants:true,inventoryLots:{include:{slices:true}}}});
 const offer=real.inventoryLots.find(l=>l.webOfferPriceCents && !l.webOfferDisabledAt);
 const historic=registerOptions(real,new Date(offer.webOfferStartsAt.getTime()+1000)).find(o=>o.lotId===offer.id && o.previousPriceCents);
 if(historic)fs.writeFileSync(path.join(out,'historic-offer-example.json'),JSON.stringify({evaluatedAt:offer.webOfferStartsAt,offerActiveToday:false,name:historic.name,original:historic.previousPriceCents,unitPrice:historic.unitPriceCents,discount:historic.previousPriceCents-historic.unitPriceCents,quantity:2,total:historic.unitPriceCents*2},null,2));
 assert.deepEqual(await hashes(),before);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,code,variantId:v.id,lotId:line.lotId,concurrentIssuers:12,businessDataUnchanged:true},null,2));
 console.log(JSON.stringify({ok:true,code,variantId:v.id,lotId:line.lotId,quote:quote.totalCents,historic:historic && {name:historic.name,original:historic.previousPriceCents,final:historic.unitPriceCents,total:historic.unitPriceCents*2}}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
