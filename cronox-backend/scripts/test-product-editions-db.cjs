'use strict';
// Read-only dump of a verified loopback source; every write targets a fresh,
// uniquely named local database. No production environment is accepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const name = 'cronox_editions_test_' + randomUUID().replaceAll('-', '');
const out = path.resolve(backend, '../output/playwright/product-editions');
const report = { database: name, checks: [] };
async function main() {
  const env = loadLocalEnvironment(), source = new URL(env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  source.search = '';
  const control = new Client({ connectionString: source.href });
  let created = false, db;
  fs.mkdirSync(out, { recursive: true });
  const bin = 'C:/Program Files/PostgreSQL/17/bin';
  const run = (tool, args, url) => {
    const result = spawnSync(path.join(bin, tool + '.exe'), args, { env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) }, windowsHide: true, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, tool + ' failed: ' + String(result.stderr).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]'));
  };
  try {
    await control.connect();
    const identity = (await control.query('SELECT host(inet_server_addr()) AS host,current_database() AS db')).rows[0];
    assert.ok(['127.0.0.1', '::1'].includes(identity.host));
    const dump = path.join(out, 'local-copy.dump');
    run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dump], source);
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + name;
    run('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', name, dump], target);
    const sql = new Client({ connectionString: target.href }); await sql.connect();
    try {
      const before = (await sql.query('SELECT count(*)::int AS products FROM "Product"')).rows[0];
      const historyHashSql = `SELECT
        (SELECT md5(COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.id)::text,'[]')) FROM "Order" o) AS orders,
        (SELECT md5(COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id)::text,'[]')) FROM "OrderItem" i) AS items,
        (SELECT md5(COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f."itemId")::text,'[]')) FROM (SELECT "itemId","unitCostCents","productName","imageUrl" FROM "OrderItemFinancial") f) AS costs,
        (SELECT md5(COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a."orderId")::text,'[]')) FROM "FinanceArchive" a) AS archive`;
      const historicalBefore = (await sql.query(historyHashSql)).rows[0];
      const alreadyMigrated = (await sql.query(`SELECT to_regclass('"InventoryLot"') IS NOT NULL AS present`)).rows[0].present;
      const initialLots = alreadyMigrated ? (await sql.query('SELECT count(*)::int AS n FROM "InventoryLot"')).rows[0].n : 0;
      if (!alreadyMigrated) await sql.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261103120000_inventory_lots/migration.sql'), 'utf8'));
      const hasGuard = (await sql.query("SELECT to_regprocedure('cronox_check_lot_slice(text)') IS NOT NULL AS present")).rows[0].present;
      if (!hasGuard) await sql.query(fs.readFileSync(path.join(backend,'prisma/migrations/20261103121000_inventory_lot_balance_guards/migration.sql'),'utf8'));
      assert.deepEqual((await sql.query('SELECT count(*)::int AS products FROM "Product"')).rows[0], before);
      assert.deepEqual((await sql.query(historyHashSql)).rows[0], historicalBefore);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM "InventoryLot"')).rows[0].n, initialLots);
      const preview = { products:before.products, existingLots:initialLots, allocations:(await sql.query('SELECT count(*)::int AS n FROM "InventoryLotAllocation"')).rows[0].n, physicalSales:(await sql.query('SELECT count(*)::int AS n FROM "PointSale"')).rows[0].n };
      fs.writeFileSync(path.join(out,'migration-preview.json'),JSON.stringify(preview,null,2));
      const migration=fs.readFileSync(path.join(backend,'prisma/migrations/20261103130000_lot_product_editions/migration.sql'),'utf8');
      await sql.query('BEGIN'); await sql.query(migration); await sql.query('COMMIT');
      const lotsAfter=(await sql.query('SELECT count(*)::int AS n FROM "InventoryLot"')).rows[0].n;
      await sql.query('BEGIN'); await sql.query(migration); await sql.query('COMMIT');
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM "InventoryLot"')).rows[0].n,lotsAfter);
      assert.deepEqual((await sql.query(historyHashSql)).rows[0],historicalBefore);
      assert.equal((await sql.query('SELECT count(*)::int AS n FROM "Product" WHERE "activeLotId" IS NULL')).rows[0].n,0);
      report.checks.push('Migration retry preserves history, stock provenance and exactly one active edition per product');
    } finally { await sql.end(); }
    Object.assign(process.env, env, { DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href, BACKGROUND_JOBS_ENABLED: 'false', EMAIL_ENABLED: 'false' });
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaClient } = require('@prisma/client'); db = new PrismaClient(); await db.$connect();
    const { ProductEditionsService } = require('../src/admin/lots/product-editions.service');
    const { allocateLots, returnLots, sourceCosts, consumeLots } = require('../src/inventory-lots/lot-ledger');
    const { frozenCost } = require('../src/inventory-lots/lot-costs');
    const editions = new ProductEditionsService(db);
    const admin=await db.user.create({data:{email:name+'@test.invalid',role:'SUPERADMIN'}});
    const empty=await db.product.create({data:{name:'First known receipt',slug:name+'-empty',price:9000,variants:{create:{size:'M',sku:name+'-empty-M',stockQty:0}}}});
    const opening=(await editions.list(empty.id)).lots[0],emptyVariant=opening.profile.variants[0].id;
    await editions.save(empty.id,opening.id,{revision:opening.revision,unitCostCents:2500,expectedStocks:[{size:'M',available:0}],variants:[{size:'M',stockQty:1}],receivedAt:'2026-11-03',freightTotalCents:0,otherTotalCents:0},admin.id);
    await db.$transaction(async tx=>{await tx.productVariant.update({where:{id:emptyVariant},data:{stockQty:{decrement:1}}});await allocateLots(tx,emptyVariant,1,'order:known-opening','SOLD');});
    const knownOpening=await db.$transaction(tx=>sourceCosts(tx,'order:known-opening',emptyVariant));
    assert.equal(frozenCost(knownOpening),2500);assert.ok(knownOpening.every(p=>p.quality==='CONFIRMED'));
    report.checks.push('First documented receipt in an empty opening edition keeps its known cost confirmed despite zero-balance migration rows');
    // Date-only edits and replay after a lost response must never create stock.
    let openingState=await editions.list(empty.id), dated=openingState.lots[0];
    openingState=await editions.save(empty.id,dated.id,{revision:dated.revision,receivedAt:'2026-03-29'},admin.id,randomUUID());
    dated=openingState.lots[0];assert.equal(dated.receivedAt,'2026-03-29');
    assert.equal(dated.slices.reduce((n,s)=>n+s.received,0),1);
    const receiptKey=randomUUID(),receiptDto={revision:dated.revision,expectedStocks:[{size:'M',available:0}],variants:[{size:'M',stockQty:1}],receiptReceivedAt:'2026-10-25',otherTotalCents:200};
    const restock=await db.restockRequest.create({data:{userId:admin.id,variantId:emptyVariant}});
    openingState=await editions.save(empty.id,dated.id,receiptDto,admin.id,receiptKey);
    const committed=openingState.lots[0];
    const replayed=(await editions.save(empty.id,dated.id,receiptDto,admin.id,receiptKey)).lots[0];
    assert.equal(replayed.revision,committed.revision);assert.equal(replayed.receivedAt,'2026-03-29');
    assert.equal(replayed.slices.reduce((n,s)=>n+s.received,0),2);
    assert.equal(replayed.otherTotalCents,200);assert.equal(replayed.freightTotalCents,0);
    const receiptAudit=replayed.history.find(h=>h.after?.saveRequestKey===receiptKey);
    assert.equal(receiptAudit.after.receipt.receivedAt,'2026-10-25');
    assert.equal(receiptAudit.after.receipt.freightTotalCents,0);
    await assert.rejects(editions.save(empty.id,dated.id,{...receiptDto,receivedAt:'2026-11-01'},admin.id,receiptKey));
    await assert.rejects(editions.save(empty.id,dated.id,{revision:replayed.revision,otherTotalCents:1},admin.id,randomUUID()));
    await assert.rejects(editions.save(empty.id,dated.id,{revision:replayed.revision,freightTotalCents:1},admin.id,randomUUID()));
    assert.deepEqual((await editions.list(empty.id)).lots[0],replayed);
    const queued=await db.restockRequest.findUniqueOrThrow({where:{id:restock.id}});assert.equal(queued.status,'QUEUED');
    await editions.save(empty.id,dated.id,{revision:replayed.revision,receivedAt:replayed.receivedAt},admin.id,randomUUID());
    const unchanged=await db.restockRequest.findUniqueOrThrow({where:{id:restock.id}});
    assert.equal(unchanged.readyAt.toISOString(),queued.readyAt.toISOString());
    report.checks.push('Saving an unchanged active profile preserves the restock uninterrupted-availability deadline');
    report.checks.push('Calendar date correction without stock, separate receipt dates, zero included freight, additional costs, idempotent committed replay and rejected conflicting retries');
    const product=await db.product.create({data:{name:'ASHEN SHELL',slug:name,price:9000,description:'Composicion original',variants:{create:[{size:'M',sku:name+'M',stockQty:2},{size:'L',sku:name+'L',stockQty:0}]},images:{create:[{url:'https://example.invalid/first.webp',alt:'Primera foto',isPrimary:true}]}}});
    let state=await editions.list(product.id); const first=state.lots[0], m=first.profile.variants.find(v=>v.size==='M').id;
    assert.equal(state.lots.length,1);assert.equal(state.product.activeLotId,first.id);assert.equal(first.profile.price,9000);
    const key=randomUUID(); let duplicated=await editions.duplicate(product.id,first.id,first.revision,key,admin.id); const secondId=duplicated.id;
    assert.equal((await editions.duplicate(product.id,first.id,first.revision,key,admin.id)).id,secondId);
    let second=duplicated.lots.find(l=>l.id===secondId);
    assert.equal(second.profile.price,9000);assert.equal(second.profile.images[0].url,first.profile.images[0].url);assert.equal(second.profile.variants[0].stockQty,0);
    state=await editions.save(product.id,secondId,{revision:second.revision,expectedStocks:[{size:'M',available:0},{size:'L',available:0}],price:11000,description:'Composicion segunda',unitCostCents:3500,receivedAt:'2026-11-03',freightTotalCents:0,otherTotalCents:3,variants:[{size:'M',stockQty:2},{size:'L',stockQty:0}],galleryImages:[{url:'https://example.invalid/second.webp',alt:'Segunda foto',isPrimary:true,isActive:true,sortOrder:0,galleryPositionX:40,galleryPositionY:60,galleryZoom:1.2,galleryFit:'CONTAIN'}]},admin.id);
    assert.equal((await db.product.findUnique({where:{id:product.id}})).price,9000);
    // A reserved purchase of edition 1 remains valid when edition 2 is activated.
    await db.$transaction(async tx=>{await tx.productVariant.update({where:{id:m},data:{stockQty:{decrement:1}}});await allocateLots(tx,m,1,'checkout:old-valid','RESERVED');});
    const frozen=await db.$transaction(tx=>sourceCosts(tx,'checkout:old-valid',m));assert.equal(frozen[0].lotId,first.id);
    second=state.lots.find(l=>l.id===secondId);await editions.activate(product.id,secondId,second.revision,admin.id);
    const live=await db.product.findUnique({where:{id:product.id},include:{images:true,variants:true}});
    assert.equal(live.price,11000);assert.equal(live.slug,name);assert.equal(live.description,'Composicion segunda');assert.equal(live.images[0].url,'https://example.invalid/second.webp');assert.equal(live.variants.find(v=>v.id===m).stockQty,2);
    state=await editions.list(product.id);assert.equal(state.lots.find(l=>l.id===first.id).profile.price,9000);assert.equal(state.lots.find(l=>l.id===first.id).profile.images[0].url,'https://example.invalid/first.webp');
    await db.$transaction(tx=>consumeLots(tx,'old-valid',123456));
    await db.$transaction(async tx=>{await tx.productVariant.update({where:{id:m},data:{stockQty:{increment:1}}});await returnLots(tx,m,1,'order:123456');});
    assert.equal((await db.productVariant.findUnique({where:{id:m}})).stockQty,2);
    const reserve = source => db.$transaction(async tx=>{const updated=await tx.productVariant.updateMany({where:{id:m,stockQty:{gte:2}},data:{stockQty:{decrement:2}}});if(!updated.count)throw Error('No stock');await allocateLots(tx,m,2,source,'RESERVED');});
    const attempts=await Promise.allSettled([reserve('checkout:new-a'),reserve('checkout:new-b')]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
    const saleSource=attempts[0].status==='fulfilled'?'checkout:new-a':'checkout:new-b';const newCosts=await db.$transaction(tx=>sourceCosts(tx,saleSource,m));assert.ok(newCosts.every(c=>c.lotId===secondId));assert.equal(frozenCost(newCosts),7003);
    assert.equal((await db.productVariant.findUnique({where:{id:m}})).stockQty,0);
    assert.equal((await db.inventoryLotSlice.aggregate({where:{lotId:first.id},_sum:{available:true}}))._sum.available,2);
    // Edition 3 copies the selected source, even while another edition is active.
    const third=await editions.duplicate(product.id,first.id,first.revision,randomUUID(),admin.id);assert.equal(third.lots.find(l=>l.id===third.id).profile.price,9000);
    await Promise.all([editions.activate(product.id,first.id,first.revision,admin.id),editions.activate(product.id,third.id,1,admin.id)]);
    const end=await editions.list(product.id);assert.equal(end.lots.length,3);assert.ok([first.id,third.id].includes(end.product.activeLotId));
    await db.product.update({where:{id:product.id},data:{isActive:false}});await editions.activate(product.id,first.id,first.revision,admin.id);assert.equal((await db.product.findUnique({where:{id:product.id}})).isActive,false);
    await assert.rejects(db.product.update({where:{id:product.id},data:{activeLotId:null}}));
    await db.product.update({where:{id:product.id},data:{isActive:true}});
    const { CartService }=require('../src/cart/cart.service');const { OrdersService }=require('../src/orders/orders.service');const { Prisma }=require('@prisma/client');
    const cartService=new CartService(db),orders=Object.create(OrdersService.prototype);
    const buyer=await db.user.create({data:{email:randomUUID()+'@test.invalid'}});
    const oldCart=await cartService.addItem({userId:buyer.id},{variantId:m,qty:1});
    orders.assertCartEligibleForCheckout(oldCart);
    await editions.activate(product.id,secondId,second.revision,admin.id);
    const changedCart=await cartService.getCartForCurrentUser(buyer.id);
    assert.throws(()=>orders.assertCartEligibleForCheckout(changedCart),e=>e.getResponse().code==='PRODUCT_EDITION_CHANGED');
    // Release the new-edition reservation; accepting the current cart explicitly updates its price/edition.
    await db.$transaction(async tx=>{await tx.productVariant.update({where:{id:m},data:{stockQty:{increment:2}}});await returnLots(tx,m,2,saleSource,true);});
    const accepted=await cartService.updateItem({userId:buyer.id},oldCart.items[0].id,{qty:1});assert.equal(accepted.items[0].priceAtAdd,11000);orders.assertCartEligibleForCheckout(accepted);
    const snapshot=await db.checkoutSnapshot.create({data:{userId:buyer.id,customerEmail:buyer.email,cartId:accepted.id,cartUpdatedAt:new Date(),requestFingerprint:randomUUID(),subtotalCents:11000,taxRate:'0.21',taxAmountCents:1909,totalCents:11000,expiresAt:new Date(Date.now()-1000),items:{create:{productId:product.id,variantId:m,title:'ASHEN SHELL M',unitPriceCents:11000,quantity:1,lineTotalCents:11000,financialSnapshot:{create:{productName:'ASHEN SHELL',unitCostCents:null}}}}},include:{items:true}});
    const line={productId:product.id,variantId:m,lotId:secondId,title:'ASHEN SHELL M',quantity:1,unitPrice:new Prisma.Decimal(110),lineTotal:new Prisma.Decimal(110)};
    const { freezeCheckoutLots }=require('../src/inventory-lots/lot-financial');
    await db.$transaction(async tx=>{await orders.reserveStockForCheckoutSnapshot(tx,snapshot.id,[line]);await freezeCheckoutLots(tx,snapshot.id);});
    const frozenSnapshot=await db.checkoutItemFinancial.findUnique({where:{itemId:snapshot.items[0].id}});
    assert.equal(frozenSnapshot.lotCosts[0].lotId,secondId);
    await editions.activate(product.id,first.id,first.revision,admin.id);
    await assert.rejects(db.$transaction(tx=>orders.reserveStockForCheckoutSnapshot(tx,'raced',[line])),e=>e.getResponse().code==='PRODUCT_EDITION_CHANGED');
    await db.$transaction(tx=>orders.releaseStockReservationsForCheckoutSnapshot(tx,snapshot));await db.$transaction(tx=>orders.releaseStockReservationsForCheckoutSnapshot(tx,snapshot));
    assert.equal((await db.productVariant.findUnique({where:{id:m}})).stockQty,2);
    assert.deepEqual((await db.checkoutItemFinancial.findUnique({where:{itemId:snapshot.items[0].id}})).lotCosts,frozenSnapshot.lotCosts);
    const { AdminPointsService }=require('../src/admin/points/admin-points.service');const points=new AdminPointsService(db);
    const point=await db.salePoint.create({data:{name:'Edition test',type:'EVENT',city:'',venue:'',notes:'',commissionBp:0}});
    const sale=await points.sale(point.id,admin.id,randomUUID(),{occurredAt:'2026-11-03T14:00:00Z',stockHandling:'DEDUCT_NOW',note:'',paymentMethod:'CASH',lines:[{variantId:m,lotId:secondId,quantity:1,unitPriceCents:11000,commissionBp:0}]});
    assert.equal(sale.lines[0].lotCosts[0].lotId,secondId);assert.equal((await db.productVariant.findUnique({where:{id:m}})).stockQty,2);
    const pointSale=await db.pointSale.findUnique({where:{id:sale.saleId}});
    await points.refund(point.id,sale.saleId,admin.id,randomUUID(),{occurredAt:'2026-11-03T15:00:00Z',revision:pointSale.revision,reason:'Prueba retorno tirada original',lines:[{id:pointSale.state.lines[0].id,quantity:1,restock:true,recoveredCommissionCents:0}]});
    assert.equal((await db.productVariant.findUnique({where:{id:m}})).stockQty,2);
    const noDeduct=await points.sale(point.id,admin.id,randomUUID(),{occurredAt:'2026-11-03T16:00:00Z',stockHandling:'ALREADY_ADJUSTED',note:'',paymentMethod:'CASH',lines:[{variantId:m,lotId:secondId,quantity:1,unitPriceCents:11000,commissionBp:0}]});assert.equal((await db.pointSale.findUnique({where:{id:noDeduct.saleId}})).state.lines[0].lotId,secondId);
    report.checks.push('Real cart rejects changed edition until explicit review; checkout revalidates after locking, freezes original costs, expires once; physical inactive-edition sale/refund and Already adjusted preserve public stock');
    report.checks.push('ASHEN SHELL 90/110: complete independent profiles, zero-stock idempotent copy, atomic activation, unchanged URL, selected-source duplication, concurrent activations, hidden product preserved');
    report.checks.push('Reservations retain original edition; returns to inactive edition do not increase public stock; new sales cannot consume inactive stock; exact frozen costs and simultaneous stock protection');
  } finally {
    if (db) await db.$disconnect();
    if (created) { assert.match(name, /^cronox_editions_test_[a-f0-9]{32}$/); await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); report.cleanedUp = true; }
    await control.end(); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report));
}
main().catch(e => { console.error(String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
