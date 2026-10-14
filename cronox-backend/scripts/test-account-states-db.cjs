'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const { planSql } = require('./audit-account-states.cjs');
const backend = path.resolve(__dirname, '..');
const name = 'cronox_state_test_' + randomUUID().replace(/-/g, '');
const report = { checks: [], passed: false, cleanedUp: false };
const sql = fs.readFileSync(path.join(backend, 'prisma/migrations/20261015120000_customer_account_enablement/migration.sql'), 'utf8');
async function run() {
  const env = loadLocalEnvironment();
  const source = new URL(env.DATABASE_URL);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(source.hostname));
  assert.equal(env.EMAIL_ENABLED, 'false'); assert.equal(env.BACKGROUND_JOBS_ENABLED, 'false');
  const control = new Client({ connectionString:source.href });
  let client, db, created = false;
  try {
    await control.connect();
    const host = (await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host;
    assert.ok(['127.0.0.1','::1'].includes(host));
    assert.match(name, /^cronox_state_test_[a-f0-9]{32}$/);
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created=true;
    const target = new URL(source); target.pathname='/' + name;
    Object.assign(env, { DATABASE_URL:target.href, DIRECT_URL:target.href, USER_NUMBERING_DATABASE_URL:target.href, VAT_DEFAULT:'0.21' });
    client = new Client({ connectionString:target.href }); await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    const setup=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'db','push','--skip-generate'],{ cwd:backend,env,windowsHide:true,encoding:'utf8',timeout:60000 });
    assert.equal(setup.status,0,'Isolated schema setup failed');
    // Seed the historical enum; no real account data is imported.
    await client.query(`ALTER TABLE "User" DROP COLUMN "registrationClaimable";
      ALTER TABLE "User" ALTER COLUMN "accountState" DROP DEFAULT;
      ALTER TABLE "User" ALTER COLUMN "accountState" TYPE text;
      DROP TYPE "UserAccountState";
      CREATE TYPE "UserAccountState" AS ENUM ('ACTIVE','PRE_REGISTERED','PENDING_PASSWORD','INACTIVE','UNKNOWN');
      ALTER TABLE "User" ALTER COLUMN "accountState" TYPE "UserAccountState" USING "accountState"::"UserAccountState";
      ALTER TABLE "User" ALTER COLUMN "accountState" SET DEFAULT 'ACTIVE';`);
    for (const [i,state,role] of [[1,'ACTIVE','USER'],[2,'PRE_REGISTERED','USER'],[3,'PENDING_PASSWORD','FRIEND'],[4,'PRE_REGISTERED','USER'],[5,'PENDING_PASSWORD','ADMIN'],[6,'INACTIVE','USER'],[7,'UNKNOWN','USER']]) {
      await client.query(`INSERT INTO "User" (id,email,role,"accountState","createdAt","updatedAt","passwordHash","newsletterSubscribed","circleLevel")
        VALUES($1,$2,$3::"Role",$4::"UserAccountState",'2026-01-01','2026-09-01',$5,true,3)`,[i,`fixture-${i}@example.test`,role,state,i===1?'preserved-hash':null]);
    }
    await client.query(`SELECT setval(pg_get_serial_sequence('"User"','id'),7);
      INSERT INTO "AuditLog" (action,"targetType","targetId",metadata) VALUES
      ('admin.user.update','user','4','{"before":{"accountState":"ACTIVE"},"after":{"accountState":"PRE_REGISTERED"}}');`);
    const numbering=fs.readFileSync(path.join(backend,'prisma/migrations/20261008190000_consecutive_user_numbers/migration.sql'),'utf8');
    await client.query('INSERT INTO "UserNumberingState" (id,"nextId",ready) VALUES(1,8,true)');
    await client.query(numbering.slice(numbering.indexOf('CREATE FUNCTION cronox_user_number_code'),numbering.indexOf('CREATE FUNCTION cronox_user_number_plan')));
    await client.query(numbering.slice(numbering.indexOf('CREATE FUNCTION cronox_number_user()'),numbering.indexOf('CREATE FUNCTION cronox_lock_user_deletion()')));
    await client.query('CREATE TRIGGER "User_number_identity" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_number_user()');
    const original=(await client.query('SELECT * FROM "User" ORDER BY id')).rows;
    await client.query(`INSERT INTO "DiscountCode" (code,type,percent,used,"userId") VALUES('FIXTURE','FIRST_ORDER',10,true,2);
      INSERT INTO historial ("userId","pedidosRealizados","articulosAdquiridos","updatedAt") VALUES(2,5,8,'2026-09-01');
      INSERT INTO "NewsletterSubscription" (id,email,"userId","subscribedAt","verifiedAt","updatedAt") VALUES('state-fixture','fixture-2@example.test',2,'2026-09-01',NULL,'2026-09-01');
      INSERT INTO "Address" ("userId",name,line1,city,zip,country,"updatedAt") VALUES(2,'Fixture','Calle local 1','Madrid','28001','ES','2026-09-01');`);
    const related=async()=>({discounts:(await client.query('SELECT * FROM "DiscountCode"')).rows,history:(await client.query('SELECT * FROM historial')).rows,
      subscriptions:(await client.query('SELECT * FROM "NewsletterSubscription"')).rows,addresses:(await client.query('SELECT * FROM "Address"')).rows});
    const relationsBefore=await related();
    await assert.rejects(client.query(sql), /requires review/); await client.query('ROLLBACK');
    assert.deepEqual((await client.query('SELECT * FROM "User" ORDER BY id')).rows,original);
    await client.query(planSql);
    const plan=(await client.query('SELECT id,after,reason FROM account_state_plan ORDER BY id')).rows;
    assert.equal(plan.filter(r=>r.reason==='unknown_state').length,1);
    assert.equal(plan.filter(r=>r.reason==='review_required').length,2);
    assert.equal(plan.filter(r=>r.after==='INACTIVE').length,3);
    await client.query('ROLLBACK');
    report.checks.push('Unknown and ambiguous legacy states abort atomically; no user changes');
    // An operator reviews these synthetic automatic signups; administrative denial remains protected.
    await client.query(`UPDATE "User" SET "accountState"='ACTIVE' WHERE id=7`);
    for (const id of [2,3]) {
      const r=original.find(u=>u.id===id);
      await client.query(`INSERT INTO "AuditLog" ("requestKey",action,metadata) VALUES($1,'account-state.review.v1',$2::jsonb)`,
      ['account-state-v1:'+r.identityUid,JSON.stringify({ expectedState:r.accountState,expectedUpdatedAt:r.updatedAt.toISOString(),accountState:'ACTIVE',reviewed:true,reason:'Synthetic fixture, automatic creation verified' })]);
    }
    const before=(await client.query('SELECT * FROM "User" ORDER BY id')).rows;
    await client.query(`UPDATE "AuditLog" SET metadata=jsonb_set(metadata,'{reviewed}','false'::jsonb) WHERE action='account-state.review.v1'`);
    await assert.rejects(client.query(sql), /requires review/); await client.query('ROLLBACK');
    assert.deepEqual((await client.query('SELECT * FROM "User" ORDER BY id')).rows,before);
    await client.query(`UPDATE "AuditLog" SET metadata=jsonb_set(metadata,'{reviewed}','true'::jsonb) WHERE action='account-state.review.v1'`);
    report.checks.push('An unapproved review marker cannot release migration or change accounts');
    await client.query(sql);
    const after=(await client.query('SELECT * FROM "User" ORDER BY id')).rows;
    assert.deepEqual(after.map(u=>u.accountState),['ACTIVE','ACTIVE','ACTIVE','INACTIVE','INACTIVE','INACTIVE','ACTIVE']);
    const exceptState=rows=>rows.map(({accountState,registrationClaimable,...rest})=>rest);
    assert.deepEqual(exceptState(after),exceptState(before));
    assert.deepEqual(after.map(u=>u.registrationClaimable),[false,true,false,true,false,false,false]);
    assert.deepEqual(await related(),relationsBefore);
    const auditCount=(await client.query('SELECT count(*) FROM "AuditLog"')).rows[0].count;
    await client.query(sql);
    assert.deepEqual((await client.query('SELECT * FROM "User" ORDER BY id')).rows,after);
    assert.equal((await client.query('SELECT count(*) FROM "AuditLog"')).rows[0].count,auditCount);
    for (const old of ['PRE_REGISTERED','PENDING_PASSWORD']) await assert.rejects(client.query('UPDATE "User" SET "accountState"=$1 WHERE id=1',[old]),/invalid input value/);
    assert.equal((await client.query('SELECT count(*) FROM "AuthSession"')).rows[0].count,'0');
    assert.equal((await client.query('SELECT count(*) FROM "NewsletterMailJob"')).rows[0].count,'0');
    report.reconciliation={ toActive:2, keptInactive:3, allOtherUserColumnsPreserved:true };
    report.checks.push('Migration persists only ACTIVE/INACTIVE; disabled/admin access preserved, timestamps/passwords/roles/consents unchanged; rerun has no effect and old writers fail');
    Object.assign(process.env,env);
    require('ts-node').register({ project:path.join(backend,'tsconfig.json'),transpileOnly:true });
    const { PrismaService }=require('../src/prisma/prisma.service');
    const { UsersService }=require('../src/users/users.service');
    const { NewsletterService }=require('../src/newsletter/newsletter.service');
    const { AuthService }=require('../src/auth/auth.service');
    const { AuthSessionsService }=require('../src/auth/auth-sessions.service');
    const { KeyScreenService }=require('../src/key-screen/key-screen.service');
    const { AdminBulkService }=require('../src/admin/bulk/admin-bulk.service');
    const { GuestOrderAccountService }=require('../src/orders/guest-order-account.service');
    const { AdminUsersService }=require('../src/admin/users/admin-users.service');
    db=new PrismaService(); await db.$connect();
    const users=new UsersService(db), newsletters=new NewsletterService(db,{ isEnabled:()=>false });
    const sessions=new AuthSessionsService(db);
    const auth=new AuthService(users,{},db,{ isEnabled:()=>false },newsletters,sessions);
    const password='LocalFixturePassword1';
    const registered=await auth.register({ email:'registered@example.test',firstName:'Local',lastName:'Fixture',password });
    assert.equal((await db.user.findUniqueOrThrow({where:{id:registered.user.id}})).accountState,'ACTIVE');
    await sessions.verify(registered.tokens.accessToken,'access');
    const screen=await db.keyScreen.create({data:{internalName:'Local account state',mode:'PREREGISTRATION'}});
    await db.keyScreenSettings.create({data:{id:'global',enabled:true,activeScreenId:screen.id}});
    await new KeyScreenService(db,{}, {isEnabled:()=>false}).preregister('key-screen@example.test');
    const pre=await db.user.findUniqueOrThrow({where:{email:'key-screen@example.test'},include:{preRegistration:true}});
    assert.equal(pre.accountState,'ACTIVE'); assert.equal(pre.password,null); assert.ok(pre.preRegistration);
    await newsletters.subscribe('newsletter@example.test');
    const subscribed=await db.user.findUniqueOrThrow({where:{email:'newsletter@example.test'}});
    assert.equal(subscribed.accountState,'ACTIVE'); assert.equal(subscribed.password,null);
    assert.equal(subscribed.registrationClaimable,true);
    await auth.register({email:subscribed.email,firstName:'Local',lastName:'Newsletter',password});
    assert.equal((await db.user.findUniqueOrThrow({where:{id:subscribed.id}})).registrationClaimable,false);
    const guest=new GuestOrderAccountService();
    const guestResult=await db.$transaction(tx=>guest.resolveUserForCompletedOrder(tx,{userId:null,customerEmail:'guest@example.test',shippingAddr:null,billingAddr:null}));
    assert.equal((await db.user.findUniqueOrThrow({where:{id:guestResult.userId}})).accountState,'ACTIVE');
    await assert.rejects(auth.register({email:'guest@example.test',firstName:'Local',lastName:'Guest',password}));
    const passwordlessAdmin=await db.user.create({data:{email:'passwordless-admin@example.test',role:'ADMIN',registrationClaimable:true}});
    await assert.rejects(auth.register({email:passwordlessAdmin.email,firstName:'Local',lastName:'Admin',password}));
    const admin=new AdminUsersService(db);
    assert.equal((await admin.getUserById(registered.user.id)).user.accountState,'ACTIVE');
    const list=await admin.listUsers({accountState:'INACTIVE'}); assert.equal(list.meta.total,3);
    assert.ok(list.data.every(u=>u.accountState==='INACTIVE'));
    report.checks.push('Real PostgreSQL registration, key-screen, newsletter and guest-account creation persist ACTIVE; admin reload/filter returns stored state; real local session verifies; mail disabled');
    for (const state of ['ACTIVE','INACTIVE']) {
      const row=await db.user.create({data:{email:`password-${state.toLowerCase()}@example.test`,accountState:state}});
      const raw=randomUUID(); await db.passwordResetToken.create({data:{userId:row.id,token:createHash('sha256').update(raw).digest('hex'),expiresAt:new Date(Date.now()+60000)}});
      await auth.resetPassword(raw,password);
      assert.equal((await db.user.findUniqueOrThrow({where:{id:row.id}})).accountState,state);
      assert.equal(Boolean(await auth.validateUser(row.email,password)),state==='ACTIVE');
      if(state==='ACTIVE') {
        await auth.changePassword(row.id,{currentPassword:password,newPassword:'SecondLocalPassword2'});
        assert.equal((await db.user.findUniqueOrThrow({where:{id:row.id}})).accountState,'ACTIVE');
      } else await assert.rejects(auth.changePassword(row.id,{currentPassword:password,newPassword:'SecondLocalPassword2'}));
      if(state==='INACTIVE') {
        await assert.rejects(auth.register({email:row.email,firstName:'Local',lastName:'Fixture',password}));
        await newsletters.subscribe(row.email);
        await db.$transaction(tx=>guest.resolveUserForCompletedOrder(tx,{userId:null,customerEmail:row.email,shippingAddr:null,billingAddr:null}));
        await users.updateProfile(row.id,{firstName:'Updated'});
        assert.equal((await db.user.findUniqueOrThrow({where:{id:row.id}})).accountState,'INACTIVE');
        assert.equal(await auth.validateUser(row.email,password),null);
      }
    }
    report.checks.push('Real password setup/reset preserves ACTIVE/INACTIVE; inactive re-registration fails; newsletter, guest purchase identity resolution and profile changes cannot reactivate/login');
    const adminRow=await db.user.create({data:{email:'admin@example.test',role:'SUPERADMIN'}});
    const noPassword=await db.user.create({data:{email:'no-password@example.test',accountState:'INACTIVE'}});
    await admin.updateAdminUser(noPassword.id,{expectedUpdatedAt:noPassword.updatedAt.toISOString(),accountState:'ACTIVE'},adminRow.id);
    const reread=await db.user.findUniqueOrThrow({where:{id:noPassword.id}});
    assert.equal(reread.accountState,'ACTIVE'); assert.equal(reread.password,null);
    report.checks.push('Administrative activation without password persists and is audited');
    const bulk=new AdminBulkService(db,admin,{});
    const request={kind:'users',ids:[registered.user.id,noPassword.id],userIdentities:{[registered.user.id]:registered.user.identityUid,[noPassword.id]:noPassword.identityUid},changes:{accountState:'INACTIVE'}};
    const preview=await bulk.preview(request,adminRow.id);
    const execution={...request,reviewToken:preview.reviewToken,operationId:randomUUID()};
    const result=await bulk.execute(execution,adminRow.id);
    assert.equal(result.counts.changed,2); assert.deepEqual(await bulk.execute(execution,adminRow.id),result);
    await assert.rejects(sessions.verify(registered.tokens.accessToken,'access'));
    const activate={...request,changes:{accountState:'ACTIVE'}};
    const reviewed=await bulk.preview(activate,adminRow.id);
    await db.user.update({where:{id:noPassword.id},data:{name:'Concurrent edit'}});
    await assert.rejects(bulk.execute({...activate,reviewToken:reviewed.reviewToken,operationId:randomUUID()},adminRow.id));
    assert.equal(await db.user.count({where:{id:{in:request.ids},accountState:'INACTIVE'}}),2);
    const fresh=await bulk.preview(activate,adminRow.id);
    await bulk.execute({...activate,reviewToken:fresh.reviewToken,operationId:randomUUID()},adminRow.id);
    assert.equal((await db.user.findUniqueOrThrow({where:{id:noPassword.id}})).password,null);
    report.checks.push('Real bulk disable invalidates the old session; identical execution idempotent; stale review rolls back all users; reviewed activation works with/without password');
    report.passed=true;
  } finally {
    if(db) await db.$disconnect(); if(client) await client.end();
    if(created) { assert.match(name,/^cronox_state_test_[a-f0-9]{32}$/); await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); report.cleanedUp=true; }
    await control.end();
    const out=path.resolve(backend,'../test-results/account-states-db.json'); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report,null,2));
}
run().catch(e=>{ console.error('Isolated account-state verification failed: '+(e.code||e.message)); process.exitCode=1; });
