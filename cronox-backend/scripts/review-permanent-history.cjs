/* Isolated local review/integration harness. Never imports main.ts or loads .env.
 * No production data, Stripe calls, SMTP, or remote storage. Requires PostgreSQL binaries.
 * Usage: node scripts/review-permanent-history.cjs [--serve]
 */
'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '..');
const pgBin = process.env.FINANCE_PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/17/bin' : '/usr/bin');
const executable = name => path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : ''));
const run = (command, args, options = {}) => execFileSync(command, args, { windowsHide:true, stdio:'pipe', ...options });

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cronox-finance-review-'));
  const dbDir = path.join(dir, 'pg');
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const pgPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  run(executable('initdb'), ['-D', dbDir, '-U', 'finance_review', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  run(executable('pg_ctl'), ['-D',dbDir,'-l',path.join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${pgPort}`,'-w','start'], {stdio:'ignore'});
  const url = `postgresql://finance_review@127.0.0.1:${pgPort}/postgres`;
  assert.equal(new URL(url).hostname,'127.0.0.1');
  let app, db, stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    if (app) await app.close();
    if (db) await db.$disconnect();
    run(executable('pg_ctl'), ['-D',dbDir,'-m','fast','-w','stop']);
  };
  process.once('SIGINT', () => void stop().then(() => process.exit(0)));
  process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
  process.stdin.on('data', data => { if (String(data).trim() === 'stop') void stop().then(() => process.exit(0)); });
  try {
    const schema = (await fs.readFile(path.join(backend,'prisma/schema.prisma'),'utf8'))
      .replace(/^.*(?:privateCost\s+ProductCost|financialSnapshot\s+(?:CheckoutItemFinancial|OrderItemFinancial)|refundCumulativeCents\s+Int|paidAt\s+DateTime).*\r?\n/gm,'')
      .replace(/model (?:ProductCost|CheckoutItemFinancial|OrderItemFinancial) \{[\s\S]*?\n\}/g,'');
    const historicalBase = schema.replace(/^.*dailyVisits\s+DailyVisitor\[\].*\r?\n/gm,'')
      .replace(/model (?:VisitorHistoryConfig|DailyVisitor|FinanceArchive|FinanceArchiveRevision|FinanceEventArchive|FinanceStockArchive) \{[\s\S]*?\n\}/g,'');
    const schemaFile = path.join(dir,'before.prisma'); await fs.writeFile(schemaFile,historicalBase);
    const baseSql = run(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',schemaFile,'--script'],{cwd:dir,env:{...process.env,DATABASE_URL:url}});
    const baseFile = path.join(dir,'base.sql');
    await fs.writeFile(baseFile, 'CREATE EXTENSION IF NOT EXISTS pg_trgm;\nCREATE ROLE anon; CREATE ROLE authenticated;\n'+baseSql);
    const sql = file => run(executable('psql'),[url,'-v','ON_ERROR_STOP=1','-f',file]);
    sql(baseFile);
    const beforeFile = path.join(dir,'before-data.sql');
    await fs.writeFile(beforeFile, `INSERT INTO "Product" (id,slug,name,price,"updatedAt") VALUES (9000,'legacy-local','Producto histórico local',2000,NOW());`);
    sql(beforeFile);
    sql(path.join(backend,'prisma/migrations/20260926120000_private_product_finance/migration.sql'));
    const legacyOrder = path.join(dir,'legacy-order.sql');
    await fs.writeFile(legacyOrder, `INSERT INTO "Order" (id,status,subtotal,total,"taxRate","taxAmount","customerEmail","createdAt","updatedAt") VALUES (9000,'PAID',20,20,0,0,'legacy@example.test','2019-01-01','2019-01-01');
      INSERT INTO "OrderItem" ("orderId","productId",title,"unitPrice",quantity,"lineTotal") VALUES (9000,9000,'Producto histórico superviviente',20,1,20);`);
    sql(legacyOrder);
    const historyMigration = path.join(backend,'prisma/migrations/20261002120000_permanent_visitor_finance_history/migration.sql');
    sql(historyMigration); sql(historyMigration);
    console.log('PASS: migration applied to new isolated PostgreSQL; pre-existing product preserved.');
    // A temporary working directory prevents ConfigModule from discovering the real .env.
    process.chdir(dir);
    require(path.join(backend,'test/test-environment.cjs')).installTestEnvironment({force:true,overrides:{
      DATABASE_URL:url,CRONOX_ROUTE_SMOKE_MODE:'true',WAITLIST_EMAIL_WORKER_ENABLED:'false',
      EMAIL_ENABLED:'false',FRONTEND_URL:'http://127.0.0.1:43120',API_PUBLIC_URL:'http://127.0.0.1:43120',CORS_ORIGINS:'http://127.0.0.1:43120',
      SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',PORT:'43120',
    }});
    for (const key of Object.keys(process.env)) if (key.includes('SMTP')) delete process.env[key];
    const { PrismaClient } = require('@prisma/client'); db = new PrismaClient({datasources:{db:{url}}});
    assert.equal((await db.product.findUnique({where:{id:9000}})).name,'Producto histórico local');
    assert.equal(await db.productCost.count(),0);
    const protectedTables = await db.$queryRawUnsafe(`SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('ProductCost','OrderItemFinancial','CheckoutItemFinancial')`);
    assert(protectedTables.every(table => table.relrowsecurity));
    for (const table of protectedTables) for (const role of ['anon','authenticated']) {
      const result = await db.$queryRawUnsafe(`SELECT has_table_privilege($1, $2, 'SELECT') AS allowed`,role,`"${table.relname}"`);
      assert.equal(result[0].allowed,false);
    }
    console.log('PASS: costs unavailable to Supabase anon/authenticated roles; no historical cost backfill.');
    const { NestFactory } = require('@nestjs/core');
    const { ValidationPipe } = require('@nestjs/common');
    const { AppModule } = require(path.join(backend,'dist/app.module'));
    app = await NestFactory.create(AppModule,{logger:['error']});
    app.setGlobalPrefix('api'); app.use(require('cookie-parser')());
    app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true}));
    app.use((req,res,next) => { res.cookie('cronox_csrf_token','local-finance-review-csrf-token-0000',{sameSite:'lax'}); next(); });
    app.use(async (req,res,next) => {
      if (req.method !== 'GET' || !/^\/[a-z0-9-]+\.html$/.test(req.path)) return next();
      try {
        const html = await fs.readFile(path.join(root,'cronox-front',req.path.slice(1)),'utf8');
        res.type('html').send(html.replace('<head>','<head><meta name="cronox:api-base" content="http://127.0.0.1:43120">'));
      } catch { next(); }
    });
    const { AuthSessionsService } = require(path.join(backend,'dist/auth/auth-sessions.service'));
    const admin = await db.user.create({data:{email:'admin-finance@example.test',role:'SUPERADMIN',name:'Revisión local'}});
    const customer = await db.user.create({data:{email:'customer-finance@example.test',role:'USER',name:'Cliente de prueba'}});
    const token = await app.get(AuthSessionsService).create(admin);
    const customerToken = await app.get(AuthSessionsService).create(customer);
    app.getHttpAdapter().getInstance().get('/__review/admin',(_req,res) => { res.cookie('jwt',token.accessToken,{httpOnly:true,sameSite:'lax'}); res.cookie('refresh_token',token.refreshToken,{httpOnly:true,sameSite:'lax'}); res.redirect('/admin.html'); });
    await app.listen(43120,'127.0.0.1');
    const request = async (route, options = {}, access = token.accessToken) => {
      const response = await fetch('http://127.0.0.1:43120/api'+route,{...options,headers:{Authorization:`Bearer ${access}`,Origin:'http://127.0.0.1:43120',Cookie:'cronox_csrf_token=local-finance-review-csrf-token-0000','x-csrf-token':'local-finance-review-csrf-token-0000','Content-Type':'application/json',...options.headers}});
      return {status:response.status,body:await response.json()};
    };
    const product = await request('/admin/products',{method:'POST',headers:{'idempotency-key':randomUUID()},body:JSON.stringify({name:'Camiseta CRONOX · prueba local',slug:'tee-local-finance',price:3500,unitCostCents:1200,variants:[{size:'M',sku:'LOCAL-M',stockQty:80}]})});
    assert.equal(product.status,201,JSON.stringify(product.body)); const productId = product.body.id;
    assert.equal((await request('/admin/products/'+productId)).body.privateCost.unitCostCents,1200);
    assert.equal((await request('/admin/products/'+productId,{method:'PATCH',body:JSON.stringify({unitCostCents:0})})).status,200);
    assert.equal((await request('/admin/products/'+productId)).body.privateCost.unitCostCents,0);
    for (const bad of [-1,1.25,'1200',1e30]) assert.equal((await request('/admin/products/'+productId,{method:'PATCH',body:JSON.stringify({unitCostCents:bad})})).status,400);
    await request('/admin/products/'+productId,{method:'PATCH',body:JSON.stringify({unitCostCents:1200})});
    const privatePattern = /unitCostCents|privateCost|financialSnapshot|profitCents/;
    for (const route of ['/products','/products/tee-local-finance','/products/suggestions?search=camiseta']) {
      const response = await request(route); assert.equal(response.status,200,route); assert(!privatePattern.test(JSON.stringify(response.body)));
    }
    const query = '?from=2026-01-01&to=2026-12-31';
    assert.equal((await request('/admin/finance'+query,{},customerToken.accessToken)).status,403);
    assert.equal((await request('/admin/products/'+productId,{method:'PATCH',body:JSON.stringify({unitCostCents:9})},customerToken.accessToken)).status,403);
    console.log('PASS: authorized cost persistence, precision validation, public product privacy, customer authorization.');
    const variants = await db.productVariant.findMany({where:{productId}});
    const { AdminManualPurchasesService } = require(path.join(backend,'dist/admin/manual-purchases/admin-manual-purchases.service'));
    const manual = app.get(AdminManualPurchasesService);
    const purchased = await manual.create(customer.id,admin.id,randomUUID(),{items:[{variantId:variants[0].id,quantity:3}],paymentMethod:'CASH',stockHandling:'DEDUCT_NOW'});
    assert.equal((await db.orderItemFinancial.findUnique({where:{itemId:purchased.order.items[0].id}})).unitCostCents,1200);
    const before = (await request('/admin/finance'+query)).body;
    assert.equal(before.totals.revenueCents,10500); assert.equal(before.totals.profitCents,6900);
    await request('/admin/products/'+productId,{method:'PATCH',body:JSON.stringify({price:9900,unitCostCents:9800,name:'Nombre actualizado'})});
    const after = (await request('/admin/finance'+query)).body;
    assert.deepEqual(after.totals,before.totals); assert.equal(after.products[0].name,'Camiseta CRONOX · prueba local');
    await db.shippingMethod.create({data:{id:1,name:'Envío local de prueba',price:495,countries:['ES']}});
    await db.cart.create({data:{userId:customer.id,items:{create:{variantId:variants[0].id,qty:1,priceAtAdd:9900}}}});
    const { OrdersService } = require(path.join(backend,'dist/orders/orders.service'));
    const ordersService = app.get(OrdersService);
    const frozen = await ordersService.createCheckoutSnapshot(customer.id,{shippingMethod:'STANDARD'});
    assert(!privatePattern.test(JSON.stringify(frozen)));
    const frozenRow = await db.checkoutSnapshot.findUnique({where:{id:frozen.checkoutSnapshotId},include:{items:{include:{financialSnapshot:true}}}});
    assert.equal(frozenRow.items[0].financialSnapshot.unitCostCents,9800);
    await request('/admin/products/'+productId,{method:'PATCH',body:JSON.stringify({price:1000,unitCostCents:0})});
    // Simulate an already verified event locally; never create a PaymentIntent or invoke Stripe.
    await db.checkoutSnapshot.update({where:{id:frozenRow.id},data:{stripePaymentIntentId:'pi_isolated_finance',status:'PAYMENT_BOUND'}});
    const paymentInput = {checkoutSnapshotId:frozenRow.id,paymentIntentId:'pi_isolated_finance',amountCents:frozenRow.totalCents,currency:'EUR',occurredAt:new Date()};
    const successEvent = {id:'evt_isolated_sale',type:'payment_intent.succeeded',paymentIntentId:paymentInput.paymentIntentId,occurredAt:paymentInput.occurredAt};
    assert.equal(await ordersService.claimStripeWebhookEvent(successEvent),true);
    const online = await ordersService.createOrderFromVerifiedStripePayment(paymentInput);
    await ordersService.completeStripeWebhookEvent(successEvent.id);
    assert.equal(await ordersService.claimStripeWebhookEvent(successEvent),false);
    assert.equal((await ordersService.createOrderFromVerifiedStripePayment(paymentInput)).created,false);
    const onlineRow = await db.order.findUnique({where:{id:online.orderId},include:{items:{include:{financialSnapshot:true}}}});
    assert.equal(onlineRow.items[0].financialSnapshot.unitCostCents,9800);
    assert.equal(onlineRow.items[0].unitPrice.toString(),'99');
    assert.equal(onlineRow.paidAt.toISOString(),paymentInput.occurredAt.toISOString());
    for (const route of ['/orders','/orders/'+online.orderId,'/cart']) {
      const response = await request(route,{},customerToken.accessToken);
      assert.equal(response.status,200,route); assert(!privatePattern.test(JSON.stringify(response.body)));
    }
    const priorRefund = (await request('/admin/finance'+query)).body.totals;
    const stockBefore = (await db.productVariant.findUnique({where:{id:variants[0].id}})).stockQty;
    for (const id of ['evt_isolated_refund_1','evt_isolated_refund_2']) {
      const event = {id,type:'charge.refunded',paymentIntentId:paymentInput.paymentIntentId,occurredAt:new Date(),refundCumulativeCents:200};
      assert.equal(await ordersService.claimStripeWebhookEvent(event),true);
      await ordersService.completeStripeWebhookEvent(id);
      assert.equal(await ordersService.claimStripeWebhookEvent(event),false);
    }
    const afterRefund = (await request('/admin/finance'+query)).body.totals;
    assert.equal(afterRefund.revenueCents,priorRefund.revenueCents-200);
    assert.equal(afterRefund.costCents,priorRefund.costCents);
    assert.equal((await db.productVariant.findUnique({where:{id:variants[0].id}})).stockQty,stockBefore);
    console.log('PASS: real checkout cost freeze, replay-safe fulfillment/refund ledger, customer order/cart privacy; no provider calls.');
    // Real fixtures in the isolated DB only. No financial providers are contacted.
    for (let i=0;i<31;i++) {
      const item = await db.product.create({data:{slug:`finance-local-${i}`,name:['Sudadera Essential','Camiseta Boxy','Pantalón Studio','Gorra Signature'][i%4]+` ${i+1}`,price:2500+i*100,privateCost:{create:{unitCostCents:800+i*30}},variants:{create:{size:'M',sku:`FINANCE-${i}`,stockQty:20}}},include:{variants:true}});
      await db.order.create({data:{status:'PAID',paidAt:new Date(`2026-09-${String(1+i%25).padStart(2,'0')}T12:00:00Z`),subtotal:'90.00',total:'95.00',shippingCost:500,taxRate:'.21',taxAmount:'15.62',customerEmail:customer.email,userId:customer.id,items:{create:{productId:item.id,variantId:item.variants[0].id,title:item.name,unitPrice:'30.00',quantity:3,lineTotal:'90.00',financialSnapshot:{create:{unitCostCents:800+i*30,productName:item.name}}}}}});
    }
    const day = (await request('/admin/finance'+query+'&aggregation=days')).body;
    const month = (await request('/admin/finance'+query+'&aggregation=months')).body;
    assert.deepEqual(day.totals,month.totals);
    assert.equal(day.pagination.total,32); assert.equal(day.products.length,25);
    const page2 = (await request('/admin/finance'+query+'&page=2')).body;
    assert.equal(page2.products.length,7);
    assert.equal([...day.products,...page2.products].reduce((sum,p) => sum+p.revenueCents,0),day.totals.revenueCents);
    assert.deepEqual(day.topProducts,day.products.slice(0,5));
    assert.equal(day.buckets.reduce((sum,b) => sum+b.revenueCents,0),day.totals.revenueCents);
    console.log('PASS: immutable sale/cost snapshots, whole-dataset sorting/pagination and day/month/product/top-card reconciliation.');
    await require('./verify-permanent-history.cjs')({ db, app, request, sql, historyMigration, customer, customerToken, admin, root });
    // Prove a complete external dump restores the protected history into a separate empty DB.
    const dumpFile = path.join(dir,'history-recovery.dump');
    run(executable('pg_dump'),[url,'--format=custom','--file',dumpFile]);
    run(executable('pg_restore'),['--list',dumpFile]);
    run(executable('createdb'),['-h','127.0.0.1','-p',String(pgPort),'-U','finance_review','history_restore']);
    const recoveryUrl = new URL(url); recoveryUrl.pathname = '/history_restore';
    run(executable('pg_restore'),['--exit-on-error','--no-owner','--dbname',recoveryUrl.href,dumpFile]);
    const recovered = new PrismaClient({datasources:{db:{url:recoveryUrl.href}}});
    try {
      for (const model of ['dailyVisitor','financeArchive','financeArchiveRevision','financeEventArchive','financeStockArchive']) assert.equal(await recovered[model].count(),await db[model].count());
      assert.deepEqual(await recovered.visitorHistoryConfig.findUnique({where:{id:1}}),await db.visitorHistoryConfig.findUnique({where:{id:1}}));
      const { AdminFinanceService } = require(path.join(backend,'dist/admin/finance/admin-finance.service'));
      const { FinanceQuery } = require(path.join(backend,'dist/admin/finance/admin-finance.controller'));
      const recoveryQuery = Object.assign(new FinanceQuery(),{from:'2026-01-01',to:'2026-12-31'});
      assert.deepEqual(await new AdminFinanceService(recovered).getReport(recoveryQuery),await new AdminFinanceService(db).getReport(recoveryQuery));
      await assert.rejects(recovered.dailyVisitor.deleteMany(),/Permanent history/);
    } finally { await recovered.$disconnect(); }
    console.log('PASS: pg_dump/pg_restore into a separate empty local DB; all history counts/start-date/finance report/protection reconciled.');
    await fs.writeFile(path.join(dir,'review-state.json'),JSON.stringify({base:'http://127.0.0.1:43120',productId,userId:customer.id,dir}));
    await fs.mkdir(path.join(root,'test-results/admin-finance'),{recursive:true});
    await fs.writeFile(path.join(root,'test-results/admin-finance/review-path.txt'),dir);
    if (process.argv.includes('--serve')) {
      console.log('READY: http://127.0.0.1:43120/__review/admin (isolated local review; Ctrl+C stops it)');
      await new Promise(() => {});
    }
  } finally { await stop(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
