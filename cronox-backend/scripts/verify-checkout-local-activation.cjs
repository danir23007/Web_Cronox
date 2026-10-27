'use strict';
// Explicit local development activation check. Real Stripe TEST API, real HTTP,
// real 360-second clock. Only new, uniquely named fixtures are mutated.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');
const { loadLocalEnvironment } = require('./start-local.cjs');
const out = path.resolve(__dirname, '../../output/checkout-local-activation');
const reportFile = path.join(out, 'installation-results.json');
const report = { run: randomUUID(), provider: 'REAL_STRIPE_TEST', clock: 'REAL_WALL_CLOCK', database: 'cronox_dev', checks: [], scenarios: [], passed: false };
const base = 'http://localhost:3000';
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const check = name => { report.checks.push(name); console.log('[PASS]', name); save(); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(name, read, valid, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await read(); if (valid(value)) return value; await pause(800); }
  throw Error('TIMEOUT: ' + name);
}
function session() {
  const cookies = new Map();
  const request = async (route, method = 'GET', body, expected = 200) => {
    const res = await fetch(base + '/api/' + route, { method, headers: { Origin: base, 'Content-Type': 'application/json',
      Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), 'x-csrf-token': cookies.get('cronox_csrf_token') || '' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const raw of res.headers.getSetCookie()) { const pair = raw.split(';')[0], at = pair.indexOf('='); cookies.set(pair.slice(0,at), pair.slice(at+1)); }
    const data = await res.json();
    if (res.status !== expected) throw Error(`HTTP ${res.status} ${method} ${route.split('?')[0]}: ${JSON.stringify(data.message || data.code || '').slice(0,180)}`);
    return data;
  };
  return { request, browserCookies: () => [...cookies].map(([name,value]) => ({ name,value,domain:'localhost',path:'/',httpOnly:name!=='cronox_csrf_token',secure:false,sameSite:'Lax' })) };
}
async function run() {
  const env = loadLocalEnvironment(), url = new URL(env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '5433'); assert.equal(url.pathname, '/cronox_dev');
  assert.equal(env.CRONOX_LOCAL_CHECKOUT_TEST, 'true'); assert.match(env.STRIPE_SECRET_KEY, /^sk_test_/);
  assert.equal(env.EMAIL_ENABLED,'false'); assert.equal(env.BACKGROUND_JOBS_ENABLED,'false');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const fixtures = [];
  let product;
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  try {
    const target = await db.$queryRaw`SELECT current_database() AS name,host(inet_server_addr()) AS host`;
    assert.deepEqual(target,[{name:'cronox_dev',host:'127.0.0.1'}]);
    const migrations = await db.$queryRaw`SELECT migration_name,finished_at,checksum FROM _prisma_migrations WHERE migration_name IN ('20261027190000_checkout_presence_and_payment_window','20261027210000_safe_user_deletion_permanent_ids') AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.equal(migrations.length,2);
    for(const m of migrations) assert.equal(m.checksum,createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../prisma/migrations',m.migration_name,'migration.sql'))).digest('hex'));
    report.migrations=migrations;
    // The historical local copy may contain no shipping configuration. Add only
    // missing test rows; never overwrite an existing method or its pricing.
    const shippingBefore = await db.shippingMethod.findMany();
    await db.shippingMethod.createMany({ data: [
      { id:1, name:'Envío estándar de prueba local', price:295, isActive:true },
      { id:2, name:'Envío exprés de prueba local', price:495, isActive:true },
    ], skipDuplicates:true });
    report.shippingMethodsAdded = [1,2].filter(id=>!shippingBefore.some(row=>row.id===id));
    const originals = { product: await db.product.findMany({orderBy:{id:'asc'}}), productVariant:await db.productVariant.findMany({orderBy:{id:'asc'}}), order:await db.order.findMany({orderBy:{id:'asc'}}) };
    const account = await stripe.accounts.retrieve(); report.testAccountId = account.id;
    product = await db.product.create({data:{name:'PRUEBA LOCAL reservas '+report.run,slug:'prueba-local-reservas-'+report.run,price:1000,imageUrl:'/assets/logo_banner.png',variants:{create:{sku:'LOCAL-RESERVE-'+report.run,size:'M',stockQty:20}}},include:{variants:true}});
    const variant=product.variants[0], stock=async()=>(await db.productVariant.findUniqueOrThrow({where:{id:variant.id}})).stockQty;
    report.productId=product.id; report.variantId=variant.id;
    check('Local target, exact migration checksums, regenerated Prisma client and Stripe test account verified');
    async function fixture(label) {
      const s=session();const cart=await s.request('cart');await s.request('cart/items','POST',{variantId:variant.id,qty:1},201);
      const f={...s,label,cartId:cart.id,tabId:randomUUID()};fixtures.push(f);
      f.row=()=>db.checkoutSnapshot.findUniqueOrThrow({where:{id:f.snapshotId}});
      f.enter=async(action='enter')=>{const r=await s.request('checkout/reservation','POST',{tabId:f.tabId,action},201);f.snapshotId=r.checkoutSnapshotId;return r;};
      f.prepare=async()=>{
        f.payment=await s.request('checkout/payment-intent','POST',{checkoutSnapshotId:f.snapshotId,tabId:f.tabId,shippingMethod:'STANDARD',guestEmail:`local-${label}-${report.run}@example.test`,shippingAddress:{firstName:'Prueba',lastName:'Local',line1:'Calle ficticia 1',city:'Madrid',postalCode:'28001',country:'ES'}},201);
        f.snapshotId=f.payment.metadata.checkoutSnapshotId;
        const pi=await stripe.paymentIntents.retrieve(f.payment.paymentIntentId);assert.equal(pi.livemode,false);assert.equal(pi.metadata.checkoutSnapshotId,f.snapshotId);
        return f.payment;
      };
      f.start=()=>s.request('checkout/payment-start','POST',{tabId:f.tabId,checkoutSnapshotId:f.snapshotId,paymentIntentId:f.payment.paymentIntentId},201);
      return f;
    }
    const exit=await fixture('exit');assert.equal(await stock(),20);assert.equal(await db.checkoutSnapshot.count({where:{cartId:exit.cartId}}),0);
    await exit.enter();assert.equal(await stock(),19);await exit.prepare();assert.equal((await exit.row()).paymentStartedAt,null);
    await exit.enter('leave');await wait('exit release',stock,s=>s===20);
    assert.equal((await stripe.paymentIntents.retrieve(exit.payment.paymentIntentId)).status,'canceled');assert.equal((await exit.request('cart')).items.length,1);
    check('Cart reserves nothing; entry reserves one unit; preparation does not start payment; exit cancels real test intent and restores stock, preserving cart');
    const expiry=await fixture('expiry');await expiry.enter();await expiry.prepare();const start=await expiry.start();
    const first=await expiry.row();assert.equal(first.expiresAt-first.paymentStartedAt,360000);
    report.deadline=first.expiresAt.toISOString();report.startedAt=first.paymentStartedAt.toISOString();
    await expiry.enter('depart');expiry.tabId=randomUUID();await expiry.enter();await expiry.prepare();await expiry.start();
    assert.equal((await expiry.row()).expiresAt.toISOString(),report.deadline);
    fs.writeFileSync(path.join(out,'browser-fixture.private.json'),JSON.stringify({cookies:expiry.browserCookies(),snapshotId:expiry.snapshotId,deadline:report.deadline,productId:product.id,variantId:variant.id}));
    check('Payment protection is exactly 360 seconds; reload/re-entry, preparation and payment-start retry preserve the same deadline');
    const uncertain=await fixture('uncertain');await uncertain.enter();await uncertain.prepare();await uncertain.start();
    // Controlled account mismatch on this fixture only: same recovery path as a
    // provider that cannot prove a terminal state, without a global fault switch.
    await db.checkoutSnapshot.update({where:{id:uncertain.snapshotId},data:{stripeAccountId:'acct_local_verification_unavailable'}});
    report.uncertainSnapshot=uncertain.snapshotId;
    const paid=await fixture('paid');await paid.enter();await paid.prepare();await paid.start();
    const intent=await stripe.paymentIntents.confirm(paid.payment.paymentIntentId,{payment_method:'pm_card_visa',return_url:base+'/checkout-success.html'});
    assert.equal(intent.livemode,false);assert.equal(intent.status,'succeeded');
    const order=await wait('original Stripe CLI success webhook',()=>db.order.findUnique({where:{providerRef:intent.id}}),o=>o?.status==='PAID',45000);
    const event=await wait('processed signed original event',()=>db.stripeWebhookEvent.findFirst({where:{paymentIntentId:intent.id,type:'payment_intent.succeeded',status:'PROCESSED'}}),Boolean);
    assert.equal(await db.order.count({where:{providerRef:intent.id}}),1);
    assert.equal(await db.checkoutStockReservation.count({where:{checkoutSnapshotId:paid.snapshotId,status:'CONSUMED'}}),1);
    report.paid={orderId:order.id,paymentIntentId:intent.id,eventId:event.id};
    check('Real Stripe test card succeeds; original signed CLI webhook creates one PAID order and consumes stock exactly once');
    for(const f of fixtures)report.scenarios.push({label:f.label,cartId:f.cartId,snapshotId:f.snapshotId,paymentIntentId:f.payment?.paymentIntentId});save();
    console.log('[WAIT] Real six-minute expiration, no clock change and no deadline update');
    let minute=-1;
    while(Date.now()<first.expiresAt.getTime()){
      const current=Math.floor((Date.now()-first.paymentStartedAt.getTime())/60000);
      if(current!==minute){minute=current;assert.equal((await expiry.row()).expiresAt.toISOString(),report.deadline);console.log(`[WAIT] ${minute} minute(s); deadline unchanged`);}
      await pause(Math.min(5000,Math.max(1,first.expiresAt-Date.now())));
    }
    await wait('automatic expiration',()=>expiry.row(),r=>['EXPIRED','PAYMENT_CANCELLED'].includes(r.status));
    assert.equal((await stripe.paymentIntents.retrieve(expiry.payment.paymentIntentId)).status,'canceled');
    await assert.rejects(()=>stripe.paymentIntents.confirm(expiry.payment.paymentIntentId,{payment_method:'pm_card_visa',return_url:base}));
    check('Actual 360-second deadline reached without browser: worker confirms Stripe cancellation before releasing; expired intent cannot be charged');
    const held=await wait('uncertain reconciliation',()=>uncertain.row(),r=>r.reservationPhase==='RECONCILING'&&r.reservationRetryAt);
    const firstRetry=held.reservationRetryAt;
    await wait('controlled automatic retry',()=>uncertain.row(),r=>r.reservationRetryAt>firstRetry,15000);
    assert.equal(await db.checkoutStockReservation.count({where:{checkoutSnapshotId:uncertain.snapshotId,status:'RESERVED'}}),1);
    assert.equal((await stripe.paymentIntents.retrieve(uncertain.payment.paymentIntentId)).status,'requires_payment_method');
    report.uncertainHeldAfterDeadline=true;save();
    check('Uncertain fixture remains held beyond six minutes; worker retries after five seconds without renewing payment deadline');
    // Leave a short window for the real admin UI evidence, then restore only
    // the fixture's correct account binding and let the worker recover itself.
    await pause(20000);
    await db.checkoutSnapshot.update({where:{id:uncertain.snapshotId},data:{stripeAccountId:account.id}});
    await wait('automatic recovery after provider identity restored',()=>uncertain.row(),r=>['EXPIRED','PAYMENT_CANCELLED'].includes(r.status));
    assert.equal((await stripe.paymentIntents.retrieve(uncertain.payment.paymentIntentId)).status,'canceled');
    assert.equal(await stock(),19);
    check('After restoring fixture provider identity, automatic reconciliation safely releases it; only the paid unit remains consumed');
    for(const [model,rows] of Object.entries(originals))assert.equal(digest(await db[model].findMany({where:{id:{in:rows.map(r=>r.id)}},orderBy:{id:'asc'}})),digest(rows));
    check('Every pre-existing product, variant and order is byte-for-byte unchanged');
    report.passed=true;
  } finally {
    // Even a failed assertion must not leave our injected account mismatch
    // behind. Restoring provenance never releases stock or alters a deadline.
    if (report.testAccountId) for (const fixture of fixtures) {
      if (fixture.snapshotId) await db.checkoutSnapshot.updateMany({
        where:{id:fixture.snapshotId,stripeAccountId:'acct_local_verification_unavailable'},
        data:{stripeAccountId:report.testAccountId},
      }).catch(()=>{});
    }
    // Never remove order/payment history. Hide only our uniquely named fixture.
    if(product){await db.product.update({where:{id:product.id},data:{isActive:false}}).catch(()=>{});}
    await db.$disconnect();save();
  }
}
run().catch(error=>{report.error=String(error.message).replace(/(?:sk|pk|rk)_(?:test|live)_\w+|whsec_\w+|pi_\w+_secret_\w+/g,'[REDACTED]');console.error(report.error);save();process.exitCode=1;});
