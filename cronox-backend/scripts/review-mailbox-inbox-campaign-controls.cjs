// Runs only in review-mailbox.cjs's disposable PostgreSQL. Never uses .env/providers.
module.exports = async ({ app, db, backend, request, boxId, users, smtpMessages, pass }) => {
  const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
  const path = require('node:path'), ExcelJS = require('exceljs');
  const { MailboxService } = require(path.join(backend, 'dist/mailbox/mailbox.service'));
  const { MailboxCampaignService } = require(path.join(backend, 'dist/mailbox/mailbox-campaign.service'));
  const service = app.get(MailboxService), campaigns = app.get(MailboxCampaignService);
  const actor = { id: users.superadmin.id, role: 'SUPERADMIN' };
  const source = await db.mailbox.findUniqueOrThrow({ where: { id: boxId } });
  const box = await db.mailbox.create({ data: { ...source, id: randomUUID(), address: 'controls@example.test', username: 'controls@example.test', leaseToken: null, leaseUntil: null } });
  const folders = {};
  for (const [kind, pathName, specialUse] of [['inbox','INBOX','\\Inbox'], ['sent','Provider Outgoing','\\Sent'], ['draft','Provider Work','\\Drafts'], ['custom','Customers',null]]) {
    folders[kind] = await db.mailboxFolder.create({ data: { mailboxId: box.id, path: pathName, specialUse, uidValidity: '1' } });
  }
  const addMessage = (kind, uid, seen, flags = []) => db.mailboxMessage.create({ data: {
    mailboxId: box.id, folderId: folders[kind].id, uidValidity: '1', uid,
    subject: 'Control ' + uid, sender: uid % 2 ? 'sender@example.test' : box.address,
    recipients: 'target@example.test', envelope: {}, date: new Date(), size: 100, seen, flags,
  } });
  for (let uid = 1; uid <= 30; uid++) await addMessage('inbox', uid, uid % 2 === 0);
  await addMessage('inbox',31,false,['\\Draft']); await addMessage('inbox',32,false,['$Sent']);
  await addMessage('sent',1,true,['\\Seen']); await addMessage('draft',1,false,['\\Draft']); await addMessage('custom',1,false);
  const query = extra => service.messages(actor, { mailboxId: box.id, ...extra });
  assert.equal((await query({})).pagination.total,30);
  assert.equal((await query({ state:'read' })).pagination.total,15);
  assert.equal((await query({ state:'unread', page:2 })).messages.length,0);
  assert.equal((await query({ state:'unread', page:2 })).pagination.total,15);
  assert.equal((await query({ state:'all', search:'target@example.test' })).pagination.total,30);
  assert.equal((await query({ folderIds:folders.sent.id })).pagination.total,1);
  assert.equal((await query({ folderIds:[folders.custom.id,folders.sent.id].join(',') })).pagination.total,2);
  assert.equal((await query({ folderIds:folders.draft.id })).pagination.total,1);
  assert.equal((await query({ folderIds:'' })).pagination.total,0);
  await db.mailboxMessage.updateMany({ where:{mailboxId:box.id,folderId:folders.inbox.id},data:{seen:true} });
  assert.equal((await query({state:'unread'})).pagination.total,0);
  assert.equal((await query({state:'unread'})).messages.length,0);
  await assert.rejects(() => query({state:'false'}),/INVALID_INPUT/);
  pass('Received default excludes IMAP Sent/Drafts and flags; read/unread/all query and count agree before pagination, empty unread never falls back; custom/multiple folders and recipient search preserved');

  const info = await db.mailbox.findUniqueOrThrow({where:{address:'info@cronox.es'}});
  const folder = await db.emailTemplateFolder.findFirstOrThrow({where:{senderKey:'INFO'}});
  const family = await db.campaignTemplateFamily.create({data:{name:'Controls family',eventKind:'GENERAL'}});
  for (const circle of [4,5]) await db.managedEmailTemplate.create({data:{folderId:folder.id,senderKey:'INFO',familyId:family.id,campaignCircle:circle,name:'Controls version '+circle,subject:'Customer subject '+circle,document:{blocks:[{type:'text',text:'Synthetic controls content'}]},html:'',text:''}});
  const person = await db.user.create({data:{email:'controls-person@example.test',name:'=2+2',circleLevel:4,role:'USER',accountState:'ACTIVE',newsletterSubscribed:true}});
  await db.user.create({data:{email:'CONTROLS-PERSON@example.test',name:'=2+2',circleLevel:4,role:'USER',accountState:'ACTIVE',newsletterSubscribed:true}});
  await db.user.create({data:{email:'controls-optout@example.test',circleLevel:4,role:'USER',accountState:'ACTIVE',newsletterSubscribed:false}});
  const input = { familyId:family.id,circles:[4,5],revision:1,campaignName:'Internal controls name' };
  const beforeDrafts = await db.mailboxDraft.count(), beforeCampaigns = await db.mailboxCampaign.count(), beforeMessages = smtpMessages.length;
  const audience = await campaigns.audience(actor,info.id,input);
  const buffer = await campaigns.exportAudience(actor,info.id,input);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount-1,audience.count);
  const names = sheet.getColumn(1).values;
  assert(names.includes('=2+2')); assert.equal(sheet.getRow(names.indexOf('=2+2')).getCell(1).type,ExcelJS.ValueType.String);
  assert.equal(sheet.getColumn(2).values.filter(value=>value===person.email).length,1);
  assert(!sheet.getColumn(2).values.includes('controls-optout@example.test'));
  assert.equal(await db.mailboxDraft.count(),beforeDrafts); assert.equal(await db.mailboxCampaign.count(),beforeCampaigns);
  const http = await request('/boxes/'+info.id+'/campaign-audience?'+new URLSearchParams({familyId:family.id,circles:'4,5',revision:'1'}));
  assert.equal(http.status,200); assert.equal(http.body.count,audience.count);
  const httpExcel = await request('/boxes/'+info.id+'/campaign-recipients.xlsx?'+new URLSearchParams({familyId:family.id,circles:'4,5',revision:'1'}));
  assert.equal(httpExcel.status,200);
  const exported = new ExcelJS.Workbook(); await exported.xlsx.load(Buffer.from(httpExcel.body));
  assert.equal(exported.worksheets[0].rowCount-1,http.body.count);
  assert.equal(await db.mailboxDraft.count(),beforeDrafts);
  pass('Stateless count and XLSX use the same consent/suppression/dedup/circle resolver; XLSX row count matches, formula-looking names are string cells, no drafts or campaigns created');

  const incomplete = (await request('/boxes/'+info.id+'/campaign-draft','POST',{campaignName:'Incomplete saved explicitly',circles:[],revision:1}));
  assert.equal(incomplete.status,201); assert.equal(incomplete.body.campaignName,'Incomplete saved explicitly');
  assert.equal(incomplete.body.status,'DRAFT'); assert((await service.drafts(actor,'drafts')).some(d=>d.id===incomplete.body.id));
  await campaigns.saveSelection(actor,info.id,{draftId:incomplete.body.id,circles:[],revision:incomplete.body.revision});
  Object.assign(incomplete.body,(await request('/drafts/'+incomplete.body.id)).body);
  assert.equal(incomplete.body.campaignName,'Incomplete saved explicitly');
  Object.assign(process.env,{MAILBOX_CAMPAIGN_ENABLED:'true',MAILBOX_CAMPAIGN_PROVIDER_VERIFIED:'true',MAILBOX_WORKER_ENABLED:'true',MAILBOX_SEND_ENABLED:'true'});
  const badCount = await db.mailboxDraft.count();
  await assert.rejects(()=>campaigns.enqueue(actor,null,{...input,circles:[],selection:true,requestKey:randomUUID(),previewHash:audience.previewHash},info.id),/BLOCKED/);
  await assert.rejects(()=>campaigns.enqueue(actor,null,{...input,selection:true,requestKey:randomUUID(),previewHash:audience.previewHash,localDate:'2020-01-01T12:00'},info.id),/PAST/);
  assert.equal(await db.mailboxDraft.count(),badCount);
  const requestKey = randomUUID();
  const queued = await Promise.all([1,2].map(()=>campaigns.enqueue(actor,null,{...input,selection:true,requestKey,previewHash:audience.previewHash},info.id)));
  assert.equal(queued[0].id,queued[1].id); assert.equal(await db.mailboxDraft.count(),badCount+1);
  assert.equal(queued[0].campaignName,input.campaignName);
  assert(!(await service.drafts(actor,'drafts')).some(d=>d.id===queued[0].draftId));
  assert((await service.drafts(actor,'outbox')).some(d=>d.id===queued[0].draftId));
  const delivery = await db.mailboxCampaignDelivery.findFirstOrThrow({where:{campaignId:queued[0].id}});
  assert(!JSON.stringify(delivery.content).includes(input.campaignName));
  const scheduledInput = {...input,campaignName:'Scheduled existing draft',draftId:incomplete.body.id,revision:incomplete.body.revision};
  const scheduledAudience = await campaigns.audience(actor,info.id,scheduledInput);
  const localDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(Date.now()+86400000)).replace(' ','T');
  const scheduled = await request('/boxes/'+info.id+'/campaign','POST',{...scheduledInput,requestKey:randomUUID(),previewHash:scheduledAudience.previewHash,localDate});
  assert.equal(scheduled.status,201); assert.equal(scheduled.body.draftId,incomplete.body.id);
  assert.equal((await db.mailboxDraft.findUniqueOrThrow({where:{id:incomplete.body.id}})).campaignName,'Scheduled existing draft');
  assert(!(await service.drafts(actor,'drafts')).some(d=>d.id===incomplete.body.id));
  assert.equal((await service.drafts(actor,'outbox')).filter(d=>d.id===incomplete.body.id).length,1);
  await campaigns.cancel(actor,scheduled.body.id,true);
  assert((await service.drafts(actor,'drafts')).some(d=>d.id===incomplete.body.id));
  await db.user.updateMany({where:{email:{equals:person.email,mode:'insensitive'}},data:{newsletterSubscribed:false}});
  assert.equal(await campaigns.eligible(person.email,4),false);
  const changed = await campaigns.audience(actor,info.id,input);
  assert.equal(changed.count,audience.count-1);
  await campaigns.cancel(actor,queued[0].id);
  assert((await service.drafts(actor,'history')).some(d=>d.id===queued[0].draftId));
  assert.equal(smtpMessages.length,beforeMessages);
  process.env.MAILBOX_WORKER_ENABLED='false'; process.env.MAILBOX_SEND_ENABLED='false';
  pass('Explicit incomplete save, atomic confirmation, concurrent request dedup without orphan draft, internal name separate from MIME, draft-to-outbox without duplication, edit/cancel/history and post-export consent revalidation; no SMTP delivery');
};
