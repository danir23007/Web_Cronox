'use strict';
// Read-only preview. Run against the verified local copy before deployment;
// no costs, receipt dates, manufactured quantities or historical lots are guessed.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
async function main() {
  const env = loadLocalEnvironment(), url = new URL(env.DATABASE_URL);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw Error('Use a verified loopback copy.');
  url.search = '';
  const db = new Client({ connectionString: url.href });
  await db.connect();
  try {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await db.query('SELECT host(inet_server_addr()) AS host,current_database() AS database')).rows[0];
    if (!['127.0.0.1','::1'].includes(identity.host)) throw Error('Server must identify as loopback.');
    const products = (await db.query('SELECT id,slug,name,price FROM "Product" ORDER BY id')).rows;
    const variants = (await db.query('SELECT id,"productId",size,stock FROM "ProductVariant" ORDER BY "productId",id')).rows;
    const reservations = (await db.query('SELECT "variantId",sum(quantity)::int AS quantity FROM "CheckoutStockReservation" WHERE status=\'RESERVED\' GROUP BY "variantId" ORDER BY "variantId"')).rows;
    const history = (await db.query('SELECT i."productId",count(*)::int AS lines,count(f."unitCostCents")::int AS known_costs FROM "OrderItem" i LEFT JOIN "OrderItemFinancial" f ON f."itemId"=i.id GROUP BY i."productId" ORDER BY i."productId"')).rows;
    const applied = new Set((await db.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map(r => r.migration_name));
    const pendingMigrations = fs.readdirSync(path.join(__dirname,'../prisma/migrations'),{withFileTypes:true}).filter(e => e.isDirectory() && !applied.has(e.name)).map(e => e.name).sort();
    const preview = { identity, pendingMigrations, products: products.map(p => ({ ...p, proposal: { name: 'Saldo inicial pendiente de conciliación', receivedAt: null, productionCents: null, freightCents: null, otherCents: null, automaticallyAssignHistoricalSales: false }, variants: variants.filter(v => v.productId===p.id).map(v => ({ ...v, reserved: reservations.find(r=>r.variantId===v.id)?.quantity??0 })), historical: history.find(h=>h.productId===p.id)??{lines:0,known_costs:0} })), warnings: ['Schema migration does not activate products or mutate stock/prices/history.', 'Each activation requires a fresh reviewed stock hash and zero active reservations.', 'Available stock is an observed opening balance, not manufactured quantity.', 'Historic cost snapshots remain unchanged; unknown dates, costs and lot assignments require documented reconciliation.'] };
    await db.query('COMMIT');
    const output = path.resolve(__dirname,'../../output/playwright/inventory-lots/preview.json'); fs.mkdirSync(path.dirname(output),{recursive:true});
    const body=JSON.stringify(preview,null,2);fs.writeFileSync(output,body);
    console.log(JSON.stringify({ output, products:products.length, variants:variants.length, activeReservationVariants:reservations.length, pendingMigrations, sha256:createHash('sha256').update(body).digest('hex') }));
  } finally { await db.end(); }
}
main().catch(e=>{console.error(String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
