'use strict';
// Manual CRONOX VPS inventory, with database transactions forced READ ONLY.
// Uses local .env in memory; prints an allowlist, never credentials or bodies.
// Runtime reports contain operational metadata and must stay outside Git.
const fs = require('node:fs');
const { createRequire } = require('node:module');
const req = createRequire('/var/www/cronox/Web_Cronox/cronox-backend/package.json');
const env = req('dotenv').parse(fs.readFileSync('/var/www/cronox/Web_Cronox/cronox-backend/.env'));
const { PrismaClient } = req('@prisma/client');
const db = new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
const publicVars = ['MAILBOX_WORKER_ENABLED','MAILBOX_SEND_ENABLED','MAILBOX_CAMPAIGN_ENABLED','MAILBOX_CAMPAIGN_PROVIDER_VERIFIED','MAILBOX_CAMPAIGN_DAILY_LIMIT','MAILBOX_CAMPAIGN_HOURLY_LIMIT','MAILBOX_CAMPAIGN_INTERVAL_SECONDS','MAILBOX_SENT_RETENTION_ENABLED','MAILBOX_CAMPAIGN_TRACKING_ENABLED','NEWSLETTER_EMAIL_WORKER_ENABLED','WAITLIST_EMAIL_WORKER_ENABLED','BACKGROUND_JOBS_ENABLED','MAILBOX_MAX_MESSAGE_BYTES','MAILBOX_MAX_ATTACHMENT_BYTES','MAILBOX_MAX_RECIPIENTS','SMTP_NOREPLY_HOURLY_LIMIT','SMTP_NOREPLY_DAILY_LIMIT','SMTP_INFO_DAILY_LIMIT','SMTP_SUPPORT_DAILY_LIMIT','SMTP_ORDERS_DAILY_LIMIT'];
(async()=>{
 const result=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  return { identity:await tx.$queryRawUnsafe('SELECT current_database() AS database, inet_server_addr() AS host, inet_server_port() AS port'),
   migrations:await tx.$queryRawUnsafe('SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC'),
   boxes:await tx.mailbox.findMany({select:{id:true,address:true,active:true,status:true,errorCode:true,lastSyncAt:true,nextSyncAt:true,leaseUntil:true,folders:{select:{id:true,path:true,specialUse:true,available:true,uidValidity:true,lastUid:true,retentionUid:true}}}}),
   sends:await tx.mailboxSend.groupBy({by:['status'],_count:{_all:true}}),
   campaigns:await tx.mailboxCampaign.groupBy({by:['status'],_count:{_all:true}}),
   campaignDeliveries:await tx.mailboxCampaignDelivery.groupBy({by:['status'],_count:{_all:true}}),
   newsletterJobs:await tx.newsletterMailJob.groupBy({by:['status'],_count:{_all:true}}),
   restockRequests:await tx.restockRequest.groupBy({by:['status'],_count:{_all:true}}),
   automaticDeliveries:await tx.emailDelivery.groupBy({by:['senderKey','status'],_count:{_all:true}}),
   messages:await tx.mailboxMessage.groupBy({by:['mailboxId','folderId'],where:{alive:true},_count:{_all:true}}),
   leases:await tx.$queryRawUnsafe('SELECT count(*)::int AS active FROM "Mailbox" WHERE "leaseUntil">now()'),
  };
 });
 const expected=fs.readdirSync('/var/www/cronox/Web_Cronox/cronox-backend/prisma/migrations',{withFileTypes:true}).filter(f=>f.isDirectory()).map(f=>f.name);
 const applied=new Set(result.migrations.filter(m=>m.finished_at&&!m.rolled_back_at).map(m=>m.migration_name));
 result.pendingMigrations=expected.filter(name=>!applied.has(name));
 result.unfinishedMigrations=result.migrations.filter(m=>!m.finished_at&&!m.rolled_back_at);
 result.appliedMigrationCount=applied.size;
 result.migrations=result.migrations.slice(0,5);
 result.fileConfig=Object.fromEntries(publicVars.map(k=>[k,env[k]??'UNSET']));
 result.privateStorageAccessible=false; result.privateStorageError=null;
 try { const stat=fs.statSync(env.MAILBOX_PRIVATE_DIR);fs.accessSync(env.MAILBOX_PRIVATE_DIR,fs.constants.R_OK|fs.constants.W_OK);result.privateStorageAccessible=stat.isDirectory();result.privateStorageMode=(stat.mode&0o777).toString(8); } catch(e){result.privateStorageError=e.code;}
 for(const filename of ['/root/.pm2/dump.pm2']) {try {const apps=JSON.parse(fs.readFileSync(filename));result.pm2=apps.filter(p=>p.name==='cronox').map(p=>({name:p.name,cwd:p.pm_cwd,config:Object.fromEntries(publicVars.map(k=>[k,p[k]??p.env?.[k]??'UNSET']))}));}catch(e){result.pm2InspectionError=e.code;}}
 console.log(JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v,2));
})().catch(e=>{console.error('READONLY_DIAGNOSTIC_FAILED:'+String(e.code||e.constructor.name));process.exitCode=1;}).finally(()=>db.$disconnect());
