'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {Client}=require('pg');
const {loadLocalEnvironment}=require('./start-local.cjs');
const migration='20261103130000_lot_product_editions';
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../output/playwright/product-editions');
async function main(){
  const env=loadLocalEnvironment(),url=new URL(env.DATABASE_URL);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));url.search='';
  const db=new Client({connectionString:url.href});await db.connect();fs.mkdirSync(out,{recursive:true});
  try {
    const identity=(await db.query('SELECT host(inet_server_addr()) AS host,current_database() AS database')).rows[0];assert.ok(['127.0.0.1','::1'].includes(identity.host));
    const products=(await db.query(`SELECT p.id,p.slug,p.name,p.price,(SELECT count(*)::int FROM "InventoryLot" WHERE "productId"=p.id) AS lots,(SELECT COALESCE(sum(stock),0)::int FROM "ProductVariant" WHERE "productId"=p.id) AS available,(SELECT count(*)::int FROM "ProductVariant" WHERE "productId"=p.id AND stock<0) AS negative FROM "Product" p ORDER BY p.id`)).rows;
    const reservations=(await db.query(`SELECT count(*)::int AS n FROM "CheckoutStockReservation" WHERE status='RESERVED'`)).rows[0].n;
    const preview={identity,products,reservations,proposal:'Keep existing lots and stable order; create Lote 1 only if absent. Observed stock is not a new receipt. Old financial snapshots remain unchanged. Unreconstructible profiles remain pending.'};
    fs.writeFileSync(path.join(out,'local-editions-preview.json'),JSON.stringify(preview,null,2));console.log(JSON.stringify({database:identity.database,products:products.length,lots:products.reduce((n,p)=>n+p.lots,0),reservations,apply:process.argv.includes('--apply')}));
    if(!process.argv.includes('--apply'))return;
    assert.ok(products.every(p=>p.negative===0),'Reconcile negative stock before migration');
    const applied=(await db.query('SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',[migration])).rowCount;
    if(applied){console.log('Already applied; no changes.');return;}
    const backup=path.join(out,'before-editions-local.dump');
    const dump=spawnSync('C:/Program Files/PostgreSQL/17/bin/pg_dump.exe',['--format=custom','--no-owner','--no-acl','--file',backup],{windowsHide:true,encoding:'utf8',env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1))}});assert.equal(dump.status,0,'Local backup failed');
    await db.query('BEGIN');
    try {
      await db.query('LOCK TABLE "Product","ProductVariant","InventoryLot","CheckoutStockReservation" IN SHARE ROW EXCLUSIVE MODE');
      const history=`SELECT (SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id)::text,'[]')) FROM "Order" x) AS orders,(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY "orderId")::text,'[]')) FROM "FinanceArchive" x) AS archive,(SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id)::text,'[]')) FROM "PointEntry" x) AS points`;
      const before=(await db.query(history)).rows[0];
      await db.query(fs.readFileSync(path.join(root,'prisma/migrations',migration,'migration.sql'),'utf8'));
      assert.deepEqual((await db.query(history)).rows[0],before);
      const after=(await db.query('SELECT id,slug,name,price FROM "Product" ORDER BY id')).rows;
      assert.deepEqual(after,products.map(({id,slug,name,price})=>({id,slug,name,price})));
      await db.query('COMMIT');
    }catch(e){await db.query('ROLLBACK');throw e;}
    const result=spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','resolve','--applied',migration],{cwd:root,windowsHide:true,encoding:'utf8',env:{...process.env,...env,DATABASE_URL:url.href,DIRECT_URL:url.href}});assert.equal(result.status,0,'Schema applied; migration registration must be retried');
    const summary=(await db.query('SELECT count(*)::int AS products,count("activeLotId")::int AS active FROM "Product"')).rows[0];
    fs.writeFileSync(path.join(out,'local-editions-applied.json'),JSON.stringify({migration,...summary,historyUnchanged:true,pricesSlugsUnchanged:true,productionTouched:false},null,2));console.log(JSON.stringify(summary));
  }finally{await db.end();}
}
main().catch(e=>{console.error(String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
