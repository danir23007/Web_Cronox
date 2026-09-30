// Isolated local data only. No Stripe calls, no email, no stock reservations.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { request } = require('@playwright/test');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');
const { PrismaClient } = require('../../cronox-backend/node_modules/@prisma/client');
const bcrypt = require('../../cronox-backend/node_modules/bcrypt');
const { LivePaymentObservation } = require('../../cronox-backend/dist/live-stats/live-payment-observation');

(async () => {
  const env = loadLocalEnvironment(), destination = new URL(env.DATABASE_URL);
  assert.equal(destination.hostname, '127.0.0.1'); assert.equal(destination.port, '5433');
  assert.equal(destination.pathname, '/cronox_dev'); assert.equal(env.EMAIL_ENABLED, 'false'); assert.equal(env.BACKGROUND_JOBS_ENABLED, 'false');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const tag = 'live-stats-qa-' + randomUUID(), contexts = [], hashes = new Set(), cartIds = new Set();
  let product, user, order;
  const context = async () => {
    const ctx = await request.newContext({ baseURL: 'http://localhost:3000', storageState: { cookies: [{
      name: 'cronox_cookie_consent', value: encodeURIComponent(JSON.stringify({version:'2',analytics:true})), domain:'localhost', path:'/', expires:Math.floor(Date.now()/1000)+3600, httpOnly:false, secure:false, sameSite:'Lax',
    }], origins:[] } }); contexts.push(ctx); return ctx;
  };
  const call = async (ctx, path, data, method='POST') => {
    await ctx.get('/api/auth/csrf');
    const cookies=(await ctx.storageState()).cookies;
    return ctx.fetch(path,{method,data,headers:{Origin:'http://localhost:3000','x-csrf-token':decodeURIComponent(cookies.find(c=>c.name==='cronox_csrf_token').value)}});
  };
  const identify = async ctx => {
    const cookie=(await ctx.storageState()).cookies.find(c=>c.name==='cronox_live_visitor');
    if(!cookie)return null;
    const {vid}=JSON.parse(Buffer.from(cookie.value.split('.')[1],'base64url').toString());
    const hash=createHash('sha256').update(vid).digest('hex');hashes.add(hash);return hash;
  };
  const signal = async (ctx, section='product') => {
    const h=await identify(ctx);if(h)await db.livePresence.updateMany({where:{visitorHash:h},data:{seenAt:new Date(Date.now()-6000)}});
    const res=await call(ctx,'/api/live-stats/presence',{section,...(section==='product'?{productId:product.id}:{})});
    assert.equal(res.status(),204);await identify(ctx);
  };
  try {
    const admin=await context(); assert.equal((await call(admin,'/api/auth/login',{email:env.LOCAL_ADMIN_EMAIL,password:env.LOCAL_ADMIN_PASSWORD})).status(),200);
    const stats=async()=>{const r=await admin.get('/api/admin/live-stats');assert.equal(r.status(),200);return r.json();};
    assert.equal((await stats()).visitors.total,0,'Run only when the isolated local storefront has no other active visitors');
    product=await db.product.create({data:{slug:tag,name:tag,price:1000,variants:{create:{sku:tag,size:'M',stockQty:100}}},include:{variants:true}});
    const variantId=product.variants[0].id, password=randomUUID();
    user=await db.user.create({data:{email:tag+'@example.test',password:await bcrypt.hash(password,10),role:'USER',accountState:'ACTIVE'}});
    const a=await context(),b=await context();
    assert.equal((await a.get('/api/admin/live-stats')).status(),401);
    for(const [ctx,qty] of [[a,2],[b,1]]) {
      const cart=await (await ctx.get('/api/cart')).json();cartIds.add(cart.id);
      assert.equal((await call(ctx,'/api/cart/items',{variantId,qty})).status(),201);
      await signal(ctx);
    }
    let s=await stats();assert.deepEqual(s.visitors,{total:2,signedIn:0,guests:2});assert.deepEqual(s.carts,{visitors:2,units:3,products:1});
    await signal(a);assert.equal((await stats()).visitors.total,2,'same browser/tabs use the same cookie row');
    const ah=await identify(a);await db.livePresence.update({where:{visitorHash:ah},data:{seenAt:new Date(Date.now()-121000)}});
    s=await stats();assert.equal(s.visitors.total,1);assert.equal(s.carts.units,1);assert.equal(await db.livePresence.count({where:{visitorHash:ah}}),0);
    await signal(a);assert.equal((await stats()).visitors.total,2);
    // Login follows the application's actual guest-cart merge.
    assert.equal((await call(a,'/api/auth/login',{email:user.email,password})).status(),200);
    await signal(a);s=await stats();assert.deepEqual(s.visitors,{total:2,signedIn:1,guests:1});assert.equal(s.carts.units,3);
    assert.equal((await a.get('/api/admin/live-stats')).status(),403);
    const cart=await (await a.get('/api/cart')).json();cartIds.add(cart.id);
    assert.equal((await call(a,'/api/cart/items/'+cart.items[0].id,{qty:4},'PATCH')).status(),200);
    assert.equal((await stats()).carts.units,5);
    await signal(a,'checkout');await signal(b,'checkout');assert.equal((await stats()).checkouts,2);
    const snapshot=await db.checkoutSnapshot.create({data:{id:tag,userId:user.id,customerEmail:user.email,cartId:cart.id,cartUpdatedAt:new Date(),requestFingerprint:tag,status:'PAYMENT_BOUND',stripePaymentIntentId:tag,subtotalCents:4000,taxRate:0,taxAmountCents:0,totalCents:4000,expiresAt:new Date(Date.now()+1800000)}});
    const observation=new LivePaymentObservation(db);
    const event=(status,seconds=0,live=true)=>({type:'payment_intent.'+status,created:Math.floor(Date.now()/1000)+seconds,livemode:live,data:{object:{id:tag,status}}});
    await observation.record(event('requires_payment_method'));assert.equal((await stats()).payments,0);
    await observation.record(event('requires_action'));assert.equal((await stats()).payments,1);
    await observation.record(event('processing'));assert.equal((await stats()).payments,1);
    await db.livePresence.updateMany({where:{visitorHash:{in:[...hashes]}},data:{seenAt:new Date(Date.now()-121000)}});
    s=await stats();assert.equal(s.checkouts,0);assert.equal(s.payments,1,'provider processing survives hidden/closed visitors');
    await observation.record(event('processing',-60));assert.equal((await stats()).payments,1);
    await observation.record(event('canceled'));assert.equal((await stats()).payments,0);
    await db.checkoutSnapshot.update({where:{id:snapshot.id},data:{status:'CANCELED'}});await signal(a,'checkout');assert.equal((await stats()).checkouts,0);
    // New attempt on the same checkout does not create a second checkout process.
    await db.checkoutSnapshot.update({where:{id:snapshot.id},data:{status:'PAYMENT_BOUND',paymentStatus:null,paymentStatusAt:null}});
    await observation.record(event('processing',0,false));assert.equal((await stats()).payments,0,'test payment excluded');
    await observation.record(event('succeeded',1));
    order=await db.order.create({data:{customerEmail:user.email,userId:user.id,status:'PAID',subtotal:40,taxRate:0,taxAmount:0,total:40,paidAt:new Date(),providerRef:tag}});
    await db.checkoutSnapshot.update({where:{id:tag},data:{orderId:order.id,status:'ORDER_CREATED'}});
    assert.equal((await stats()).purchases,1);assert.equal((await stats()).checkouts,0);
    await observation.record(event('processing',-10));await observation.record(event('succeeded',1));assert.equal((await stats()).purchases,1);
    await db.order.update({where:{id:order.id},data:{status:'REFUNDED'}});assert.equal((await stats()).purchases,1);
    await db.order.update({where:{id:order.id},data:{paidAt:new Date(Date.now()-1801000)}});assert.equal((await stats()).purchases,0);
    assert.equal((await call(a,'/api/cart',undefined,'DELETE')).status(),200);assert.equal((await stats()).carts.units,0);
    assert.equal((await call(a,'/api/auth/logout',{})).status(),204);await signal(a);s=await stats();assert.deepEqual(s.visitors,{total:1,signedIn:0,guests:1});
    const adminSession=await db.authSession.findFirst({where:{userId:1},orderBy:{createdAt:'desc'}});
    await signal(admin);assert.equal((await stats()).visitors.total,1);
    if(adminSession)assert.equal((await db.authSession.findUnique({where:{id:adminSession.id}})).lastActivityAt.getTime(),adminSession.lastActivityAt.getTime());
    assert.equal((await call(b,'/api/live-stats/presence',{section:'home',userId:user.id})).status(),400);
    assert.equal((await call(b,'/api/live-stats/presence',{section:'/admin?token=bad'})).status(),400);
    assert.equal((await call(b,'/api/live-stats/presence',{section:'home',extra:'x'.repeat(2000)})).status(),413);
    await call(a,'/api/live-stats/presence',{section:'other',enabled:false});assert.equal((await stats()).visitors.total,0);
    console.log('PASS: auth/roles, guest and account presence, deduplication, expiry/reactivation, real cart merge/quantity/clear, checkouts, payment observations/replays/test mode/cancellation, paidAt/refunds, consent removal, validation and idle-session preservation.');
  } finally {
    await db.livePresence.deleteMany({where:{visitorHash:{in:[...hashes]}}});
    await db.checkoutSnapshot.deleteMany({where:{id:tag}});
    if(order)await db.order.delete({where:{id:order.id}});
    await db.cart.deleteMany({where:{id:{in:[...cartIds]}}});
    if(user)await db.user.delete({where:{id:user.id}});
    if(product) { await db.productVariant.deleteMany({where:{productId:product.id}}); await db.product.delete({where:{id:product.id}}); }
    await Promise.all(contexts.map(c=>c.dispose()));await db.$disconnect();
  }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
