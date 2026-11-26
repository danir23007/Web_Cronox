'use strict';
// Disposable PostgreSQL and isolated test controllers. No production DB, SMTP or workers.
const assert = require('node:assert/strict'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process'), { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const name = 'cronox_manual_campaign_test_' + randomUUID().replace(/-/g, ''), backend = path.resolve(__dirname, '..');
(async () => {
  const env = loadLocalEnvironment(), source = new URL(env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
  const control = new Client({ connectionString: source.href });
  let created = false, db, app;
  const checks = [];
  try {
    await control.connect();
    assert.ok(['127.0.0.1', '::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + name; target.search = '';
    const sql = new Client({ connectionString: target.href }); await sql.connect(); await sql.query('CREATE EXTENSION IF NOT EXISTS pg_trgm'); await sql.end();
    const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], { cwd: backend, env: { ...env, DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href }, windowsHide: true, encoding: 'utf8' });
    assert.equal(push.status, 0, 'Disposable schema setup failed');
    const { PrismaClient } = require('@prisma/client'); db = new PrismaClient({ datasources: { db: { url: target.href } } });
    Object.assign(process.env, {EMAIL_ENABLED:'false',MAILBOX_CAMPAIGN_ENABLED:'true',MAILBOX_CAMPAIGN_PROVIDER_VERIFIED:'true',MAILBOX_CAMPAIGN_DAILY_LIMIT:'1000',MAILBOX_CAMPAIGN_HOURLY_LIMIT:'1000',MAILBOX_CAMPAIGN_INTERVAL_SECONDS:'30',MAILBOX_SEND_ENABLED:'true',MAILBOX_WORKER_ENABLED:'true',API_PUBLIC_URL:'https://example.test',FRONTEND_URL:'https://example.test'});
    const { ManagedMailService }=require('../dist/email/managed/managed-mail.service');
    const { ManagedMailController }=require('../dist/email/managed/managed-mail.controller');
    const { MailboxCampaignService }=require('../dist/mailbox/mailbox-campaign.service');
    const { MailboxController }=require('../dist/mailbox/mailbox.controller');
    const { MailboxAccessService }=require('../dist/mailbox/mailbox-access.service');
    const { campaignPublicationKey }=require('../dist/email/managed/campaign-publication');
    const { Test }=require('@nestjs/testing'),{ValidationPipe}=require('@nestjs/common');
    const { JwtAuthGuard }=require('../dist/auth/guards/jwt-auth.guard');
    const { PrismaService }=require('../dist/prisma/prisma.service');
    const { SupabaseStorageService }=require('../dist/common/storage/supabase-storage.service');
    const { MailboxService }=require('../dist/mailbox/mailbox.service');
    const { MailboxReaderService }=require('../dist/mailbox/mailbox-reader.service');
    const { MailboxPushService }=require('../dist/mailbox/mailbox-push.service');
    const { AuthSessionsService }=require('../dist/auth/auth-sessions.service');
    const request=require('supertest');
    await db.emailSenderProfile.create({data:{key:'INFO'}});
    const family=await db.campaignTemplateFamily.create({data:{id:'fixture-family',name:'Manual Black Friday fixture',eventKind:'GENERAL'}});
    const templates=[];
    const content=t=>({subject:t.subject,preheader:t.preheader,document:t.document,html:t.html,text:t.text,textOverride:t.textOverride,signatureMode:t.signatureMode});
    for(let circle=1;circle<=5;circle++){
      const folder=await db.emailTemplateFolder.create({data:{senderKey:'INFO',name:'C\u00edrculo '+circle,position:circle}});
      const document={blocks:[{type:'text',text:'Black Friday circle '+circle,color:'#000000'},{type:'image',src:'https://example.test/original-counter.png',alt:'Black Friday 00 : 00 : 00 : 00',href:'https://example.test/',width:640,padding:0},{type:'button',text:'DISCOVER',href:'https://example.test/'}]};
      templates.push(await db.managedEmailTemplate.create({data:{senderKey:'INFO',folderId:folder.id,familyId:family.id,campaignCircle:circle,purpose:null,name:'Fixture circle '+circle,subject:'Published circle '+circle,preheader:'Preserve preheader '+circle,document,html:'Stored HTML '+circle,text:'Stored text '+circle,signatureMode:'none'}}));
    }
    await db.user.createMany({data:Array.from({length:100},(_,i)=>({email:'fixture'+i+'@example.test',name:'Persona '+i,role:i===0?'SUPERADMIN':i===1?'ADMIN':'USER',newsletterSubscribed:true,circleLevel:i===0?5:i<10?2:1}))});
    const actor=await db.user.findFirstOrThrow({where:{role:'SUPERADMIN'}}),admin=await db.user.findFirstOrThrow({where:{role:'ADMIN'}});
    const box=await db.mailbox.create({data:{name:'Info',address:'info@cronox.es',fromName:'CRONOX',provider:'fixture',imapHost:'127.0.0.1',smtpHost:'127.0.0.1',username:'fixture',active:true}});
    let draft=await db.mailboxDraft.create({data:{id:'campaign-draft:INFO:BLACK_FRIDAY_NUMBERS_2026',mailboxId:box.id,userId:actor.id,mode:'campaign',familyId:family.id,circles:[1,2,3,4,5]}});
    const transport=new Proxy({},{get(){throw Error('SMTP_FORBIDDEN');}}),managed=new ManagedMailService(db,transport),access=new MailboxAccessService(db);
    const campaigns=new MailboxCampaignService(db,access,managed,transport,transport,transport);
    const module=await Test.createTestingModule({controllers:[ManagedMailController,MailboxController],providers:[
      {provide:ManagedMailService,useValue:managed},{provide:PrismaService,useValue:db},{provide:SupabaseStorageService,useValue:{}},
      {provide:MailboxCampaignService,useValue:campaigns},{provide:MailboxAccessService,useValue:access},{provide:MailboxService,useValue:{draftView:async d=>d}},
      {provide:MailboxReaderService,useValue:{}},{provide:MailboxPushService,useValue:{}},{provide:AuthSessionsService,useValue:{}}
    ]}).overrideGuard(JwtAuthGuard).useValue({canActivate(ctx){const req=ctx.switchToHttp().getRequest();req.user={id:Number(req.headers['x-fixture-id']||actor.id),role:req.headers['x-fixture-role']||'SUPERADMIN'};return true;}}).compile();
    app=module.createNestApplication({logger:false});app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.init();
    const api=request(app.getHttpServer()),actionPath=(t,key='INFO')=>'/api/admin/mail-templates/'+key+'/templates/'+t.id+'/actions';
    assert.equal((await campaigns.summary(actor,draft.id)).blocked.length,5);
    await api.post(actionPath(templates[0])).send({action:'publish',revision:1,confirmed:false}).expect(400);
    await api.post(actionPath(templates[0])).set('x-fixture-role','ADMIN').send({action:'publish',revision:1,confirmed:false}).expect(400);
    await api.post(actionPath(templates[0])).set('x-fixture-role','USER').send({action:'publish',revision:1,confirmed:true}).expect(403);
    await api.post(actionPath(templates[0],'SUPPORT')).send({action:'publish',revision:1,confirmed:true}).expect(404);
    await db.managedEmailTemplate.update({where:{id:templates[0].id},data:{folderId:templates[1].folderId}});
    await api.post(actionPath(templates[0])).send({action:'publish',revision:1,confirmed:true}).expect(400);
    await db.managedEmailTemplate.update({where:{id:templates[0].id},data:{folderId:templates[0].folderId,archivedAt:new Date()}});
    await api.post(actionPath(templates[0])).send({action:'publish',revision:1,confirmed:true}).expect(400);
    await db.managedEmailTemplate.update({where:{id:templates[0].id},data:{archivedAt:null}});
    assert.equal(await db.emailTemplateVersion.count(),0);
    checks.push('real HTTP confirmation, role and sender validation; unpublished campaign blocked');
    const pointers=new Map();
    for(const t of templates){
      await api.post(actionPath(t)).send({action:'publish',revision:t.revision,confirmed:true}).expect(201);
      assert.deepEqual(content(await db.managedEmailTemplate.findUniqueOrThrow({where:{id:t.id}})),content(t));
      const pointer=await db.emailPublication.findUniqueOrThrow({where:{senderKey_purpose:{senderKey:'INFO',purpose:campaignPublicationKey(family.id,t.campaignCircle)}}});
      pointers.set(t.campaignCircle,pointer.versionId);
    }
    assert.equal(await db.emailPublication.count(),5);
    const otherFamily=await db.campaignTemplateFamily.create({data:{name:'Other fixture family',eventKind:'GENERAL'}});
    const other=await db.managedEmailTemplate.create({data:{...content(templates[0]),senderKey:'INFO',folderId:templates[0].folderId,familyId:otherFamily.id,campaignCircle:1,name:'Other family',purpose:null}});
    await api.post(actionPath(other)).send({action:'publish',revision:1,confirmed:true}).expect(201);
    const foreign=await db.emailPublication.findUniqueOrThrow({where:{senderKey_purpose:{senderKey:'INFO',purpose:campaignPublicationKey(otherFamily.id,1)}}});
    const fifthKey={senderKey_purpose:{senderKey:'INFO',purpose:campaignPublicationKey(family.id,5)}};
    await db.emailPublication.update({where:fifthKey,data:{versionId:foreign.versionId}});
    const invalidPlan=await campaigns.summary(actor,draft.id);
    assert.ok(invalidPlan.blocked.some(message=>message.includes('5')));
    const invalid=await api.post('/api/admin/mailbox/boxes/'+box.id+'/campaign').send({draftId:draft.id,revision:draft.revision,familyId:family.id,circles:[1,2,3,4,5],requestKey:randomUUID(),previewHash:invalidPlan.previewHash,localDate:'2099-11-27T21:00'}).expect(400);
    assert.equal(invalid.body.message,'MAILBOX_CAMPAIGN_BLOCKED');assert.ok(invalid.body.details.some(message=>message.includes('5')));
    assert.equal(await db.mailboxCampaign.count(),0);
    await db.emailPublication.update({where:fifthKey,data:{versionId:pointers.get(5)}});
    const empty=await db.managedEmailTemplate.create({data:{senderKey:'INFO',folderId:templates[1].folderId,familyId:otherFamily.id,campaignCircle:2,purpose:null,name:'Empty fixture',subject:'Empty',document:{blocks:[]},html:'',text:'',signatureMode:'none'}});
    await api.post(actionPath(empty)).send({action:'publish',revision:1,confirmed:true}).expect(400);
    await api.post(actionPath(templates[0])).send({action:'publish',revision:1,confirmed:true}).expect(409);
    assert.equal(await db.emailPublication.count(),6);
    checks.push('five independent publications, immutable contents, other family unchanged, stale revision refused');
    let second=await db.managedEmailTemplate.findUniqueOrThrow({where:{id:templates[1].id}});
    await api.post(actionPath(second)).send({action:'unpublish',revision:second.revision,confirmed:true}).expect(201);
    assert.ok((await campaigns.summary(actor,draft.id)).blocked.some(m=>m.includes('2')));
    for(const circle of [1,3,4,5])assert.equal((await db.emailPublication.findUniqueOrThrow({where:{senderKey_purpose:{senderKey:'INFO',purpose:campaignPublicationKey(family.id,circle)}}})).versionId,pointers.get(circle));
    second=await db.managedEmailTemplate.findUniqueOrThrow({where:{id:second.id}});
    await api.post(actionPath(second)).send({action:'publish',revision:second.revision,confirmed:true}).expect(201);
    assert.equal((await db.emailPublication.findUniqueOrThrow({where:{senderKey_purpose:{senderKey:'INFO',purpose:foreign.purpose}}})).versionId,foreign.versionId);
    assert.equal(await db.emailTemplateVersion.count({where:{templateId:second.id}}),2);
    await db.managedEmailTemplate.update({where:{id:templates[0].id},data:{subject:'UNPUBLISHED EDIT',revision:{increment:1}}});
    checks.push('unpublish/republish preserves other circles, other families and version history');
    const saved=await api.post('/api/admin/mailbox/boxes/'+box.id+'/campaign-draft').send({draftId:draft.id,revision:draft.revision,familyId:family.id,campaignName:'Manual fixture',circles:[1,2,3,4,5]}).expect(201);
    draft=saved.body;assert.equal(draft.id,'campaign-draft:INFO:BLACK_FRIDAY_NUMBERS_2026');
    const badId=await api.post('/api/admin/mailbox/boxes/'+box.id+'/campaign-draft').send({draftId:'../invalid',revision:draft.revision,familyId:family.id,circles:[1]}).expect(400);
    assert.equal(badId.body.message,'MAILBOX_INVALID_DRAFT_ID');
    await db.mailboxPermission.create({data:{mailboxId:box.id,userId:admin.id,access:'send'}});
    await api.post('/api/admin/mailbox/boxes/'+box.id+'/campaign-draft').set('x-fixture-role','ADMIN').set('x-fixture-id',String(admin.id)).send({draftId:draft.id,revision:draft.revision,familyId:family.id,circles:[1]}).expect(403);
    const plan=await campaigns.plan(await access.draft(actor,draft.id));
    assert.equal(plan.count,100);assert.deepEqual(plan.blocked,[]);assert.equal(plan.deliveries.length,100);
    assert.equal(plan.previews.find(p=>p.circle===1).subject,'Published circle 1');
    for(const delivery of plan.deliveries){const publication=await db.emailPublication.findUniqueOrThrow({where:{senderKey_purpose:{senderKey:'INFO',purpose:campaignPublicationKey(family.id,delivery.circleLevel)}}});assert.equal(delivery.content.publicationVersionId,publication.versionId);}
    const query=new URLSearchParams({familyId:family.id,circles:'1,2,3,4,5',revision:String(draft.revision)});
    const publicPlan=await api.get('/api/admin/mailbox/boxes/'+box.id+'/campaign-audience?'+query).expect(200);assert.equal(publicPlan.body.count,100);
    const bytes=await campaigns.exportAudience(actor,box.id,{familyId:family.id,circles:[1,2,3,4,5],revision:draft.revision});
    const book=new(require('exceljs').Workbook)();await book.xlsx.load(bytes);assert.equal(book.getWorksheet('Destinatarios').actualRowCount-1,100);
    checks.push('stable draft identifier accepted by HTTP; owner enforced; published snapshots selected instead of later edits; Excel agrees');
    const payload={draftId:draft.id,revision:draft.revision,familyId:family.id,circles:[1,2,3,4,5],requestKey:randomUUID(),previewHash:plan.previewHash,localDate:'2099-11-27T21:00'};
    const scheduled=await api.post('/api/admin/mailbox/boxes/'+box.id+'/campaign').send(payload).expect(201);
    const repeated=await Promise.all([api.post('/api/admin/mailbox/boxes/'+box.id+'/campaign').send(payload),api.post('/api/admin/mailbox/boxes/'+box.id+'/campaign').send(payload)]);
    assert.ok(repeated.every(r=>r.status===201&&r.body.id===scheduled.body.id));
    assert.equal(await db.mailboxCampaign.count(),1);assert.equal(await db.mailboxCampaignDelivery.count(),100);
    assert.equal(await db.mailboxSend.count(),0);assert.equal(await db.newsletterMailJob.count(),0);
    assert.ok((await db.mailboxCampaignDelivery.findMany()).every(d=>d.status==='PENDING'&&d.attempts===0));
    checks.push('future scheduling through real HTTP, retries without duplicates, zero SMTP calls and zero sends/jobs');
  } finally {
    if (app) await app.close();
    if (db) await db.$disconnect();
    if (created) { assert.match(name, /^cronox_manual_campaign_test_[a-f0-9]{32}$/); await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
    await control.end();
  }
  console.log(JSON.stringify({ passed: true, disposableDatabaseRemoved: true, checks }, null, 2));
})().catch(error => { console.error(error.code || error.name, String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
