'use strict';
module.exports=async({db,app,users,out})=>{
 const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
 const editions=app.get(require('../src/admin/lots/product-editions.service').ProductEditionsService);
 const ashen=await db.product.findFirstOrThrow({where:{name:'ASHEN SHELL',isActive:true}}),armored=await db.product.findFirstOrThrow({where:{name:'ARMORED COAL',isActive:true}});
 let state=await editions.list(ashen.id);const lot1=state.lots.find(l=>l.number===1),lot2=state.lots.find(l=>l.number===2);assert.equal(lot1.profile.price,9000);assert.equal(lot2.profile.price,11000);
 await editions.activate(ashen.id,lot1.id,lot1.revision,users.admin.id);
 const favorite=await db.favorite.create({data:{userId:users.buyer.id,productId:ashen.id}});
 const variant=await db.productVariant.findFirstOrThrow({where:{productId:ashen.id,size:'M'}}),at=new Date('2026-10-15T12:00:00Z');
 const order=await db.order.create({data:{userId:users.buyer.id,customerEmail:users.buyer.email,status:'PAID',source:'IN_PERSON_ADMIN',provider:'manual',paymentMethod:'CASH',purchasedAt:at,paidAt:at,subtotal:'90',taxRate:'0.21',taxAmount:'15.62',total:'90',items:{create:{productId:ashen.id,variantId:variant.id,title:ashen.name,quantity:1,unitPrice:'90',lineTotal:'90',financialSnapshot:{create:{productName:ashen.name,unitCostCents:2620,lotCosts:[{lotId:lot1.id,sliceId:'historical:favorite-review',quantity:1,productionCents:2620,freightCents:0,otherCents:0,quality:'CONFIRMED'}]}}}}}});
 state=await editions.list(ashen.id);await editions.activate(ashen.id,lot2.id,state.lots.find(l=>l.id===lot2.id).revision,users.admin.id);
 state=await editions.list(ashen.id);const active=state.lots.find(l=>l.id===state.product.activeLotId);
 const stocked=await db.productVariant.findMany({where:{productId:ashen.id,stockQty:{gt:0}}});
 if(stocked.length)await app.get(require('../src/admin/inventory/admin-inventory.service').AdminInventoryService).update(ashen.id,{updates:stocked.map(v=>({variantId:v.id,expectedStock:v.stockQty,stock:0})),reason:'Reproducción aislada de favorito agotado'},users.admin.id);
 const controls=[];
 for(const [name,price]of [['DECIMAL REVIEW',3495],['REAL 1.10 REVIEW',110],['REAL 0.65 REVIEW',65]])controls.push(await db.product.create({data:{name,slug:'favorite-price-'+randomUUID(),price,displayOrder:-999,variants:{create:{size:'M',stockQty:0,sku:randomUUID()}}}}));
 for(const p of [armored,...controls])await db.favorite.create({data:{userId:users.buyer.id,productId:p.id}});
 const read=async()=>({product:await db.product.findUnique({where:{id:ashen.id},include:{variants:true}}),editions:await editions.list(ashen.id),favorites:await db.favorite.findMany({where:{userId:users.buyer.id},orderBy:{id:'asc'}}),order:await db.order.findUnique({where:{id:order.id},include:{items:{include:{financialSnapshot:true}}}})});
 const before=await read();assert.equal(before.product.price,11000);assert.equal(before.product.activeLotId,lot2.id);assert.ok(before.product.variants.every(v=>v.stockQty===0));
 fs.writeFileSync(path.join(out,'source-version.json'),JSON.stringify({base:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),ashenId:ashen.id,activeLot:lot2.id,activeNumber:2,priceCents:11000,historicalLot:lot1.id,historicalPriceCents:9000,soldOut:true,favoriteId:favorite.id,orderId:order.id},null,2));
 app.use('/__review/favorite-prices',async(req,res)=>{try{
  if(req.method==='POST'&&req.body?.op==='activate'){
   assert.ok([1,2].includes(req.body.number));const current=await editions.list(ashen.id),lot=current.lots.find(l=>l.number===req.body.number);await editions.activate(ashen.id,lot.id,lot.revision,users.admin.id);
  }
  if(req.method==='POST'&&req.body?.op==='price'){
   assert.ok([11000,12500].includes(req.body.priceCents));const current=await editions.list(ashen.id),lot=current.lots.find(l=>l.id===current.product.activeLotId);await editions.save(ashen.id,lot.id,{revision:lot.revision,price:req.body.priceCents},users.admin.id,randomUUID());
  }
  const result=await read();assert.equal(result.order.items[0].unitPrice.toString(),'90');assert.equal(result.order.total.toString(),'90');assert.equal(result.order.items[0].financialSnapshot.unitCostCents,2620);assert.deepEqual(result.favorites,before.favorites);res.json(result);
 }catch(e){res.status(500).json({error:e.message});}});
 return {ashen:{id:ashen.id,slug:ashen.slug},armored:{id:armored.id,slug:armored.slug},controls:controls.map(p=>({id:p.id,slug:p.slug,name:p.name,priceCents:p.price})),favoriteId:favorite.id,orderId:order.id,lot1:lot1.id,lot2:lot2.id};
};
