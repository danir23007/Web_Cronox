/* Called only by review-mailbox.cjs, with its ephemeral loopback database/app.
 * Never starts a backend with .env, connects a provider or uses real addresses.
 */
'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),path=require('node:path');
module.exports=async function review({app,db,backend,request,boxId,users,provider,smtpMessages,pass}) {
  assert(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
  const {MailboxCampaignService}=require(path.join(backend,'dist/mailbox/mailbox-campaign.service'));
  const {MailboxService}=require(path.join(backend,'dist/mailbox/mailbox.service'));
  const service=app.get(MailboxService),campaigns=app.get(MailboxCampaignService),actor={id:users.superadmin.id,role:'SUPERADMIN'};
  const address=(await db.mailbox.findUniqueOrThrow({where:{id:boxId}})).address;
  process.env.SMTP_SUPPORT_USER=address;
  const profile=await db.emailSenderProfile.upsert({where:{key:'SUPPORT'},create:{key:'SUPPORT'},update:{}});
  const folder=await db.emailTemplateFolder.create({data:{senderKey:profile.key,name:'Campaign fixture'}});
  const t=await db.managedEmailTemplate.create({data:{senderKey:'SUPPORT',folderId:folder.id,name:'Static fixture',subject:'Fixture subject',document:{blocks:[{type:'text',text:'Synthetic message'},{type:'image',src:'https://example.test/image.png',alt:'Synthetic image'}]},html:'',text:''}});
  await db.managedEmailTemplate.create({data:{senderKey:'SUPPORT',folderId:folder.id,name:'Variables fixture',subject:'{{subject}}',document:{blocks:[{type:'text',text:'{{message}}'}]},html:'',text:''}});
  const list=await campaigns.templateList(actor,boxId);assert(list.some(x=>x.id===t.id));
  const rendered=await campaigns.template(actor,boxId,t.id);assert(rendered.html.includes('https://example.test/image.png'));assert(rendered.text.includes('Synthetic message'));
  const variable=list.find(x=>x.name==='Variables fixture');
  assert((await campaigns.template(actor,boxId,variable.id)).variables.includes('message'));
  await assert.rejects(()=>campaigns.template(actor,boxId,variable.id,{subject:'Only subject'}),/UNRESOLVED/);
  assert.equal((await campaigns.template(actor,boxId,variable.id,{subject:'Resolved',message:'Complete'})).subject,'Resolved');
  await assert.rejects(()=>campaigns.template(actor,boxId,'nonexistent'),/NOT_AVAILABLE/);
  await assert.rejects(()=>campaigns.templateList({id:users.reader.id,role:'ADMIN'},boxId),/ACCESS_DENIED/);
  pass('Existing sender-bound template catalog, HTML/image/text rendering, unresolved variables and send grants');

  const makeUser=async(email,circle,subscribed=true,state='ACTIVE')=>db.user.create({data:{email,role:'USER',circleLevel:circle,newsletterSubscribed:subscribed,accountState:state}});
  const u1=await makeUser('campaign-one@example.test',1),u2=await makeUser('campaign-two@example.test',2);
  await makeUser('not-subscribed@example.test',1,false);await makeUser('inactive@example.test',1,true,'PENDING_PASSWORD');
  await makeUser('invalid-address',1);await makeUser('suppressed@example.test',2);
  await db.mailboxSuppression.create({data:{email:'suppressed@example.test',reason:'UNSUBSCRIBED'}});
  assert.deepEqual(await campaigns.recipients([1,2,1]),[u1.email,u2.email]);
  pass('Server circle membership, duplicate selections, active opt-in, invalid addresses and suppression exclusions');
  const create=async()=>{
    const d=await service.createDraft(actor,{mailboxId:boxId,mode:'circles'});
    return service.saveDraft(actor,d.id,{to:'',cc:'',bcc:'',subject:'Synthetic campaign',text:'Synthetic body',html:'<p>Synthetic body</p>',circles:[1,2],revision:d.revision,templateId:t.id});
  };
  let d=await create();
  await assert.rejects(()=>service.saveDraft(actor,d.id,{...d,to:'customer@example.test',revision:d.revision}),/BCC_ONLY/);
  await assert.rejects(()=>service.enqueue(actor,d.id,{revision:d.revision,requestKey:randomUUID()},{}),/CAMPAIGN_CONFIRMATION/);
  let summary=await campaigns.summary(actor,d.id);assert.equal(summary.count,2);assert(!JSON.stringify(summary).includes(u1.email));
  await assert.rejects(()=>campaigns.enqueue(actor,d.id,{revision:d.revision,requestKey:randomUUID(),previewHash:summary.previewHash}),/PROVIDER_NOT_READY/);
  Object.assign(process.env,{MAILBOX_CAMPAIGN_ENABLED:'true',MAILBOX_CAMPAIGN_PROVIDER_VERIFIED:'true',MAILBOX_CAMPAIGN_DAILY_LIMIT:'1000',MAILBOX_CAMPAIGN_HOURLY_LIMIT:'20',MAILBOX_CAMPAIGN_TRANSACTIONAL_RESERVE:'100',API_PUBLIC_URL:'https://example.test'});
  const enqueue=async(d,extra={})=>campaigns.enqueue(actor,d.id,{revision:d.revision,requestKey:randomUUID(),previewHash:(await campaigns.summary(actor,d.id)).previewHash,...extra});
  await assert.rejects(()=>enqueue(d,{localDate:'2020-01-01T12:00'}),/PAST/);
  await assert.rejects(()=>enqueue(d,{previewHash:'wrong'}),/PREVIEW_CHANGED/);
  const leaking=await create();
  const leaked=await service.saveDraft(actor,leaking.id,{...leaking,text:u1.email});
  await assert.rejects(()=>enqueue(leaked),/CUSTOMER_ADDRESSES_IN_CONTENT/);
  const attachmentDraft=await create();
  await service.upload(actor,attachmentDraft.id,require('node:stream').Readable.from('Recipients: '+u2.email),'recipients.csv','text/csv');
  const attachmentCurrent=service.draftView(await service.access.draft(actor,attachmentDraft.id));
  await assert.rejects(()=>enqueue(attachmentCurrent),/CUSTOMER_ADDRESSES_IN_CONTENT/);
  await assert.rejects(()=>campaigns.suppress({id:users.writer.id,role:'ADMIN'},u1.email,'UNSUBSCRIBED'),/SUPERADMIN_REQUIRED/);
  pass('Customer addresses blocked in shared body and recipient-list attachment; suppression maintenance requires SUPERADMIN');
  const requestKey=randomUUID(),input={revision:d.revision,requestKey,previewHash:summary.previewHash};
  const c=await campaigns.enqueue(actor,d.id,input);
  assert.equal((await campaigns.enqueue(actor,d.id,input)).id,c.id);
  assert.equal(await db.mailboxCampaign.count({where:{draftId:d.id}}),1);
  await assert.rejects(()=>campaigns.view({id:users.writer.id,role:'ADMIN'},c.id),/OWNER_REQUIRED/);
  await assert.rejects(()=>service.upload(actor,d.id,require('node:stream').Readable.from('late'),'late.txt','text/plain'),/QUEUED/);
  pass('CCO enforced on server, summaries omit recipient addresses, provider gate, stale previews and idempotent confirmation');

  const before=smtpMessages.length;
  await Promise.all([campaigns.tick(),campaigns.tick()]);
  assert.equal(smtpMessages.length,before+1);
  const raw=smtpMessages.at(-1).toString();
  assert(!/^To:|^Cc:|^Bcc:/im.test(raw),'raw MIME has no recipient header');
  assert(!raw.includes(u1.email)&&!raw.includes(u2.email),'no recipient address in MIME body, headers or unsubscribe URL');
  assert(raw.includes('List-Unsubscribe:'));assert(raw.includes('Synthetic body'));
  await campaigns.tick();assert.equal(smtpMessages.length,before+1,'persistent rate clock fences next worker');
  const pending=await db.mailboxCampaignDelivery.findFirstOrThrow({where:{campaignId:c.id,status:'PENDING'}});
  await db.user.updateMany({where:{email:pending.email},data:{newsletterSubscribed:false}});
  await db.mailboxCampaignClock.updateMany({data:{nextAt:new Date(0)}});
  await campaigns.tick();assert.equal(smtpMessages.length,before+1);
  const final=await campaigns.view(actor,c.id);assert.equal(final.status,'COMPLETED');assert(final.progress.some(g=>g.status==='EXCLUDED'));
  pass('Concurrent workers send once, raw MIME BCC privacy, persistent throttling, snapshot recipients and live opt-out exclusion');

  await db.user.updateMany({where:{id:{in:[u1.id,u2.id]}},data:{newsletterSubscribed:true}});
  d=await create();let scheduled=await enqueue(d,{localDate:'2030-07-01T12:00'});
  assert.equal(new Date(scheduled.scheduledAt).toISOString(),'2030-07-01T10:00:00.000Z');
  await campaigns.tick();assert.equal(smtpMessages.length,before+1,'future job cannot run');
  await campaigns.cancel(actor,scheduled.id,true);
  d=await service.draftView(await service.access.draft(actor,d.id));assert.equal(d.status,'DRAFT');
  d=await service.saveDraft(actor,d.id,{...d,subject:'Edited content',circles:[1]});
  scheduled=await enqueue(d,{localDate:'2030-12-01T12:00'});
  assert.equal(new Date(scheduled.scheduledAt).toISOString(),'2030-12-01T11:00:00.000Z');
  await campaigns.cancel(actor,scheduled.id);assert.equal((await campaigns.view(actor,scheduled.id)).status,'CANCELLED');
  pass('Durable future schedule, Madrid DST, edit/reconfirm revision and cancellation of pending deliveries');

  d=await create();scheduled=await enqueue(d);
  const delivery=await db.mailboxCampaignDelivery.findFirstOrThrow({where:{campaignId:scheduled.id}});
  await db.mailboxCampaign.update({where:{id:scheduled.id},data:{status:'PROCESSING',startedAt:new Date(0)}});
  await db.mailboxCampaignDelivery.update({where:{id:delivery.id},data:{status:'PROCESSING',startedAt:new Date(0)}});
  await campaigns.recover();assert.equal((await db.mailboxCampaignDelivery.findUniqueOrThrow({where:{id:delivery.id}})).status,'UNKNOWN');
  await assert.rejects(()=>campaigns.cancel(actor,scheduled.id,true),/ALREADY_STARTED/);
  await campaigns.cancel(actor,scheduled.id);await campaigns.tick();assert.equal(smtpMessages.length,before+1);
  pass('Restart recovery marks uncertainty without requeue; running cancellation preserves unknown and stops pending recipients');

  const originalSmtp=provider.smtp;
  const unlock=async()=>{await db.mailboxCampaignClock.updateMany({data:{nextAt:new Date(0)}});await db.mailboxCampaignDelivery.updateMany({where:{status:'PENDING'},data:{readyAt:new Date(0)}});};
  try {
    d=await create();const limited=await enqueue(d);
    process.env.MAILBOX_CAMPAIGN_DAILY_LIMIT='101';await unlock();await campaigns.tick();
    assert.equal((await db.mailboxCampaignDelivery.findFirstOrThrow({where:{campaignId:limited.id}})).attempts,0,'existing manual/transactional usage reserves capacity');
    assert.equal((await campaigns.view(actor,limited.id)).status,'SCHEDULED','quota wait does not start or lock editable schedule');
    await campaigns.cancel(actor,limited.id);process.env.MAILBOX_CAMPAIGN_DAILY_LIMIT='1000';
    d=await create();const transient=await enqueue(d);
    provider.smtp=async()=>({sendMail:async()=>{throw Object.assign(Error('fixture temporary'),{responseCode:451});},close(){}});
    await unlock();await campaigns.tick();let job=await db.mailboxCampaignDelivery.findFirstOrThrow({where:{campaignId:transient.id,attempts:1}});
    assert.equal(job.status,'PENDING');assert(job.readyAt>new Date());
    await campaigns.cancel(actor,transient.id);
    d=await create();const permanent=await enqueue(d);
    provider.smtp=async()=>({sendMail:async()=>{throw Object.assign(Error('fixture permanent'),{responseCode:550});},close(){}});
    await unlock();await campaigns.tick();job=await db.mailboxCampaignDelivery.findFirstOrThrow({where:{campaignId:permanent.id,attempts:1}});assert.equal(job.status,'FAILED');
    await campaigns.cancel(actor,permanent.id);
    d=await create();const unknown=await enqueue(d);
    provider.smtp=async()=>({sendMail:async()=>{throw Object.assign(Error('fixture socket after DATA'),{code:'ECONNRESET'});},close(){}});
    await unlock();await campaigns.tick();job=await db.mailboxCampaignDelivery.findFirstOrThrow({where:{campaignId:unknown.id,attempts:1}});assert.equal(job.status,'UNKNOWN');
    await campaigns.cancel(actor,unknown.id);
    pass('Transactional quota reserve, editable waiting schedule, bounded temporary backoff, permanent failure and no uncertain retries');
  }finally{provider.smtp=originalSmtp;process.env.MAILBOX_CAMPAIGN_DAILY_LIMIT='1000';}

  const token=campaigns.unsubscribeToken(u1.email);assert(!token.includes(u1.email));
  const landing=await fetch('http://127.0.0.1:43121/api/mailbox-unsubscribe/'+token);assert.equal(landing.status,200);assert((await landing.text()).includes('Confirmar baja'));
  assert.equal((await db.user.findUniqueOrThrow({where:{id:u1.id}})).newsletterSubscribed,true,'GET scanners do not unsubscribe');
  await campaigns.unsubscribe(token);assert.equal(await campaigns.eligible(u1.email),false);
  await db.user.update({where:{id:u1.id},data:{newsletterSubscribed:true}});assert.equal(await campaigns.eligible(u1.email),false,'suppression cannot be undone by implicit newsletter resubscription');
  await assert.rejects(()=>campaigns.unsubscribe('tampered'),/INVALID_UNSUBSCRIBE/);
  pass('Opaque authenticated unsubscribe token, current preference update, persistent suppression and tamper rejection');

  for(const table of ['MailboxCampaign','MailboxCampaignDelivery','MailboxCampaignClock','MailboxSuppression']) {
    const [row]=await db.$queryRawUnsafe('SELECT relrowsecurity,has_table_privilege(\'anon\',oid,\'SELECT\') AS exposed FROM pg_class WHERE relname=$1',table);assert(row.relrowsecurity);assert(!row.exposed);
  }
  const folders=await db.mailboxFolder.findMany({where:{mailboxId:boxId},take:2});
  const filtered=await request('/messages?folderIds='+folders.map(f=>f.id).join(','));assert.equal(filtered.status,200);assert(filtered.body.messages.every(m=>folders.some(f=>f.id===m.folderId)));
  assert.equal((await request('/messages?folderIds=')).body.pagination.total,0);
  assert.equal((await request('/messages?folderIds='+randomUUID())).status,400);
  pass('Private campaign RLS and multi-folder backend union, empty selection and inaccessible folder rejection');
  // Preserve only the synthetic sender mapping for the optional browser fixture.
  process.env.MAILBOX_CAMPAIGN_ENABLED='false';
};
