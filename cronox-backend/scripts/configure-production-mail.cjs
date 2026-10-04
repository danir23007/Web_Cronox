/* Explicit root operator only. No Nest, SMTP test, campaign launch, migration,
 * queue reclassification or permission expansion. Split review/clean/activate. */
'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'), {createRequire}=require('node:module');
const root='/var/www/cronox/Web_Cronox', backend=root+'/cronox-backend';
const backup='/root/cronox-backups/mail-Glyc9k';
const req=createRequire(backend+'/package.json');
const run=(cmd,args,env=process.env)=>execFileSync(cmd,args,{env,stdio:'pipe',maxBuffer:16*1024*1024});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,data)=>fs.writeFileSync(file,JSON.stringify(data,null,2),{mode:0o600,flag:'wx'});
const common={SMTP_INFO_DAILY_LIMIT:'1000',SMTP_NOREPLY_DAILY_LIMIT:'1000',SMTP_ORDERS_DAILY_LIMIT:'1000',SMTP_SUPPORT_DAILY_LIMIT:'1000',
 SMTP_INFO_HOURLY_LIMIT:'0',SMTP_NOREPLY_HOURLY_LIMIT:'0',SMTP_ORDERS_HOURLY_LIMIT:'0',SMTP_SUPPORT_HOURLY_LIMIT:'0',
 MAILBOX_MAX_RECIPIENTS:'100',MAILBOX_MAX_MESSAGE_BYTES:'35000000',MAILBOX_MAX_ATTACHMENT_BYTES:'25000000',
 MAILBOX_CAMPAIGN_DAILY_LIMIT:'1000',MAILBOX_CAMPAIGN_HOURLY_LIMIT:'0',MAILBOX_CAMPAIGN_INTERVAL_SECONDS:'30',
 MAILBOX_CAMPAIGN_PROVIDER_VERIFIED:'true',MAILBOX_CAMPAIGN_TRACKING_ENABLED:'true'};
function verifiedBackup(){
 if(fs.realpathSync(backup)!==backup || fs.statSync(backup).uid!==0 || (fs.statSync(backup).mode&0o077))throw Error('BACKUP_PATH_UNSAFE');
 const names=fs.readdirSync(backup).filter(n=>/^recovery-verified-\d+\.json$/.test(n));
 if(!names.some(n=>{const r=JSON.parse(fs.readFileSync(backup+'/'+n));return r.backup===backup&&r.hashesVerified&&r.applicationSchemaRestored&&r.mailboxCredentialsRecovered===4&&r.referencedPrivateFilesDecrypted===17&&!r.workersStarted;}))throw Error('BACKUP_NOT_VERIFIED');
 const manifest=JSON.parse(fs.readFileSync(backup+'/manifest.json'));
 for(const [name,expected]of Object.entries(manifest))if(path.basename(name)!==name||hash(backup+'/'+name)!==expected)throw Error('BACKUP_HASH_MISMATCH');
}
function effective(){
 const apps=JSON.parse(run('/usr/bin/pm2',['jlist']));const app=apps.find(a=>a.name==='cronox');
 if(!app||app.pm2_env.status!=='online'||!app.pid)throw Error('PM2_NOT_ONLINE');
 const cwd=fs.realpathSync(app.pm2_env.pm_cwd);
 if(![root,backend].includes(cwd)||fs.realpathSync(app.pm2_env.pm_exec_path)!==backend+'/dist/main.js')throw Error('UNEXPECTED_PM2_APP');
 const inherited=Object.fromEntries(fs.readFileSync('/proc/'+app.pid+'/environ','utf8').split('\0').filter(s=>s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
 const file=path.resolve(cwd,inherited.CRONOX_ENV_FILE||app.pm2_env.env?.CRONOX_ENV_FILE||'.env');
 const stat=fs.statSync(file);if(stat.mtimeMs>app.pm2_env.pm_uptime)throw Error('ENV_CHANGED_AFTER_START');
 const env={...req('dotenv').parse(fs.readFileSync(file)),...app.pm2_env.env,...inherited};
 return {app,env,file,stat};
}
async function idle(db){
 const report=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  return {manual:await tx.mailboxSend.count({where:{status:'PROCESSING'}}),campaign:await tx.mailboxCampaignDelivery.count({where:{status:'PROCESSING'}}),
   newsletter:await tx.newsletterMailJob.count({where:{status:'PROCESSING'}}),restock:await tx.restockRequest.count({where:{status:'PROCESSING'}}),
   automatic:await tx.emailDelivery.count({where:{status:{in:['PENDING','QUEUE_PROCESSING']}}})};
 });
 if(Object.values(report).some(n=>n>0))throw Error('MAIL_IN_FLIGHT_OR_UNCERTAIN_AUDIT_REVIEW_REQUIRED');return report;
}
function configure(s,values){
 write(backup+'/operation-env-'+Date.now()+'.private.json',{file:s.file,env:s.env,original:fs.readFileSync(s.file,'utf8')});
 let text=fs.readFileSync(s.file,'utf8');
 for(const[k,v]of Object.entries(values)){
  text=text.replace(new RegExp('^'+k+'=.*(?:\\r?\\n|$)','gm'),'');text+=(text.endsWith('\n')?'':'\n')+k+'='+v+'\n';
 }
 const temporary=s.file+'.cronox-mail-'+process.pid;
 fs.writeFileSync(temporary,text,{mode:s.stat.mode&0o777,flag:'wx'});fs.chownSync(temporary,s.stat.uid,s.stat.gid);fs.renameSync(temporary,s.file);
 run('/usr/bin/pm2',['restart','cronox','--update-env'],{...process.env,...s.env,...values});run('/usr/bin/pm2',['save']);
 const current=effective();
 if(Object.entries(values).some(([k,v])=>current.env[k]!==v))throw Error('EFFECTIVE_CONFIG_MISMATCH');
 console.log(JSON.stringify({mode:process.argv[2],commit:run('git',['-C',root,'rev-parse','HEAD']).toString().trim(),
  pid:current.app.pid,flags:Object.fromEntries(Object.keys(values).map(k=>[k,current.env[k]]))}));
}
async function retention(db,mode){
 const {MailboxFilesService}=req(backend+'/dist/mailbox/mailbox-files.service');
 const {MailboxProviderService}=req(backend+'/dist/mailbox/mailbox-provider.service');
 const {MailboxLeasesService}=req(backend+'/dist/mailbox/mailbox-leases.service');
 const {MailboxRetentionService}=req(backend+'/dist/mailbox/mailbox-retention.service');
 const service=new MailboxRetentionService(db,new MailboxFilesService(),new MailboxProviderService(),new MailboxLeasesService(db));
 const boxes=await db.mailbox.findMany({where:{active:true},orderBy:{id:'asc'},select:{id:true}});
 if(boxes.length!==4)throw Error('MAILBOX_INVENTORY_CHANGED');
 const planned=mode==='clean'?JSON.parse(fs.readFileSync(backup+'/retention-plan.json')):null;
 const now=planned?new Date(planned.at):new Date();const reports=[];
 for(const b of boxes){const r=await service.cleanBox(b.id,true,now,0);if(!r||r.more||!['INFO','NOREPLY','ORDERS','SUPPORT'].includes(r.senderKey))throw Error('RETENTION_PLAN_REQUIRES_REVIEW');reports.push(r);}
 if(mode==='dryrun'){
  const file=backup+'/retention-plan.json';if(fs.existsSync(file))throw Error('RETENTION_PLAN_ALREADY_EXISTS_REVIEW_FIRST');
  write(file,{at:now,reports});console.log(JSON.stringify({mode,at:now,reports}));return;
 }
 if(Date.now()-now.getTime()>3600000||JSON.stringify(reports)!==JSON.stringify(planned.reports))throw Error('RETENTION_PLAN_CHANGED');
 const outcomeFile=backup+'/retention-result.json';if(fs.existsSync(outcomeFile))throw Error('RETENTION_ALREADY_RUN_REVIEW_RESULT');
 const outcome={at:now,complete:false,reports:[]};write(outcomeFile,outcome);
 for(const b of boxes){
  const r=await service.cleanBox(b.id,false,now,0);
  if(!r)throw Error('RETENTION_LEASE_BUSY');outcome.reports.push(r);fs.writeFileSync(outcomeFile,JSON.stringify(outcome,null,2));
 }
 outcome.complete=true;fs.writeFileSync(outcomeFile,JSON.stringify(outcome,null,2));console.log(JSON.stringify({mode,...outcome}));
}
(async()=>{
 if(process.platform!=='linux'||process.getuid()!==0)throw Error('ROOT_VPS_TERMINAL_REQUIRED');process.umask(0o077);
 const mode=process.argv[2];if(!['prepare','dryrun','clean','activate'].includes(mode))throw Error('INVALID_MODE');
 verifiedBackup();const s=effective();Object.assign(process.env,s.env);
 const db=new(req('@prisma/client').PrismaClient)();
 try{
  await idle(db);
  if(mode==='prepare')return configure(s,{...common,MAILBOX_WORKER_ENABLED:'false',MAILBOX_SEND_ENABLED:'false',MAILBOX_CAMPAIGN_ENABLED:'false',
   NEWSLETTER_EMAIL_WORKER_ENABLED:'false',WAITLIST_EMAIL_WORKER_ENABLED:'false',EMAIL_SMTP_PAUSED:'true',MAILBOX_SENT_RETENTION_ENABLED:'false'});
  const [{applied}]=await db.$queryRaw`SELECT count(*)::int AS applied FROM _prisma_migrations WHERE migration_name='20261004190000_mail_account_quota' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  if(applied!==1)throw Error('SHARED_QUOTA_MIGRATION_NOT_APPLIED');
  if(mode==='activate'){
   const result=JSON.parse(fs.readFileSync(backup+'/retention-result.json'));if(!result.complete)throw Error('RETENTION_NOT_COMPLETE');
   if(await db.mailboxCampaign.count({where:{status:{in:['SCHEDULED','PROCESSING']}}}))throw Error('EXISTING_CAMPAIGN_REQUIRES_REVIEW');
   return configure(s,{...common,MAILBOX_WORKER_ENABLED:'true',MAILBOX_SEND_ENABLED:'true',MAILBOX_CAMPAIGN_ENABLED:'true',
    NEWSLETTER_EMAIL_WORKER_ENABLED:'true',WAITLIST_EMAIL_WORKER_ENABLED:'true',EMAIL_SMTP_PAUSED:'false',MAILBOX_SENT_RETENTION_ENABLED:'true'});
  }
  if(s.env.MAILBOX_WORKER_ENABLED!=='false'||s.env.MAILBOX_SEND_ENABLED!=='false'||s.env.EMAIL_SMTP_PAUSED!=='true')throw Error('MAIL_NOT_PAUSED');
  await retention(db,mode);
 }finally{await db.$disconnect();}
})().catch(error=>{
 const safe=/^[A-Z_]+$/.test(error.message)?error.message:'PRIVATE_OPERATOR_LOG_REQUIRED';
 console.error('CRONOX_MAIL_OPERATION_FAILED:'+safe);process.exitCode=1;
 if(process.platform==='linux'&&process.getuid()===0){try{const file=backup+'/operation-error-'+Date.now()+'.private.log';fs.writeFileSync(file,String(error.stack||error),{mode:0o600,flag:'wx'});console.error('PRIVATE_OPERATOR_LOG:'+file);}catch{}}
});
