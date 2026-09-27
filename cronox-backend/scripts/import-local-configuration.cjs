// Extension of import-local-public-content: definitions only, no recipients or jobs.
const fs=require('node:fs');const path=require('node:path');
const {PrismaClient,Prisma}=require('@prisma/client');const dotenv=require('dotenv');
const {loadLocalEnvironment}=require('./start-local.cjs');
const root=path.resolve(__dirname,'../..');
const names=['WebsiteMediaAsset','KeyScreen','EmailSenderProfile','EmailTemplateFolder','EmailSignature','ManagedEmailTemplate','EmailTemplateVersion','EmailPublication','EmailAsset'];
const key=n=>n[0].toLowerCase()+n.slice(1);
const scalar=n=>Prisma.dmmf.datamodel.models.find(m=>m.name===n).fields.filter(f=>f.kind!=='object'&&!['createdBy','updatedBy'].includes(f.name));
const normalize=v=>JSON.parse(JSON.stringify(v));
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function scrub(value){
 if(Array.isArray(value))return value.map(scrub);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['createdBy','updatedBy'].includes(k)).map(([k,v])=>[k,scrub(v)]));
 if(typeof value==='string')return value.replace(/([?&](?:token|code|access_token|key)=)([^\s"'<>\&]+)/gi,(all,prefix,token)=>/\{|%7B/i.test(token)?all:prefix+'LOCAL_PREVIEW_DISABLED');
 return value;
}
module.exports=async function importConfiguration(){
 const local=loadLocalEnvironment();const dest=new URL(local.DATABASE_URL);
 if(dest.hostname!=='127.0.0.1'||dest.port!=='5433'||dest.pathname!=='/cronox_dev')throw Error('Destination must be the isolated local database.');
 const source=dotenv.parse(fs.readFileSync(path.join(root,'cronox-backend/.env')));const origin=new URL(source.DATABASE_URL);
 if(origin.hostname!=='aws-1-eu-west-1.pooler.supabase.com'||origin.pathname!=='/postgres')throw Error('Unexpected source.');
 const remote=new PrismaClient({datasources:{db:{url:source.DATABASE_URL}}});const db=new PrismaClient({datasources:{db:{url:local.DATABASE_URL}}});
 try{
 const data=await remote.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');const d={};
  for(const n of [...names,'KeyScreenSettings'])d[n]=await tx[key(n)].findMany({select:Object.fromEntries(scalar(n).map(f=>[f.name,true]))});
  return d;
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60000});
 const mediaIds=new Set(data.KeyScreen.map(s=>s.mediaAssetId).filter(Boolean));
 data.WebsiteMediaAsset=data.WebsiteMediaAsset.filter(a=>mediaIds.has(a.id));
 const selected=data.KeyScreenSettings[0]?.activeScreenId;
 delete data.KeyScreenSettings; // Never import enabled, expiry or any launch lifecycle fields.
 const safe=scrub(normalize(data));
 const snapshotPath=path.join(root,'test-results/local-admin/configuration-import.json');
 fs.mkdirSync(path.dirname(snapshotPath),{recursive:true});fs.writeFileSync(snapshotPath,JSON.stringify(safe,null,2));
 const result=await db.$transaction(async tx=>{
  const settings=await tx.keyScreenSettings.findUnique({where:{id:'global'}});
  if(settings?.enabled||settings?.launchArmedAt||settings?.launchStartedAt)throw Error('Local gate/campaign state conflicts with a disabled configuration import.');
  if(settings?.activeScreenId&&selected&&settings.activeScreenId!==selected)throw Error('Local selected screen differs; nothing overwritten.');
  const counts={};
  for(const n of names){counts[n]=0;for(const original of safe[n]){
   const row={...original};if(n==='EmailSenderProfile')row.defaultSignatureId=null;
   const where=n==='EmailPublication'?{senderKey_purpose:{senderKey:row.senderKey,purpose:row.purpose}}:{[n==='EmailSenderProfile'?'key':'id']:row[n==='EmailSenderProfile'?'key':'id']};
   const existing=await tx[key(n)].findUnique({where,select:Object.fromEntries(scalar(n).map(f=>[f.name,true]))});
   if(existing){const projected=normalize(existing);if(n==='EmailSenderProfile')projected.defaultSignatureId=null;if(stable(projected)!==stable(row))throw Error(`Local edit/conflict in ${n}; nothing overwritten.`);continue;}
   const values=Object.fromEntries(scalar(n).filter(f=>Object.hasOwn(row,f.name)).map(f=>[f.name,f.type==='Json'&&row[f.name]===null?Prisma.DbNull:row[f.name]]));
   await tx[key(n)].create({data:values});counts[n]++;
  }}
  for(const p of safe.EmailSenderProfile)if(p.defaultSignatureId)await tx.emailSenderProfile.update({where:{key:p.key},data:{defaultSignatureId:p.defaultSignatureId}});
  if(selected&&safe.KeyScreen.some(s=>s.id===selected)&&!settings?.activeScreenId)await tx.keyScreenSettings.upsert({where:{id:'global'},create:{id:'global',activeScreenId:selected,enabled:false},update:{activeScreenId:selected}});
  return counts;
 },{timeout:60000});
 console.log(JSON.stringify({imported:result,gateEnabled:false,campaignImported:false,recipientsImported:false,source:origin.hostname},null,2));
 }finally{await remote.$disconnect();await db.$disconnect();}
};
