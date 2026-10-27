'use strict';
// All writes/deletions occur in a uniquely named disposable loopback database.
// Real PostgreSQL constraints, production services, sessions, role/CSRF guards.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process'),{Client}=require('pg');
const backend=path.resolve(__dirname,'..'),out=path.resolve(backend,'../output/qr-event-deletion');
const report={isolatedDatabase:true,realEventsDeleted:false,checks:[],passed:false,cleanedUp:false};
const check=name=>{report.checks.push(name);console.log('[PASS]',name);};
const read=file=>fs.readFileSync(path.join(backend,file),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
  const local=require('./start-local.cjs').loadLocalEnvironment(),source=new URL(local.DATABASE_URL);source.search='';
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(source.hostname));
  const name='cronox_qr_delete_test_'+randomUUID().replace(/-/g,'');assert.match(name,/^cronox_qr_delete_test_[a-f0-9]{32}$/);
  const control=new Client({connectionString:source.href});let created=false,setup,db,second,app;
  try{
    await control.connect();assert.ok(['127.0.0.1','::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`);created=true;
    const target=new URL(source);target.pathname='/'+name;target.searchParams.set('connection_limit','2');
    const env={...local,DATABASE_URL:target.href,DIRECT_URL:target.href,USER_NUMBERING_DATABASE_URL:target.href,
      EMAIL_ENABLED:'false',BACKGROUND_JOBS_ENABLED:'false',CRONOX_LOCAL_CHECKOUT_TEST:'false',CHECKOUT_RESERVATION_WORKER_ENABLED:'false',STRIPE_WEBHOOK_WORKER_ENABLED:'false'};
    setup=new Client({connectionString:target.href});await setup.connect();await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    const push=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'db','push','--skip-generate'],{cwd:backend,env,encoding:'utf8',windowsHide:true,timeout:60000});
    assert.equal(push.status,0,'Disposable schema initialization failed');
    // Install the actual event migration, including SQL-only checks and RESTRICT.
    await setup.query('DROP TABLE "QrEventParticipant"; DROP TABLE "QrEventGroup"');
    await setup.query(read('prisma/migrations/20261016160000_metacrilatos_qr_events/migration.sql'));
    Object.assign(process.env,env);require('../test/test-environment.cjs').installTestEnvironment({force:true,overrides:env});
    require('ts-node').register({project:path.join(backend,'tsconfig.json'),transpileOnly:true});
    const {PrismaService}=require('../src/prisma/prisma.service'),{CircleService}=require('../src/membership/circle.service');
    const {QrEventsService}=require('../src/admin/qr-events/qr-events.service'),{AuthSessionsService}=require('../src/auth/auth-sessions.service');
    db=new PrismaService();second=new PrismaService();await db.$connect();await second.$connect();
    assert.equal((await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name,name);
    let index=0;const user=async(role='USER',data={})=>{const n=++index;return db.user.create({data:{email:`event-delete-${n}@example.test`,role,firstName:'Prueba',memberCode:'CRX-'+String(n).padStart(6,'0'),...data}});};
    const superadmin=await user('SUPERADMIN'),admin=await user('ADMIN'),person=await user(),friend=await user('FRIEND');
    const circles=new CircleService(db,{}),service=new QrEventsService(db,circles),service2=new QrEventsService(second,new CircleService(second,{}));
    const payload='CRX:1:'+person.publicMemberToken;
    const other=await service.create({name:'Otro evento conservado'},admin.id),populated=await service.create({name:'Evento con participantes'},admin.id);
    await service.scan(other.id,payload,admin.id);await service.scan(populated.id,payload,admin.id);await service.scan(populated.id,'CRX:1:'+friend.publicMemberToken,admin.id);
    await db.qrEventParticipant.create({data:{groupId:populated.id,circleAtRegistration:1}}); // anonymous historical record
    const userRows=await db.user.findMany({orderBy:{id:'asc'}}),otherRows=await db.qrEventParticipant.findMany({where:{groupId:other.id},orderBy:{id:'asc'}});
    const originalGroup=await db.qrEventGroup.findUniqueOrThrow({where:{id:other.id}});
    const order=await db.order.create({data:{userId:person.id,customerEmail:person.email,subtotal:10,taxRate:0,taxAmount:0,total:10,status:'PAID',provider:'manual'}});
    const design=await db.accreditationDesign.findMany(),selection=await db.accreditationSelection.findMany();
    await assert.rejects(service.delete(populated.id,false,superadmin.id),/expresamente/);
    await assert.rejects(service.delete(populated.id,true,admin.id),/SUPERADMIN/);
    assert.equal(await db.qrEventParticipant.count({where:{groupId:populated.id}}),3);
    const results=await Promise.all([service.delete(populated.id,true,superadmin.id),service2.delete(populated.id,true,superadmin.id)]);
    assert.equal(results.filter(r=>!r.alreadyDeleted).length,1);assert.equal(results.find(r=>!r.alreadyDeleted).participantsDeleted,3);
    assert.equal(await db.qrEventGroup.findUnique({where:{id:populated.id}}),null);assert.equal(await db.qrEventParticipant.count({where:{groupId:populated.id}}),0);
    assert.equal(await db.auditLog.count({where:{requestKey:'qr-event-delete:'+populated.id}}),1);
    assert.deepEqual((await db.auditLog.findUniqueOrThrow({where:{requestKey:'qr-event-delete:'+populated.id}})).metadata,{name:populated.name,participantsDeleted:3});
    check('Confirmed deletion removes only three selected-group records; concurrent repeated requests produce one deletion and one audit');
    const empty=await service.create({name:'Vacío'},admin.id);assert.equal((await service.delete(empty.id,true,superadmin.id)).participantsDeleted,0);
    assert.equal((await service.delete(empty.id,true,superadmin.id)).alreadyDeleted,true);
    await assert.rejects(service.get(empty.id),e=>e.getResponse().code==='GROUP_UNAVAILABLE');
    await assert.rejects(service.participants(empty.id,{page:1,limit:25}),e=>e.getResponse().code==='GROUP_UNAVAILABLE');
    await assert.rejects(service.exportIds(empty.id),e=>e.getResponse().code==='GROUP_UNAVAILABLE');
    check('Empty groups delete cleanly; repeated deletion succeeds idempotently; stale detail, participants and export return GROUP_UNAVAILABLE');
    const load=await service.create({name:'Escaneos concurrentes con pool pequeño'},admin.id);
    const scans=await Promise.all(Array.from({length:12},()=>service.scan(load.id,payload,admin.id)));
    assert.equal(scans.filter(r=>r.status==='registered').length,1);
    assert.equal(await db.qrEventParticipant.count({where:{groupId:load.id}}),1);
    await service.delete(load.id,true,superadmin.id);
    check('Twelve concurrent scans with two DB connections use one transaction each and retain one unique registration without pool starvation');
    // Hold a real shared group lock inside scan, then race the exclusive delete.
    const scanFirst=await service.create({name:'Escaneo primero'},admin.id),entered=deferred(),release=deferred();
    const slowScan=new QrEventsService(db,{maybePromoteRequestedCircle:async()=>{entered.resolve();await release.promise;}});
    const scan=slowScan.scan(scanFirst.id,payload,admin.id);await entered.promise;
    let deleteFinished=false;const deletion=service2.delete(scanFirst.id,true,superadmin.id).then(r=>{deleteFinished=true;return r;});
    await pause(60);assert.equal(deleteFinished,false);release.resolve();assert.equal((await scan).status,'registered');assert.equal((await deletion).participantsDeleted,1);
    assert.equal(await db.qrEventParticipant.count({where:{groupId:scanFirst.id}}),0);
    check('Scan holding FOR SHARE finishes first; deletion waits and then removes its committed participation atomically');
    // Fence the delete after DELETE but before its audit/commit, using a proxy
    // only to pause. All statements still execute against real PostgreSQL.
    const deleteFirst=await service.create({name:'Borrado primero'},admin.id),removed=deferred(),commit=deferred();
    const pausedDb=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return{create:async args=>{removed.resolve();await commit.promise;return t.auditLog.create(args);}};return t[k];}})),options);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const deleteInFlight=new QrEventsService(pausedDb,circles).delete(deleteFirst.id,true,superadmin.id);await removed.promise;
    let scanFinished=false;const lateScan=service2.scan(deleteFirst.id,payload,admin.id).then(()=>{scanFinished=true;return null;},e=>{scanFinished=true;return e;});
    await pause(60);assert.equal(scanFinished,false);commit.resolve();await deleteInFlight;
    assert.equal((await lateScan).getResponse().code,'GROUP_UNAVAILABLE');assert.equal(await db.qrEventParticipant.count({where:{groupId:deleteFirst.id}}),0);
    check('Deletion holding FOR UPDATE wins; a waiting real scan sees deletion and cannot insert a participant');
    // A QR for a user whose requested promotion is due must not mutate that user
    // if the event was deleted before the request reached the server.
    await db.user.update({where:{id:friend.id},data:{circleLevel:2}});
    await db.circlePromotionRequest.create({data:{userId:friend.id,promoteAt:new Date(0)}});
    await assert.rejects(service.scan(deleteFirst.id,'CRX:1:'+friend.publicMemberToken,admin.id),e=>e.getResponse().code==='GROUP_UNAVAILABLE');
    assert.equal((await db.user.findUniqueOrThrow({where:{id:friend.id}})).circleLevel,2);
    assert.equal((await db.circlePromotionRequest.findUniqueOrThrow({where:{userId:friend.id}})).status,'pending');
    await db.user.update({where:{id:friend.id},data:{circleLevel:userRows.find(u=>u.id===friend.id).circleLevel}});await db.circlePromotionRequest.delete({where:{userId:friend.id}});
    // Compare immutable and user fields; the setup-only circle update advances
    // updatedAt, so restore the recorded timestamp without changing identities.
    await db.user.update({where:{id:friend.id},data:{updatedAt:userRows.find(u=>u.id===friend.id).updatedAt}});
    check('A stale scan rejects before circle promotion, leaving the due request and participant account untouched');
    const {Test}=require('@nestjs/testing'),{PassportModule}=require('@nestjs/passport'),{ValidationPipe}=require('@nestjs/common');
    const {QrEventsController}=require('../src/admin/qr-events/qr-events.controller'),{UsersService}=require('../src/users/users.service');
    const {JwtAccessStrategy}=require('../src/auth/strategies/jwt-access.strategy'),{AdminGuard}=require('../src/common/guards/admin.guard'),{RolesGuard}=require('../src/common/guards/roles.guard'),{SuperAdminGuard}=require('../src/common/guards/super-admin.guard'),{CsrfProtectionGuard}=require('../src/common/guards/csrf-protection.guard');
    const sessions=new AuthSessionsService(db),module=await Test.createTestingModule({imports:[PassportModule],controllers:[QrEventsController],providers:[AdminGuard,RolesGuard,SuperAdminGuard,JwtAccessStrategy,{provide:UsersService,useValue:new UsersService(db)},{provide:AuthSessionsService,useValue:sessions},{provide:QrEventsService,useValue:service}]}).compile();
    app=module.createNestApplication();app.useLogger(false);app.setGlobalPrefix('api');app.use(require('cookie-parser')());app.useGlobalGuards(new CsrfProtectionGuard());app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.init();
    const http=require('supertest')(app.getHttpServer()),tokens={};for(const u of [superadmin,admin,person,friend])tokens[u.role]=(await sessions.create(u)).accessToken;
    const auth=role=>({Authorization:'Bearer '+tokens[role]}),csrf={Origin:env.FRONTEND_URL,Cookie:'cronox_csrf_token=qr-delete-test','X-CSRF-Token':'qr-delete-test'};
    const httpGroup=await service.create({name:'HTTP confirmado'},admin.id);const route='/api/admin/qr-events/'+httpGroup.id;
    await http.delete(route).set(csrf).send({confirmed:true}).expect(401);
    for(const role of ['USER','FRIEND','ADMIN'])await http.delete(route).set({...csrf,...auth(role)}).send({confirmed:true}).expect(403);
    await http.delete(route).set(auth('SUPERADMIN')).send({confirmed:true}).expect(403);
    await http.delete(route).set({...csrf,...auth('SUPERADMIN')}).send({confirmed:false}).expect(400);
    await http.delete('/api/admin/qr-events/not-a-uuid').set({...csrf,...auth('SUPERADMIN')}).send({confirmed:true}).expect(400);
    assert.equal((await http.get('/api/admin/qr-events').set(auth('ADMIN')).expect(200)).body.canDelete,false);
    assert.equal((await http.get('/api/admin/qr-events').set(auth('SUPERADMIN')).expect(200)).body.canDelete,true);
    await http.delete(route).set({...csrf,...auth('SUPERADMIN')}).send({confirmed:true}).expect(200);
    assert.equal((await http.delete(route).set({...csrf,...auth('SUPERADMIN')}).send({confirmed:true}).expect(200)).body.alreadyDeleted,true);
    await http.post(route+'/scan').set({...csrf,...auth('ADMIN')}).send({qrContent:payload}).expect(404);
    check('Real JWT/CSRF HTTP guards: only SUPERADMIN deletes; missing confirmation/invalid UUID reject; ADMIN keeps scan/list access without delete capability');
    const failure=await service.create({name:'Rollback'},admin.id);await service.scan(failure.id,payload,admin.id);
    await setup.query(`CREATE FUNCTION fixture_reject_event_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."targetId"='${failure.id}' AND NEW."actionType"='qr_event.delete' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_reject_event_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fixture_reject_event_audit()`);
    await http.delete('/api/admin/qr-events/'+failure.id).set({...csrf,...auth('SUPERADMIN')}).send({confirmed:true}).expect(500);
    assert.ok(await db.qrEventGroup.findUnique({where:{id:failure.id}}));assert.equal(await db.qrEventParticipant.count({where:{groupId:failure.id}}),1);assert.equal(await db.auditLog.count({where:{targetId:failure.id,actionType:'qr_event.delete'}}),0);
    await setup.query('DROP TRIGGER fixture_reject_event_audit ON "AuditLog"; DROP FUNCTION fixture_reject_event_audit()');
    await http.delete('/api/admin/qr-events/'+failure.id).set({...csrf,...auth('SUPERADMIN')}).send({confirmed:true}).expect(200);
    check('A real SQL audit failure rolls back group and participation deletion; explicit retry succeeds without duplicate audit');
    assert.deepEqual(await db.user.findMany({orderBy:{id:'asc'}}),userRows);assert.deepEqual(await db.qrEventParticipant.findMany({where:{groupId:other.id},orderBy:{id:'asc'}}),otherRows);
    assert.deepEqual(await db.qrEventGroup.findUniqueOrThrow({where:{id:other.id}}),originalGroup);assert.deepEqual(await db.order.findUniqueOrThrow({where:{id:order.id}}),order);
    assert.deepEqual(await db.accreditationDesign.findMany(),design);assert.deepEqual(await db.accreditationSelection.findMany(),selection);
    assert.equal((await db.$queryRawUnsafe('SELECT count(*)::int AS total FROM "QrEventParticipant" p LEFT JOIN "QrEventGroup" g ON g.id=p."groupId" WHERE g.id IS NULL'))[0].total,0);
    check('Every user field, QR/CRX, circle, accreditation selection, order and other-event registration remains unchanged; no orphaned participations');
    report.passed=true;
  }finally{
    if(app)await app.close();if(db)await db.$disconnect();if(second)await second.$disconnect();if(setup)await setup.end();
    if(created){await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);report.cleanedUp=true;}await control.end();
  }
}
run().catch(error=>{report.error=error instanceof assert.AssertionError?error.message:(error.code||error.name);console.error(report.error);process.exitCode=1;}).finally(()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'database-results.json'),JSON.stringify(report,null,2));});
