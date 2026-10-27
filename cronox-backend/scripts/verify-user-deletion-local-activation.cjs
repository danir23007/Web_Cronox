'use strict';
// Explicit local development verification. Only this run's uniquely tagged
// fictional accounts can be deleted. Existing accounts/history are read-only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadLocalEnvironment } = require('./start-local.cjs');
const out = path.resolve(__dirname, '../../output/user-deletion-local-activation');
const stateFile = path.join(out, 'state.private.json'), reportFile = path.join(out, 'installation-results.json');
const base = 'http://localhost:3000';
let report = { run:randomUUID(), database:'cronox_dev', realUsersDeleted:false, checks:[], passed:false };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report,null,2));
const check = name => { report.checks.push(name); console.log('[PASS]',name); save(); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function session(initial = []) {
  const cookies = new Map(initial);
  return {
    cookies, browserCookies:()=>[...cookies].filter(([,value])=>value).map(([name,value])=>({name,value,domain:'localhost',path:'/',httpOnly:name!=='cronox_csrf_token',secure:false,sameSite:'Lax'})),
    async request(route, method='GET', body, expected=200, headers={}) {
      const res=await fetch(base+'/api/'+route,{method,headers:{Origin:base,'Content-Type':'application/json',
        Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'x-csrf-token':cookies.get('cronox_csrf_token')||'',...headers},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      for(const raw of res.headers.getSetCookie()){const pair=raw.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
      const data=await res.json();
      assert.equal(res.status,expected,`${method} ${route.split('?')[0]}: ${res.status}, ${JSON.stringify(data.message||data.code||'').slice(0,160)}`);
      return data;
    },
  };
}
async function verifyOriginals(db,originals){
  for(const [model,rows] of Object.entries(originals)){
    assert.equal(digest(await db[model].findMany({where:{id:{in:rows.map(row=>row.id)}},orderBy:{id:'asc'}})),digest(rows),'Pre-existing '+model+' changed');
  }
}
async function run(){
  const env=loadLocalEnvironment(),url=new URL(env.DATABASE_URL);
  assert.equal(env.NODE_ENV,'development');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5433');assert.equal(url.pathname,'/cronox_dev');
  assert.equal(env.EMAIL_ENABLED,'false');assert.equal(env.BACKGROUND_JOBS_ENABLED,'false');
  const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
  try{
    assert.deepEqual(await db.$queryRaw`SELECT current_database() AS name,host(inet_server_addr()) AS host`,[{name:'cronox_dev',host:'127.0.0.1'}]);
    if(process.argv.includes('--finish')){
      const state=JSON.parse(fs.readFileSync(stateFile));report=JSON.parse(fs.readFileSync(reportFile));
      const target=state.fixtures.browser;
      assert.equal(await db.user.findUnique({where:{id:target.id}}),null,'Browser fixture was not deleted');
      assert.equal(await db.auditLog.count({where:{requestKey:'admin-user-delete:'+target.identityUid}}),1);
      assert.equal(await db.$queryRaw`SELECT count(*)::int AS total FROM "AdminUserDeletion" WHERE "userId"=${target.id}`.then(rows=>rows[0].total),1);
      report.deletedIds=[...new Set([...report.deletedIds,target.id])];
      check('Real browser cancellation followed by explicit confirmation deleted only its fictional target; one audit and durable receipt');
      await verifyOriginals(db,state.originals);
      check('All original users, orders, variants, products, checkouts and inventory movements remain byte-for-byte unchanged');
      // Revoke every surviving fixture's sessions and leave it visibly inactive.
      for(const fixture of Object.values(state.fixtures)){
        const current=await db.user.findUnique({where:{id:fixture.id}});
        if(current){assert.equal(current.identityUid,fixture.identityUid);assert.ok(current.email.endsWith(state.run+'@example.test'));
          await db.user.update({where:{id:fixture.id},data:{accountState:'INACTIVE',sessionVersion:{increment:1}}});
          await db.authSession.deleteMany({where:{userId:fixture.id}});
        }
      }
      await db.product.update({where:{id:state.productId},data:{isActive:false}});
      const actor=session(state.actorCookies);
      await actor.request('me','GET',undefined,401);
      const currentUsers=await db.user.findMany({orderBy:[{createdAt:'asc'},{id:'asc'}]});
      report.final={users:currentUsers.length,retiredIds:report.deletedIds,fixtureAccountsInactive:true,fixtureSessionsRevoked:true};
      report.passed=true;save();console.log('[PASS] Fixture credentials revoked; local activation complete');return;
    }
    assert.ok(!fs.existsSync(stateFile),'Use a new output directory for another destructive test run');
    const preflight=JSON.parse(fs.readFileSync(path.join(out,'preflight.json')));
    assert.ok(preflight.backup.catalogVerified&&fs.existsSync(preflight.backup.file),'Backup required');assert.deepEqual(preflight.pending,[]);
    const originals={};for(const model of ['user','order','product','productVariant','checkoutSnapshot','checkoutStockReservation','stockMovement'])originals[model]=await db[model].findMany({orderBy:{id:'asc'}});
    const password='Local!'+randomUUID()+'Aa7',hash=await require('bcrypt').hash(password,10),fixtures={};
    async function create(label,data={}){
      const user=await db.user.create({data:{email:`delete-local-${label.toLowerCase()}-${report.run}@example.test`,name:'Prueba local '+label,firstName:'Prueba',lastName:'Local',password:hash,...data}});
      fixtures[label]=user;return user;
    }
    const actorUser=await create('superadmin',{role:'SUPERADMIN'}),adminUser=await create('admin',{role:'ADMIN'}),ordinaryUser=await create('ordinary');
    const middle=await create('middle'),tail=await create('tail',{accountState:'INACTIVE'});
    const orderUser=await create('order'),checkoutUser=await create('checkout'),adminTarget=await create('adminTarget',{role:'ADMIN'}),superTarget=await create('superTarget',{role:'SUPERADMIN'}),browserUser=await create('browser');
    const actor=session(),admin=session(),ordinary=session(),targetSession=session(),checkoutSession=session();
    for(const [s,u] of [[actor,actorUser],[admin,adminUser],[ordinary,ordinaryUser],[targetSession,middle],[checkoutSession,checkoutUser]]){
      await s.request('cart');await s.request('auth/login','POST',{email:u.email,password});
    }
    const row=user=>db.user.findUniqueOrThrow({where:{id:user.id}});
    async function remove(s,user,expected=200,patch={},uid=user.identityUid){
      assert.ok(Object.values(fixtures).some(f=>f.id===user.id&&f.identityUid===user.identityUid),'Only owned fixture deletion');
      return s.request('admin/users/'+user.id,'DELETE',{confirmed:true,expectedUpdatedAt:(await db.user.findUnique({where:{id:user.id}}))?.updatedAt.toISOString()||user.updatedAt.toISOString(),...patch},expected,{'x-cronox-user-identity':uid});
    }
    const anonymous=session();await anonymous.request('cart');await remove(anonymous,middle,401);
    await remove(admin,middle,403);await remove(ordinary,middle,403);await remove(admin,adminTarget,403);await remove(admin,superTarget,403);
    await remove(actor,actorUser,403);await remove(actor,middle,400,{confirmed:false});await remove(actor,middle,409,{expectedUpdatedAt:new Date(0).toISOString()});await remove(actor,middle,409,{},randomUUID());
    assert.ok(await row(middle));check('HTTP permissions: anonymous, USER and ADMIN denied; administrative targets protected; own deletion, missing confirmation, stale version and wrong UUID blocked');
    const product=await db.product.create({data:{name:'PRUEBA LOCAL borrado '+report.run,slug:'delete-local-'+report.run,price:1000,variants:{create:{sku:'DELETE-LOCAL-'+report.run,size:'M',stockQty:5}}},include:{variants:true}}),variant=product.variants[0];
    await db.favorite.create({data:{userId:middle.id,productId:product.id}});
    await db.restockRequest.create({data:{userId:middle.id,variantId:variant.id}});
    await db.passwordResetToken.create({data:{userId:middle.id,token:'reset-'+report.run,expiresAt:new Date(Date.now()+60000)}});
    await db.emailChangeRequest.create({data:{id:randomUUID(),userId:middle.id,oldEmail:middle.email,newEmail:'new-'+report.run+'@example.test',sessionVersion:0,stage:'VERIFY_NEW',tokenHash:'change-'+report.run,cancelHash:'cancel-'+report.run,expiresAt:new Date(Date.now()+60000),lastSentAt:new Date(),windowAt:new Date()}});
    await db.newsletterSubscription.create({data:{userId:middle.id,email:middle.email,subscribedAt:new Date()}});
    const mail=await db.newsletterMailJob.create({data:{email:middle.email,kind:'ACCESS',userId:middle.id,tokenHash:'access-'+report.run,status:'PROCESSING',claimToken:'claim-'+report.run}});
    await targetSession.request('cart/items','POST',{variantId:variant.id,qty:1},201);
    assert.equal((await targetSession.request('m/'+middle.publicMemberToken)).valid,true);
    await targetSession.request('me');
    const full=await actor.request('admin/users?pageSize=100&sort=id&order=asc'),tailBefore=full.data.find(u=>u.id===tail.id),originalTail=await row(tail);
    const first=await remove(actor,middle);assert.equal(first.deleted,true);assert.equal(first.alreadyDeleted,false);
    const replay=await remove(actor,middle);assert.equal(replay.alreadyDeleted,true);
    assert.equal(await db.user.findUnique({where:{id:middle.id}}),null);
    await targetSession.request('me','GET',undefined,401);await targetSession.request('auth/refresh','POST',{},401);
    await targetSession.request('auth/login','POST',{email:middle.email,password},401);
    assert.equal((await targetSession.request('m/'+middle.publicMemberToken)).valid,false);
    for(const model of ['authSession','passwordResetToken','emailChangeRequest','favorite','restockRequest','newsletterSubscription','cart'])assert.equal(await db[model].count({where:{userId:middle.id}}),0,model+' orphan');
    const canceledMail=await db.newsletterMailJob.findUniqueOrThrow({where:{id:mail.id}});assert.equal(canceledMail.tokenHash,null);assert.equal(canceledMail.userId,null);assert.equal(canceledMail.status,'FAILED');assert.equal(canceledMail.errorCode,'ACCOUNT_DELETED');
    assert.equal(await db.auditLog.count({where:{requestKey:'admin-user-delete:'+middle.identityUid}}),1);
    check('Real deletion and repeated HTTP request: one audit; access/refresh/login/QR invalidated; credentials, favorites, waitlist, cart and newsletter cleaned');
    const after=await actor.request('admin/users?pageSize=100&sort=id&order=asc'),tailAfter=after.data.find(u=>u.id===tail.id);
    assert.equal(tailAfter.registrationNumber,tailBefore.registrationNumber-1);
    assert.equal(digest(await row(tail)),digest(originalTail));
    const allRows=await db.user.findMany({orderBy:[{createdAt:'asc'},{id:'asc'}]});const ranks=new Map(allRows.map((u,i)=>[u.id,i+1]));
    for(const query of ['page=2&pageSize=3&sort=id&order=desc',`q=${report.run}&accountState=INACTIVE&pageSize=100`,`q=${report.run}&sort=revenue&order=desc&pageSize=100`]){
      const result=await actor.request('admin/users?'+query);for(const u of result.data)assert.equal(u.registrationNumber,ranks.get(u.id));
    }
    report.ordinalExample={id:tail.id,crx:tail.memberCode,before:tailBefore.registrationNumber,after:tailAfter.registrationNumber};
    check('Deleting an intermediate user closes the ordinal gap; inactive tail keeps its ID/CRX/QR; global ordinal survives page, search, filter and revenue sorting');
    const highWater=await db.userNumberingState.findUniqueOrThrow({where:{id:1}}),registration=session();await registration.request('cart');
    const signup=await registration.request('auth/register','POST',{firstName:'Prueba',lastName:'Posterior',email:`delete-local-signup-${report.run}@example.test`,password},201);
    const created=await db.user.findUniqueOrThrow({where:{id:signup.user.id}});fixtures.signup=created;
    assert.equal(created.id,highWater.nextId);assert.ok(created.id>middle.id);assert.notEqual(created.memberCode,middle.memberCode);
    assert.ok(await db.userIdentityReservation.findUnique({where:{userId:middle.id}}));
    report.newAccount={id:created.id,crx:created.memberCode,deletedId:middle.id,deletedCrx:middle.memberCode};
    check('Normal HTTP registration uses the permanent high-water mark; deleted numeric/CRX identifiers remain reserved');
    const order=await db.order.create({data:{userId:orderUser.id,customerEmail:orderUser.email,subtotal:0,taxRate:0,taxAmount:0,total:0,status:'CANCELLED',provider:'manual',internalNote:'PRUEBA LOCAL bloqueo borrado '+report.run}});
    const blocked=await remove(actor,orderUser,409);assert.equal(blocked.code,'USER_DELETE_BLOCKED');assert.ok(blocked.reasons.some(r=>r.relation.startsWith('Order.')));
    assert.equal(digest(await db.order.findUniqueOrThrow({where:{id:order.id}})),digest(order));
    await checkoutSession.request('cart/items','POST',{variantId:variant.id,qty:1},201);const tabId=randomUUID();
    const hold=await checkoutSession.request('checkout/reservation','POST',{action:'enter',tabId},201);
    assert.equal((await db.productVariant.findUniqueOrThrow({where:{id:variant.id}})).stockQty,4);
    const blockedCheckout=await remove(actor,checkoutUser,409);assert.equal(blockedCheckout.code,'USER_DELETE_BLOCKED');assert.ok(blockedCheckout.reasons.some(r=>r.relation.startsWith('CheckoutSnapshot.')));
    await checkoutSession.request('checkout/reservation','POST',{action:'leave',tabId},201);
    assert.equal((await db.productVariant.findUniqueOrThrow({where:{id:variant.id}})).stockQty,5);
    assert.ok(await row(checkoutUser));assert.ok(await db.checkoutSnapshot.findUnique({where:{id:hold.checkoutSnapshotId}}));
    check('Cancelled order blocks deletion and remains unchanged; live checkout blocks deletion without releasing stock; explicit checkout exit then restores only its unit');
    await remove(actor,adminTarget);await remove(actor,superTarget);
    check('Authorized SUPERADMIN can remove other unused ADMIN/SUPERADMIN test accounts; self remains protected');
    report.deletedIds=[middle.id,adminTarget.id,superTarget.id];
    const recovery=await actor.request('admin/payments/recovery');assert.equal(recovery.reservationWorker.enabled,true);assert.equal(recovery.worker.enabled,true);
    await verifyOriginals(db,originals);
    report.apiPassed=true;report.browserTarget={id:browserUser.id,uid:browserUser.identityUid,email:browserUser.email,crx:browserUser.memberCode};
    const state={run:report.run,fixtures,originals,actorCookies:[...actor.cookies],productId:product.id};fs.writeFileSync(stateFile,JSON.stringify(state));
    fs.writeFileSync(path.join(out,'browser-fixture.private.json'),JSON.stringify({cookies:actor.browserCookies(),target:report.browserTarget}));
    check('Updated schema and client serve users and checkout together; both checkout workers healthy; originals preserved before browser confirmation');
  }finally{await db.$disconnect();save();}
}
run().catch(error=>{report.error=error instanceof assert.AssertionError ? error.message : (error.code||error.name||'VERIFICATION_FAILED');console.error(report.error);save();process.exitCode=1;});
