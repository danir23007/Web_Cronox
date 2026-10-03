/* Only invoked with the isolated review-mailbox PostgreSQL/app. No real push. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto');
module.exports=async({app,db,backend,request,boxId,users,sessions,push,security,webpush,pass})=>{
  assert.equal(new URL(process.env.DATABASE_URL).hostname,'127.0.0.1');
  const {AdminEventPushService}=require(path.join(backend,'dist/mailbox/admin-event-push.service'));
  const {VisitorHistoryService}=require(path.join(backend,'dist/analytics/visitor-history.service'));
  const {WaitlistService}=require(path.join(backend,'dist/waitlist/waitlist.service'));
  const events=app.get(AdminEventPushService),history=app.get(VisitorHistoryService),waitlist=app.get(WaitlistService);
  const actor={id:users.superadmin.id,role:'SUPERADMIN'};
  const token=await sessions.create(users.superadmin),s=await sessions.verify(token.accessToken,'access');
  security.resolvePublic=async()=>({address:'8.8.8.8',family:4});
  Object.assign(process.env,{MAILBOX_VAPID_PUBLIC_KEY:'A'.repeat(87),MAILBOX_VAPID_PRIVATE_KEY:'A'.repeat(43),MAILBOX_VAPID_SUBJECT:'mailto:admin@example.test'});
  const pushed=[];webpush.sendNotification=async(_s,p)=>{pushed.push(JSON.parse(p));return{statusCode:201};};
  const input={subscription:{endpoint:'https://web.push.apple.com/test-'+randomUUID(),keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}},mailboxIds:[boxId],name:'iPhone sintético',details:false};
  const device=await push.subscribe(actor,{sid:s.id,sv:users.superadmin.sessionVersion},input);
  const read=()=>db.mailboxPushDevice.findUniqueOrThrow({where:{id:device.id}});
  const prefs=async(extra={})=>{const d=await read();return push.preferences(actor,device.id,{revision:d.preferenceRevision,name:d.name,mailEnabled:d.mailEnabled,mailboxIds:d.mailboxIds,details:d.details,paidOrders:!!d.paidOrdersSince,visits:!!d.visitsSince,waitlist:!!d.waitlistSince,...extra});};
  assert.equal((await read()).paidOrdersSince,null);assert.equal((await read()).visitsSince,null);assert.equal((await read()).waitlistSince,null);assert.equal((await read()).mailEnabled,true);
  const makeOrder=async(data={})=>{
    const row=await db.order.create({data:{subtotal:'79.95',taxRate:'0',taxAmount:'0',total:'79.95',customerEmail:'private-customer@example.test',...data}});
    // Avoid sub-millisecond differences between PostgreSQL and the test's JS
    // clock when invoking a worker immediately (production polls every 5s).
    await db.mailboxPushDelivery.updateMany({where:{eventId:'paidOrders:'+row.id},data:{readyAt:new Date(0)}});
    return row;
  };
  const old=await makeOrder({status:'PAID',paidAt:new Date(Date.now()-60000)});
  assert.equal(await db.mailboxPushDelivery.count({where:{deviceId:device.id}}),0);
  await prefs({paidOrders:true,visits:true,waitlist:true});
  assert((await push.devices(actor)).find(d=>d.id===device.id).visitsSince);
  const revision=(await read()).preferenceRevision;
  await assert.rejects(()=>push.preferences(actor,device.id,{revision:revision-1,name:'stale',mailEnabled:true,paidOrders:true,visits:true,waitlist:true,details:false,mailboxIds:[boxId]}),/CHANGED/);
  await assert.rejects(()=>push.preferences({id:users.writer.id,role:'ADMIN'},device.id,{revision,name:'alien',mailEnabled:true,paidOrders:false,visits:true,waitlist:true,details:false,mailboxIds:[]}),/NOT_FOUND/);
  await push.subscribe(actor,{sid:s.id,sv:users.superadmin.sessionVersion},{...input,name:'must not replace',mailboxIds:[],details:true});
  assert.equal((await read()).name,'iPhone sintético');assert.deepEqual((await read()).mailboxIds,[boxId]);assert((await read()).paidOrdersSince);assert.equal((await read()).details,false);
  pass('Push migration defaults, existing registration/preferences retained, remote persistence, conflict and device ownership');

  const order=await makeOrder();assert.equal(await db.mailboxPushEvent.count({where:{id:'paidOrders:'+order.id}}),0);
  await db.order.update({where:{id:order.id},data:{status:'PAID',paidAt:new Date()}});
  await db.order.update({where:{id:order.id},data:{status:'PAID'}});
  assert.equal(await db.mailboxPushDelivery.count({where:{eventId:'paidOrders:'+order.id,deviceId:device.id}}),1);
  await Promise.all([events.deliver(device.id),events.deliver(device.id)]);assert.equal(pushed.length,1);assert(pushed[0].body.includes('79,95'));assert(pushed[0].url.includes('order='+order.id));assert(!JSON.stringify(pushed).includes('private-customer'));
  await events.deliver(device.id);assert.equal(pushed.length,1);
  const refunded=await makeOrder({status:'PAID',paidAt:new Date()});await db.order.update({where:{id:refunded.id},data:{status:'REFUNDED'}});
  await events.deliver(device.id);assert.equal(pushed.length,1);
  const historic=await makeOrder({status:'PAID',paidAt:new Date(Date.now()-86400000)});
  assert.equal(await db.mailboxPushDelivery.count({where:{eventId:'paidOrders:'+historic.id,deviceId:device.id}}),0);
  pass('Paid transition only, webhook/reconciliation duplicates, concurrency, historical/refunded exclusion and anonymous payload');

  const consent=JSON.stringify({version:'2',analytics:true}),res={cookie(name,value){this[name]=value;},setHeader(){},clearCookie(){}};
  const visitor=async(user)=>{const req={cookies:{cronox_cookie_consent:consent},user};await history.session(req,res);req.cookies.cronox_daily_visitor=res.cronox_daily_visitor;return req;};
  const req=await visitor();await history.record(req,'/');await history.record(req,'/');
  const visits=await db.mailboxPushEvent.count({where:{kind:'visits'}});assert.equal(visits,1);
  await history.bridge(req,{id:users.customer.id,role:'USER'});req.user={id:users.customer.id,role:'USER'};await history.record(req,'/');
  assert.equal(await db.mailboxPushEvent.count({where:{kind:'visits'}}),1);
  await events.deliver(device.id);assert.equal(pushed.length,2);assert.equal(pushed.at(-1).body,'Nueva visita a CRONOX');
  const adminReq=await visitor({id:users.superadmin.id,role:'SUPERADMIN'});await history.record(adminReq,'/');assert.equal(await db.mailboxPushEvent.count({where:{kind:'visits'}}),1);
  await assert.rejects(()=>history.record(req,'/admin.html'),/PUBLIC_PAGE_REQUIRED/);
  const without={cookies:{},user:{id:users.friend.id,role:'FRIEND'}};await history.record(without,'/');assert.equal(await db.mailboxPushEvent.count({where:{kind:'visits'}}),1);
  const second=await visitor();await history.record(second,'/');await events.deliver(device.id);assert.equal(pushed.length,3);assert.notEqual(pushed[1].tag,pushed[2].tag);
  const bot=await visitor();bot.get=()=> 'Googlebot/2.1';await history.record(bot,'/');assert.equal(await db.mailboxPushEvent.count({where:{kind:'visits'}}),2);
  pass('One push per valid visitor-day, reload/login dedup, consent/admin/panel exclusions and distinct notification tags');

  const product=await db.product.create({data:{slug:'push-fixture',name:'Camiseta sintética',price:7995}});
  const variant=await db.productVariant.create({data:{productId:product.id,size:'M',sku:'push-fixture-M',stockQty:0}});
  const joined=await waitlist.join(users.customer.id,variant.id);assert.equal(joined.existing,false);
  assert.equal((await waitlist.join(users.customer.id,variant.id)).existing,true);
  assert.equal(await db.mailboxPushEvent.count({where:{kind:'waitlist'}}),1);
  await events.deliver(device.id);assert.equal(pushed.length,4);assert(pushed.at(-1).body.includes('Camiseta sintética · Talla M'));
  await waitlist.cancel(users.customer.id,variant.id);assert.equal(await db.mailboxPushEvent.count({where:{kind:'waitlist'}}),1);
  await assert.rejects(()=>waitlist.join(users.customer.id,-1));assert.equal(await db.mailboxPushEvent.count({where:{kind:'waitlist'}}),1);
  pass('Waitlist actual join transaction, active uniqueness, no cancel/failure notices and product/size without customer details');

  const pending=await makeOrder({status:'PAID',paidAt:new Date()});await prefs({paidOrders:false});await events.deliver(device.id);assert.equal(pushed.length,4);
  assert.equal((await db.mailboxPushDelivery.findUniqueOrThrow({where:{eventId_deviceId:{eventId:'paidOrders:'+pending.id,deviceId:device.id}}})).status,'SKIPPED');
  await makeOrder({status:'PAID',paidAt:new Date()});await prefs({paidOrders:true});await events.deliver(device.id);assert.equal(pushed.length,4);
  const during=await makeOrder({status:'PAID',paidAt:new Date()});
  security.resolvePublic=async()=>{await prefs({paidOrders:false});return{address:'8.8.8.8',family:4};};await events.deliver(device.id);assert.equal(pushed.length,4);security.resolvePublic=async()=>({address:'8.8.8.8',family:4});
  await prefs({paidOrders:true});
  const temp=await makeOrder({status:'PAID',paidAt:new Date()});webpush.sendNotification=async()=>{throw Object.assign(Error('rejected'),{statusCode:503});};await events.deliver(device.id);
  const tempKey={eventId_deviceId:{eventId:'paidOrders:'+temp.id,deviceId:device.id}};
  assert.equal((await db.mailboxPushDelivery.findUniqueOrThrow({where:tempKey})).status,'PENDING');
  await db.mailboxPushDelivery.update({where:tempKey,data:{readyAt:new Date(0)}});webpush.sendNotification=async(_s,p)=>{pushed.push(JSON.parse(p));return{statusCode:201};};await events.deliver(device.id);assert.equal(pushed.length,5);
  const unknown=await makeOrder({status:'PAID',paidAt:new Date()});webpush.sendNotification=async()=>{throw Error('socket closed');};await events.deliver(device.id);
  assert.equal((await db.mailboxPushDelivery.findUniqueOrThrow({where:{eventId_deviceId:{eventId:'paidOrders:'+unknown.id,deviceId:device.id}}})).status,'UNKNOWN');
  await events.deliver(device.id);assert.equal(pushed.length,5);
  const restart=await makeOrder({status:'PAID',paidAt:new Date()});await db.mailboxPushDelivery.update({where:{eventId_deviceId:{eventId:'paidOrders:'+restart.id,deviceId:device.id}},data:{status:'PROCESSING',startedAt:new Date(0)}});await events.deliver(device.id);
  assert.equal((await db.mailboxPushDelivery.findUniqueOrThrow({where:{eventId_deviceId:{eventId:'paidOrders:'+restart.id,deviceId:device.id}}})).status,'UNKNOWN');
  pass('Pending preference revocation, no enable replay, last-moment DNS revocation, explicit retry, restart uncertainty without replay');

  const mailReq=await db.mailboxMessage.findFirst({where:{mailboxId:boxId,alive:true}});await db.mailboxNotice.upsert({where:{messageId:mailReq.id},create:{messageId:mailReq.id,mailboxId:boxId},update:{createdAt:new Date()}});
  await db.mailboxPushDevice.update({where:{id:device.id},data:{cursorAt:new Date(0),mailEnabled:false}});webpush.sendNotification=async(_s,p)=>{pushed.push(JSON.parse(p));return{statusCode:201};};await push.deliver(device.id);assert.equal(pushed.length,5);
  await prefs({mailEnabled:true});await db.mailboxPushDevice.update({where:{id:device.id},data:{cursorAt:new Date(0)}});await push.deliver(device.id);assert.equal(pushed.length,6);assert.equal(pushed.at(-1).tag,'cronox-mail');
  await prefs({paidOrders:false,visits:false,waitlist:false});
  const row=await read();assert.equal(row.mailEnabled,true);assert.deepEqual(row.mailboxIds,[boxId]);
  pass('Mail master checkbox suppression and existing mailbox push payload/privacy retained; business defaults restored for browser');
  // Queue storage failures are deliberately isolated from business transactions.
  await db.$executeRawUnsafe('ALTER TABLE "MailboxPushDelivery" ADD CONSTRAINT review_push_failure CHECK (false) NOT VALID');
  await prefs({paidOrders:true,visits:true,waitlist:true});const beforeFailure=await makeOrder({status:'PAID',paidAt:new Date()});assert.equal((await db.order.findUniqueOrThrow({where:{id:beforeFailure.id}})).status,'PAID');
  const failingVisit=await visitor();assert.equal((await history.record(failingVisit,'/')).accepted,true);
  const joinedFailure=await waitlist.join(users.friend.id,variant.id);assert.equal(joinedFailure.existing,false);assert.equal((await db.restockRequest.findUniqueOrThrow({where:{id:joinedFailure.subscription.id}})).status,'WAITING');
  await db.$executeRawUnsafe('ALTER TABLE "MailboxPushDelivery" DROP CONSTRAINT review_push_failure');await prefs({paidOrders:false,visits:false,waitlist:false});
  pass('Outbox storage failure cannot roll back paid orders, visits or waitlist writes');
  await prefs({paidOrders:true});
  const manual=await makeOrder({source:'IN_PERSON_ADMIN',status:'PAID',purchasedAt:new Date()});await events.deliver(device.id);assert.equal(pushed.length,7);assert(pushed.at(-1).body.includes('#'+manual.id));
  const backdated=await makeOrder({source:'IN_PERSON_ADMIN',status:'PAID',purchasedAt:new Date(Date.now()-86400000)});assert.equal(await db.mailboxPushDelivery.count({where:{eventId:'paidOrders:'+backdated.id,deviceId:device.id}}),0);
  await prefs({paidOrders:false});
  pass('Confirmed in-person paid sales included; backdated records excluded without changing business totals');
};
