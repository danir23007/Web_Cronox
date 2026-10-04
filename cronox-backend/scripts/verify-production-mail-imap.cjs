'use strict';
// Manual VPS diagnostic for CRONOX: EXAMINE and UID/flag reads only; no SMTP.
// Runtime output includes mailbox metadata. Keep reports private and out of Git.
const fs = require('node:fs');
const { createRequire } = require('node:module');
const root = '/var/www/cronox/Web_Cronox/cronox-backend';
const req = createRequire(root + '/package.json');
Object.assign(process.env, req('dotenv').parse(fs.readFileSync(root + '/.env')));
const db = new (req('@prisma/client').PrismaClient)();
const provider = new (req(root + '/dist/mailbox/mailbox-provider.service.js').MailboxProviderService)();
(async () => {
 const boxes = await db.$transaction(async tx => {
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  return tx.mailbox.findMany({where:{active:true},include:{folders:true}});
 });
 for (const box of boxes) {
  let client;
  const result = {address:box.address,checkedAt:new Date(),folders:[]};
  try {
   client = await provider.imap(box);
   result.authentication = 'TLS_AUTH_OK';
   result.uidplus = client.capabilities.has('UIDPLUS');
   for (const folder of box.folders.filter(f => f.available && ['\\Inbox','\\Sent'].includes(f.specialUse))) {
    const lock = await client.getMailboxLock(folder.path,{readOnly:true});
    try {
     const uids = await client.search({all:true},{uid:true});
     const seen = await client.search({seen:true},{uid:true});
     const cached = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.mailboxMessage.findMany({where:{mailboxId:box.id,folderId:folder.id,alive:true},select:{uid:true,seen:true}});
     });
     const providerIds = new Set(uids.map(Number));
     const cachedIds = new Set(cached.map(m=>Number(m.uid)));
     result.folders.push({path:folder.path,specialUse:folder.specialUse,providerCount:uids.length,cacheCount:cached.length,unreadProvider:uids.length-seen.length,unreadCache:cached.filter(m=>!m.seen).length,missingInCache:uids.filter(uid=>!cachedIds.has(Number(uid))),absentFromProvider:cached.filter(m=>!providerIds.has(Number(m.uid))).map(m=>m.uid),uidValidityMatches:String(client.mailbox.uidValidity)===String(folder.uidValidity),readOnly:client.mailbox.readOnly});
    } finally { lock.release(); }
   }
  } catch(e) {result.error=String(e.code||e.constructor.name);}
  finally {if(client) await client.logout().catch(()=>client.close());}
  console.log(JSON.stringify(result));
 }
})().catch(e=>{console.error('IMAP_READONLY_FAILED:'+String(e.code||e.constructor.name));process.exitCode=1;}).finally(()=>db.$disconnect());
