// Source is opened only by `export`, inside a REPEATABLE READ / READ ONLY transaction.
// `import` opens only the isolated database; no storefront/product/cost writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const dotenv = require('dotenv');
const { loadLocalEnvironment } = require('./start-local.cjs');
const root = path.resolve(__dirname, '../..');
const defaultFile = path.join(root, 'test-results/local-admin/order-snapshot.json');
const fields = {
 Order: 'id status preDisputeStatus shippingCarrier shippedAt deliveredAt subtotal taxRate taxAmount shippingCost shippingMethodCode discountCents promoCodeCode disputeLostCents total currency provider providerRef source paymentMethod purchasedAt manualStockHandling voidedAt createdAt updatedAt paidAt',
 OrderItem: 'id orderId productId variantId title unitPrice quantity lineTotal',
 OrderItemFinancial: 'itemId unitCostCents productName imageUrl',
 StripeWebhookEvent: 'id type paymentIntentId lifecycleStatus amountCents refundCumulativeCents status occurredAt processedAt createdAt updatedAt',
 StockMovement: 'id variantId delta reason createdAt orderId',
};
const key = name => name[0].toLowerCase() + name.slice(1);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const alias = value => value == null ? null : `local_snapshot_${hash(String(value))}`;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = value => hash(canonical(value));
const safeWrite = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(`${file}.tmp`, JSON.stringify(value,null,2)); fs.renameSync(`${file}.tmp`,file); };
const metricSql = `SELECT currency, status, COUNT(*)::int AS count,
 SUM(total)::text AS total, SUM(subtotal)::text AS subtotal,
 SUM("discountCents")::text AS discountCents, SUM("shippingCost")::text AS shippingCents
 FROM "Order" GROUP BY currency,status ORDER BY currency,status`;

async function readTable(tx, name, columns, suffix = '', args = []) {
 const available = columns.filter(c => fields[name].split(' ').includes(c));
 return tx.$queryRawUnsafe(`SELECT ${available.map(c=>`"${c}"`).join(',')} FROM "${name}" ${suffix}`, ...args);
}
async function exportSnapshot(file, sourceFile) {
 const source = dotenv.parse(fs.readFileSync(sourceFile));
 const url = new URL(source.DATABASE_URL);
 if (url.hostname !== 'aws-1-eu-west-1.pooler.supabase.com' || url.pathname !== '/postgres') throw Error('Unexpected source: review the exporter allowlist before using another database.');
 const db = new PrismaClient({datasources:{db:{url:source.DATABASE_URL}}});
 try {
  const snapshot = await db.$transaction(async tx => {
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const schema = await tx.$queryRawUnsafe(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'`);
   const columns = name => schema.filter(c=>c.table_name===name).map(c=>c.column_name).filter(c=>fields[name].split(' ').includes(c));
   const tables = {};
   tables.Order = await readTable(tx,'Order',columns('Order'));
   const orderIds = tables.Order.map(o=>o.id);
   tables.OrderItem = orderIds.length ? await readTable(tx,'OrderItem',columns('OrderItem'),'WHERE "orderId" IN (SELECT value::int FROM jsonb_array_elements_text($1::jsonb))',[JSON.stringify(orderIds)]) : [];
   tables.OrderItemFinancial = columns('OrderItemFinancial').length && orderIds.length
    ? await readTable(tx,'OrderItemFinancial',columns('OrderItemFinancial'),'WHERE "itemId" IN (SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT value::int FROM jsonb_array_elements_text($1::jsonb)))',[JSON.stringify(orderIds)]) : [];
   const refs = tables.Order.map(o=>o.providerRef).filter(Boolean);
   tables.StripeWebhookEvent = refs.length ? await readTable(tx,'StripeWebhookEvent',columns('StripeWebhookEvent'),'WHERE "paymentIntentId" IN (SELECT value FROM jsonb_array_elements_text($1::jsonb))',[JSON.stringify(refs)]) : [];
   tables.StockMovement = orderIds.length ? await readTable(tx,'StockMovement',columns('StockMovement'),`WHERE "orderId" IN (SELECT value::int FROM jsonb_array_elements_text($1::jsonb)) AND delta>0 AND reason IN ('refund','manual_sale_void')`,[JSON.stringify(orderIds)]) : [];
   for (const o of tables.Order) {
    o.providerRef=alias(o.providerRef);
    o.promoCodeCode=alias(o.promoCodeCode);
    o.customerEmail=`order-${o.id}@snapshot.invalid`;
    // Explicitly do not infer paidAt, discount codes, customer identity or costs.
    if (!Object.hasOwn(o,'paidAt')) o.paidAt=null;
   }
   for (const e of tables.StripeWebhookEvent) {e.id=alias(e.id);e.paymentIntentId=alias(e.paymentIntentId);if(!Object.hasOwn(e,'refundCumulativeCents'))e.refundCumulativeCents=null;}
   for (const m of tables.StockMovement) m.id=alias(m.id);
   const diagnostics = {
    orderCount: orderIds.length, lineCount: tables.OrderItem.length,
    standaloneEventCount: await tx.stripeWebhookEvent.count(),
    checkoutCount: await tx.checkoutSnapshot.count(),
    archivedPaymentCount: await tx.archivedCheckoutPayment.count(),
   };
   return {version:1,source:`${url.hostname}:${url.port||5432}${url.pathname}`,capturedAt:new Date().toISOString(),period:'All retained orders at capture time; all linked historical events',
    metrics:(await tx.$queryRawUnsafe(metricSql)).sort((a,b)=>a.currency.localeCompare(b.currency)||a.status.localeCompare(b.status)),diagnostics,tables,
    limitations:['No customer identities, addresses, tracking identifiers, free-text notes or live payment identifiers.',
     'No historical cost inferred from current ProductCost. Missing cost snapshots remain unavailable.',
     'No conversion of abandoned checkouts or archived test-payment references into orders.',
     'Missing payment/refund timestamps or ambiguous partial refunds remain unknown in finance.']};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60000});
  // JSON normalizes Prisma decimals/dates without converting money through floats.
  safeWrite(file,snapshot);
  console.log(JSON.stringify({file,source:snapshot.source,diagnostics:snapshot.diagnostics,metrics:snapshot.metrics},null,2));
 } finally {await db.$disconnect();}
}

function validateSnapshot(snapshot) {
 if(snapshot.version!==1||!snapshot.tables||Object.keys(snapshot.tables).some(n=>!Object.hasOwn(fields,n)))throw Error('Invalid snapshot format');
 for(const name of Object.keys(fields)) {
  if(!Array.isArray(snapshot.tables[name]))throw Error(`Missing ${name}`);
  const allowed=new Set(fields[name].split(' '));if(name==='Order')allowed.add('customerEmail');
  for(const row of snapshot.tables[name]) {
   if(Object.keys(row).some(k=>!allowed.has(k)))throw Error(`Unapproved field in ${name}`);
   for(const k of ['providerRef','paymentIntentId','promoCodeCode'])if(row[k]!=null&&!/^local_snapshot_[a-f0-9]{64}$/.test(row[k]))throw Error('Live external reference rejected');
   if(['StripeWebhookEvent','StockMovement'].includes(name)&&!/^local_snapshot_[a-f0-9]{64}$/.test(row.id))throw Error('Unmasked event/movement identifier');
   if(name==='Order'&&row.customerEmail!==`order-${row.id}@snapshot.invalid`)throw Error('Customer must be anonymized');
  }
 }
}
async function importSnapshot(file) {
 const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));validateSnapshot(snapshot);
 const env=loadLocalEnvironment();const url=new URL(env.DATABASE_URL);
 if(url.hostname!=='127.0.0.1'||url.port!=='5433'||url.pathname!=='/cronox_dev')throw Error('Import requires isolated 127.0.0.1:5433/cronox_dev');
 const manifestFile=path.join(root,'test-results/local-admin/order-snapshot-imported.json');
 const previous=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{tables:{}};
 const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
 try {
  const result=await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('LOCK TABLE "Order", "OrderItem", "OrderItemFinancial", "StripeWebhookEvent", "StockMovement" IN SHARE ROW EXCLUSIVE MODE');
   const sourceIds=snapshot.tables.Order.map(row=>row.id);
   if(await tx.order.count({where:{id:{notIn:sourceIds}}}))throw Error('Local orders outside this snapshot exist; refusing to mix histories or remove local changes. Review the conflict first.');
   const manifest={tables:{}};const counts={};
   for(const name of Object.keys(fields)) {
    const pk=name==='OrderItemFinancial'?'itemId':'id';
    manifest.tables[name]={};counts[name]=0;
    for(const row of snapshot.tables[name]) {
     if(name==='OrderItem') {
      const product=await tx.product.findUnique({where:{id:row.productId},select:{id:true}});
      const variant=row.variantId==null?null:await tx.productVariant.findUnique({where:{id:row.variantId},select:{productId:true}});
      if(!product||(row.variantId!=null&&variant?.productId!==row.productId))throw Error(`Missing/conflicting catalogue link for line ${row.id}; no catalogue changes made.`);
     }
     const existing=await tx[key(name)].findUnique({where:{[pk]:row[pk]}});
     if(existing) {
      const old=previous.tables[name]?.[row[pk]];
      if(!old||digest(existing)!==old.localHash||digest(row)!==old.sourceHash)throw Error(`Conflict in ${name} ${row[pk]}: local or source row changed; nothing overwritten. Review differences before refreshing.`);
     } else {
      if(previous.tables[name]?.[row[pk]])throw Error(`Locally removed ${name} ${row[pk]}; refusing to restore silently.`);
      await tx[key(name)].create({data:row});counts[name]++;
     }
     const saved=await tx[key(name)].findUnique({where:{[pk]:row[pk]}});
     manifest.tables[name][row[pk]]={localHash:digest(saved),sourceHash:digest(row)};
    }
    for(const id of Object.keys(previous.tables[name]||{}))if(!manifest.tables[name][id])throw Error(`Source removed ${name} ${id}; refusing to delete local history.`);
   }
   for(const name of ['Order','OrderItem'])await tx.$queryRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${name}"','id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${name}"),1),(SELECT last_value FROM "${name}_id_seq")), EXISTS(SELECT 1 FROM "${name}"))`);
   const ids=snapshot.tables.Order.map(o=>o.id);
   const localRows=ids.length?await tx.order.findMany({where:{id:{in:ids}},select:{id:true,total:true,subtotal:true,currency:true,status:true,discountCents:true,shippingCost:true}}):[];
   const groups=new Map();
   for(const row of localRows){const k=`${row.currency}/${row.status}`;const g=groups.get(k)||{currency:row.currency,status:row.status,count:0,total:new Prisma.Decimal(0),subtotal:new Prisma.Decimal(0),discountCents:0n,shippingCents:0n};g.count++;g.total=g.total.plus(row.total);g.subtotal=g.subtotal.plus(row.subtotal);g.discountCents+=BigInt(row.discountCents);g.shippingCents+=BigInt(row.shippingCost);groups.set(k,g);}
   const localMetrics=[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||a.status.localeCompare(b.status)).map(g=>({...g,total:g.total.toFixed(2),subtotal:g.subtotal.toFixed(2),discountCents:String(g.discountCents),shippingCents:String(g.shippingCents)}));
   if(digest(localMetrics)!==digest(snapshot.metrics))throw Error('Reconciliation failed; transaction rolled back.');
   return {manifest,counts,localMetrics,orderCount:localRows.length};
  },{timeout:60000});
  safeWrite(manifestFile,result.manifest);
  const report={capturedAt:snapshot.capturedAt,source:snapshot.source,period:snapshot.period,imported:result.counts,orderCount:result.orderCount,sourceMetrics:snapshot.metrics,localMetrics:result.localMetrics,reconciled:true,emptySource:snapshot.tables.Order.length===0,limitations:snapshot.limitations};
  safeWrite(path.join(root,'test-results/local-admin/order-snapshot-reconciliation.json'),report);
  console.log(JSON.stringify(report,null,2));
 }finally{await db.$disconnect();}
}
if(require.main===module){const [command,file=defaultFile,sourceFile=path.join(root,'cronox-backend/.env')]=process.argv.slice(2);Promise.resolve().then(()=>{
 if(command==='export')return exportSnapshot(path.resolve(file),path.resolve(sourceFile));
 if(command==='import')return importSnapshot(path.resolve(file));
 throw Error('Usage: node scripts/local-order-snapshot.cjs export|import [snapshot.json] [source.env for export only]');
}).catch(e=>{console.error(e.code||e.message);process.exitCode=1});}
module.exports={validateSnapshot,alias,digest};
