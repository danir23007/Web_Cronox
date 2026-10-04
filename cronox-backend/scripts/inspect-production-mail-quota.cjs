'use strict';
// Manual CRONOX VPS check after the shared-quota migration. READ ONLY, no workers.
// Runtime reports include mailbox metadata; keep them private and outside Git.
const fs=require('node:fs'),{createRequire}=require('node:module');
const backend='/var/www/cronox/Web_Cronox/cronox-backend',req=createRequire(backend+'/package.json');
const env=req('dotenv').parse(fs.readFileSync(backend+'/.env'));
const db=new(req('@prisma/client').PrismaClient)({datasources:{db:{url:env.DATABASE_URL}}});
(async()=>{
 const result=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const boxes=await tx.mailbox.findMany({select:{id:true,address:true,username:true,status:true,errorCode:true,lastSyncAt:true}});
  const accounts=[];
  for(const key of ['INFO','NOREPLY','ORDERS','SUPPORT']){
   const account=String(env['SMTP_'+key+'_USER']||'').trim().toLowerCase();
   const box=boxes.find(b=>b.username.trim().toLowerCase()===account);
   const [{used}]=await tx.$queryRaw`SELECT COALESCE(sum(units),0)::int AS used FROM "MailAccountQuota" WHERE account=${account} AND "reservedAt">clock_timestamp()-interval '24 hours'`;
   accounts.push({key,mailboxIdentityMatches:Boolean(box),status:box?.status,errorCode:box?.errorCode,lastSyncAt:box?.lastSyncAt,usedUnitsLast24h:used,configuredLimit:env['SMTP_'+key+'_DAILY_LIMIT']});
  }
  return {accounts,migrations:await tx.$queryRaw`SELECT count(*)::int AS applied FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
   unfinished:await tx.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
   quotaMigration:await tx.$queryRaw`SELECT migration_name,finished_at FROM _prisma_migrations WHERE migration_name='20261004190000_mail_account_quota'`,
   ledger:await tx.$queryRaw`SELECT split_part(id,':',1) AS flow,count(*)::int AS reservations, sum(units)::int AS units FROM "MailAccountQuota" GROUP BY 1 ORDER BY 1`,
   privateLedger:await tx.$queryRaw`SELECT relrowsecurity AS rls,has_table_privilege('anon','"MailAccountQuota"','SELECT') AS anon_read,has_table_privilege('authenticated','"MailAccountQuota"','SELECT') AS authenticated_read FROM pg_class WHERE oid='"MailAccountQuota"'::regclass`,
   sends:await tx.mailboxSend.groupBy({by:['status'],_count:{_all:true}}),
   campaigns:await tx.mailboxCampaign.groupBy({by:['status'],_count:{_all:true}}),
   newsletter:await tx.newsletterMailJob.groupBy({by:['status'],_count:{_all:true}}),
   restock:await tx.restockRequest.groupBy({by:['status'],_count:{_all:true}}),
   automatic:await tx.emailDelivery.groupBy({by:['senderKey','status'],_count:{_all:true}}),
   preservedInbox:await tx.$queryRaw`SELECT b.address,count(*)::int AS messages FROM "MailboxMessage" m JOIN "MailboxFolder" f ON f.id=m."folderId" JOIN "Mailbox" b ON b.id=m."mailboxId" WHERE f."specialUse"=concat(chr(92),'Inbox') AND m.alive GROUP BY b.address ORDER BY b.address`,
   cachedSent:await tx.$queryRaw`SELECT b.address,count(*)::int AS messages FROM "MailboxMessage" m JOIN "MailboxFolder" f ON f.id=m."folderId" JOIN "Mailbox" b ON b.id=m."mailboxId" WHERE f."specialUse"=concat(chr(92),'Sent') AND m.alive GROUP BY b.address ORDER BY b.address`};
 });console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error('QUOTA_READONLY_FAILED:'+String(e.code||e.constructor.name));process.exitCode=1;}).finally(()=>db.$disconnect());
