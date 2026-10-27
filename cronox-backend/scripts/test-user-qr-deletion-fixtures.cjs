'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
module.exports=async({db,second,sql,service,competing,actor,admin,create,sessions,membership,check,product})=>{
 const {QrEventsService}=require('../src/admin/qr-events/qr-events.service'),{CircleService}=require('../src/membership/circle.service');
 const qr=new QrEventsService(db,new CircleService(db,{})),qrOther=new QrEventsService(second,new CircleService(second,{}));
 const preview=u=>service.deletionPreview(u.id,u.identityUid,actor.id);
 const dto=p=>({confirmed:true,expectedUpdatedAt:p.user.updatedAt,qrParticipationToken:p.qr.token,...(p.qr.count?{deleteQrParticipations:true}:{})});
 const remove=(u,p,delegate=service)=>delegate.deleteUser(u.id,u.identityUid,dto(p),actor.id);
 const group=name=>db.qrEventGroup.create({data:{name,createdByIdentityUid:actor.identityUid}});
 const add=(g,u,by=actor)=>db.qrEventParticipant.create({data:{groupId:g.id,userIdentityUid:u.identityUid,registeredByIdentityUid:by.identityUid,circleAtRegistration:1}});
 const exists=u=>db.user.findUnique({where:{id:u.id}});
 const participants=()=>db.qrEventParticipant.findMany({orderBy:{id:'asc'}});
 const g1=await group('QR prueba uno'),g2=await group('QR prueba dos'),other=await create();
 await add(g1,other);await add(g2,other);
 const empty=await create(),p0=await preview(empty);assert.equal(p0.qr.count,0);assert.equal(p0.qr.eventCount,0);assert.equal(p0.blockers.length,0);await remove(empty,p0);assert.equal(await exists(empty),null);
 await assert.rejects(service.deletionPreview(actor.id,actor.identityUid,actor.id),/propia/);
 await assert.rejects(service.deletionPreview(other.id,other.identityUid,admin.id),/Super Admin/);
 check('QR deletion preview is read-only, SUPERADMIN-only, rejects self-deletion and retains the normal empty-account confirmation');
 for(const number of [1,2]){
  const u=await create({name:'QR participante '+number}),savedGroups=await db.qrEventGroup.findMany({orderBy:{id:'asc'}});
  await add(g1,u);if(number===2)await add(g2,u);
  const before=await participants(),p=await preview(u);assert.equal(p.qr.count,number);assert.equal(p.qr.eventCount,number);assert.equal(p.blockers.length,0);
  assert.deepEqual(p.qr.events.map(e=>e.name).sort(),(number===1?[g1.name]:[g1.name,g2.name]).sort());
  // Opening/canceling a preview cannot mutate participants or credentials.
  const auth=await sessions.create(u);await preview(u);assert.deepEqual(await participants(),before);assert.equal((await sessions.verify(auth.accessToken,'access')).user.id,u.id);
  await assert.rejects(service.deleteUser(u.id,u.identityUid,{confirmed:true,expectedUpdatedAt:u.updatedAt.toISOString()},actor.id),e=>e.getResponse().code==='USER_DELETE_QR_CONFIRMATION_CHANGED');
  const results=await Promise.all([remove(u,p),remove(u,p,competing)]);assert.ok(results.every(r=>r.deleted));assert.equal(results.filter(r=>!r.alreadyDeleted).length,1);
  assert.equal(await exists(u),null);assert.equal(await db.qrEventParticipant.count({where:{userIdentityUid:u.identityUid}}),0);
  assert.deepEqual(await participants(),before.filter(r=>r.userIdentityUid!==u.identityUid));assert.deepEqual(await db.qrEventGroup.findMany({orderBy:{id:'asc'}}),savedGroups);
  await assert.rejects(sessions.verify(auth.accessToken,'access'));await assert.rejects(sessions.rotate(auth.refreshToken));assert.equal((await membership.getMemberInfo(u.publicMemberToken)).valid,false);
  const log=await db.auditLog.findFirstOrThrow({where:{actionType:'admin.user.delete',targetId:String(u.id)}});assert.equal(log.metadata.qrParticipationsDeleted,number);assert.equal(log.metadata.qrEvents.length,number);
  assert.equal(await db.auditLog.count({where:{actionType:'admin.user.delete',targetId:String(u.id)}}),1);
 }
 const detail=await qr.participants(g1.id,{page:1,limit:25});assert.equal(detail.group.total,1);assert.deepEqual(detail.items.map(p=>p.userId),[other.id]);
 const listed=await qr.list({page:1,limit:50});assert.equal(listed.items.find(g=>g.id===g1.id).total,1);
 const excel=await qr.exportIds(g1.id),workbook=new(require('exceljs').Workbook)();await workbook.xlsx.load(excel.buffer);assert.deepEqual(workbook.worksheets[0].getColumn(1).values.slice(1),['ID de usuario',other.id]);
 check('One/multiple-event deletion requires consent, removes only that account, invalidates sessions/QR once and preserves groups/other rows; counters and actual Excel reflect the removal');
 const stale=await create(),old=await preview(stale);await add(g1,stale);
 await assert.rejects(remove(stale,old),e=>e.getResponse().code==='USER_DELETE_QR_CONFIRMATION_CHANGED'&&e.getResponse().preview.qr.count===1);
 const one=await preview(stale);await add(g2,stale);await assert.rejects(remove(stale,one),e=>e.getResponse().preview.qr.eventCount===2);
 const two=await preview(stale);const first=await db.qrEventParticipant.findFirstOrThrow({where:{groupId:g1.id,userIdentityUid:stale.identityUid}});
 await db.qrEventParticipant.delete({where:{id:first.id}});await add(g1,stale);await assert.rejects(remove(stale,two),e=>e.getResponse().code==='USER_DELETE_QR_CONFIRMATION_CHANGED');
 await remove(stale,await preview(stale));
 check('Zero-to-one, one-to-many and same-count replacement all invalidate old confirmation fingerprints without deleting the account');
 const protectedUser=await create();await add(g1,protectedUser);
 const order=await db.order.create({data:{userId:protectedUser.id,customerEmail:protectedUser.email,total:10,subtotal:10,taxRate:0,taxAmount:0,currency:'EUR',status:'CANCELLED',provider:'fixture'}});
 const protectedRows=await participants(),protectedPlan=await preview(protectedUser);assert.ok(protectedPlan.blockers.some(b=>b.relation.startsWith('Order')));
 await assert.rejects(remove(protectedUser,protectedPlan),e=>e.getResponse().code==='USER_DELETE_BLOCKED'&&/pedidos/.test(e.message));assert.deepEqual(await participants(),protectedRows);assert.ok(await exists(protectedUser));assert.ok(await db.order.findUnique({where:{id:order.id}}));
 const recorder=await create({role:'ADMIN'});await add(g1,recorder);const foreign=await create();await add(g2,foreign,recorder);
 const recorderPlan=await preview(recorder);assert.equal(recorderPlan.qr.eventCount,1);assert.ok(recorderPlan.blockers.some(b=>b.relation==='QrEventParticipant.registeredByIdentityUid'&&b.count===1));
 const foreignBefore=await participants();await assert.rejects(remove(recorder,recorderPlan),/autoría administrativa/);assert.deepEqual(await participants(),foreignBefore);
 const selfRecorder=await create({role:'ADMIN'});await add(g1,selfRecorder,selfRecorder);const selfPlan=await preview(selfRecorder);assert.equal(selfPlan.blockers.length,0);await remove(selfRecorder,selfPlan);
 check('Financial history stays blocked and rolls back participation removal; authorship of other people remains protected and is never counted/deleted as own membership; self-recorded own rows can be removed');
 const rollback=await create();await add(g1,rollback);const rollbackToken=await sessions.create(rollback),rollbackPlan=await preview(rollback),beforeRollback=await participants();
 await sql.query(`CREATE FUNCTION qr_delete_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id=${rollback.id} THEN RAISE EXCEPTION 'fictitious failure'; END IF; RETURN OLD; END $$;CREATE TRIGGER zz_qr_delete_test_failure BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION qr_delete_test_failure()`);
 await assert.rejects(remove(rollback,rollbackPlan));assert.ok(await exists(rollback));assert.deepEqual(await participants(),beforeRollback);assert.equal((await sessions.verify(rollbackToken.accessToken,'access')).user.id,rollback.id);
 assert.equal((await sql.query('SELECT count(*)::int n FROM "AdminUserDeletion" WHERE "userId"=$1',[rollback.id])).rows[0].n,0);
 assert.equal(await db.auditLog.count({where:{actionType:'admin.user.delete',targetId:String(rollback.id)}}),0);
 await sql.query('DROP TRIGGER zz_qr_delete_test_failure ON "User";DROP FUNCTION qr_delete_test_failure()');await remove(rollback,rollbackPlan);
 check('A real SQL failure after participation/access cleanup restores every row, session, receipt and audit; explicit retry succeeds');
 function pause(delegate,model,method,entered,release,before=false){let once=true;return new Proxy(delegate,{get(client,key){if(key!=='$transaction'){const v=client[key];return typeof v==='function'?v.bind(client):v;}return(work,options)=>client.$transaction(tx=>work(new Proxy(tx,{get(target,key){if(key!==model){const v=target[key];return typeof v==='function'?v.bind(target):v;}return new Proxy(target[key],{get(object,operation){const v=object[operation];if(operation!==method)return v;return async(...args)=>{if(before&&once){once=false;entered.resolve();await release.promise;}const value=await v.apply(object,args);if(!before&&once){once=false;entered.resolve();await release.promise;}return value;};}});}})),options);}});}
 async function waitForLock(){for(let i=0;i<100;i++){if((await sql.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%User%FOR%'`)).rows[0].n)return;await new Promise(r=>setTimeout(r,20));}throw Error('Expected actual competing row lock');}
 const scanFirst=await create(),scanPlan=await preview(scanFirst),entered=gate(),release=gate();
 const slowScan=new QrEventsService(pause(db,'qrEventParticipant','createMany',entered,release),new CircleService(db,{}));
 const scanning=slowScan.scan(g1.id,'CRX:1:'+scanFirst.publicMemberToken,actor.id);await entered.promise;
 const removal=remove(scanFirst,scanPlan,competing).then(value=>({value}),error=>({error}));try{await waitForLock();}finally{release.resolve();}
 assert.equal((await scanning).status,'registered');const rejected=await removal;assert.equal(rejected.error?.getResponse().code,'USER_DELETE_QR_CONFIRMATION_CHANGED');assert.ok(await exists(scanFirst));assert.equal(await db.qrEventParticipant.count({where:{userIdentityUid:scanFirst.identityUid}}),1);await remove(scanFirst,await preview(scanFirst));
 const deleteFirst=await create(),deletePlan=await preview(deleteFirst),enteredDelete=gate(),releaseDelete=gate();
 const {AdminUsersService}=require('../src/admin/users/admin-users.service');
 const slowRemoval=new AdminUsersService(pause(db,'user','delete',enteredDelete,releaseDelete,true));
 const deleting=remove(deleteFirst,deletePlan,slowRemoval);await enteredDelete.promise;
 const waitingScan=qrOther.scan(g2.id,'CRX:1:'+deleteFirst.publicMemberToken,actor.id).then(value=>({value}),error=>({error}));try{await waitForLock();}finally{releaseDelete.resolve();}
 assert.equal((await deleting).deleted,true);assert.ok((await waitingScan).error);assert.equal(await db.qrEventParticipant.count({where:{userIdentityUid:deleteFirst.identityUid}}),0);
 check('Actual scan/delete races: committed scan forces a new warning; deletion holding the user lock prevents a waiting scan and leaves no orphan');
 assert.equal((await sql.query('SELECT count(*)::int n FROM "QrEventParticipant" p LEFT JOIN "QrEventGroup" g ON g.id=p."groupId" WHERE g.id IS NULL')).rows[0].n,0);
};
