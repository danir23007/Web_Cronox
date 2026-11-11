'use strict';
// Imports an explicitly supplied, contact-free economic extract into an empty,
// disposable loopback review schema. Never connects to the extract's source.
module.exports=async({db,file,actorId,database})=>{
 const assert=require('node:assert/strict'),fs=require('node:fs');
 assert.match(database,/^cronox_editions_ui_[a-f0-9]{32}$/);
 assert.equal((await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name,database);
 assert.equal(await db.pointEntry.count(),0);
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 await db.$transaction(async tx=>{db=tx;
 for(const p of data.products){
  await db.product.create({data:{id:p.id,name:p.name,slug:'real-review-'+p.id,price:4000,lotManaged:true,variants:{create:p.variants.map(v=>({...v,sku:'real-review-'+v.id}))},privateCost:{create:{unitCostCents:p.privateCost?.unitCostCents ?? null}}}});
 }
 // Product creation seeds opening lots; replace only these empty review lots.
 await db.inventoryLotAudit.deleteMany();await db.inventoryLotSlice.deleteMany();await db.inventoryLot.deleteMany();
 for(const p of data.products)for(const l of p.inventoryLots){
  const {slices,history,...lot}=l;await db.inventoryLot.create({data:lot});
  for(const s of slices){const {allocations,...slice}=s;await db.inventoryLotSlice.create({data:slice});for(const a of allocations)await db.inventoryLotAllocation.create({data:a});}
  for(const a of history)await db.inventoryLotAudit.create({data:{...a,actorId}});
 }
 for(const p of data.products)await db.product.update({where:{id:p.id},data:{activeLotId:p.activeLotId}});
 for(const p of data.points)await db.salePoint.create({data:p});
 for(const s of data.sales)await db.pointSale.create({data:s});
 for(const e of data.entries)await db.pointEntry.create({data:{...e,actorId}});
 for(const r of data.revisions)await db.inventoryPointCostRevision.create({data:{...r,actorId}});
 for(const m of data.movements)await db.stockMovement.create({data:m});
 await db.$queryRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Product"','id'), (SELECT max(id) FROM "Product"))`);
 await db.$queryRawUnsafe(`SELECT setval(pg_get_serial_sequence('"ProductVariant"','id'), (SELECT max(id) FROM "ProductVariant"))`);
 },{timeout:60000});
};
