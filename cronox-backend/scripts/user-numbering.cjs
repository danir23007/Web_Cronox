'use strict';
// Offline operator. No Nest, SMTP, workers, token signing or production defaults.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),{Client}=require('pg');
const {inventory,ownership}=require('./user-numbering-ownership.cjs');
const root=path.resolve(__dirname,'../..');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const initialPlanSql=`SELECT COALESCE(jsonb_agg(jsonb_build_object('oldId',id,'newId',n,'createdAt',"createdAt"::text,'oldMemberCode',"memberCode") ORDER BY n),'[]'::jsonb) AS plan FROM (SELECT *,row_number() OVER (ORDER BY "createdAt",id)::integer n FROM "User") u`;
async function readPlan(client) {
 const has=(await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='identityUid') AS present`)).rows[0].present;
 return (await client.query(has?'SELECT cronox_user_number_plan() AS plan':initialPlanSql)).rows[0].plan;
}
async function prepare(client, connection, directory, bin) {
 if(fs.existsSync(path.join(directory,'plan.json'))||fs.existsSync(path.join(directory,'database.dump')))throw Error('Backup directory already contains a snapshot; choose a new private directory');
 if(path.resolve(directory).toLowerCase().startsWith(path.join(root,'cronox-front').toLowerCase()+path.sep))throw Error('Backups must never be placed in the public frontend');
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
 try {
  const plan=await readPlan(client), snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const backup=path.join(directory,'database.dump'),u=new URL(connection);
  const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password)};
  if(u.searchParams.get('sslmode'))env.PGSSLMODE=u.searchParams.get('sslmode');
  execFileSync(path.join(bin,process.platform==='win32'?'pg_dump.exe':'pg_dump'),['-Fc','--schema=public','--snapshot='+snapshot,'--file='+backup],{env,windowsHide:true,stdio:'pipe'});
  const references=await inventory(client);
  const owners=plan[0]?.identityUid?await ownership(client):null;
  const manifest={total:plan.length,plan,references,ownership:owners,backup:'database.dump',backupSha256:digest(fs.readFileSync(backup)),createdAt:new Date().toISOString(),restoreVerified:false};
  fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  fs.chmodSync(backup,0o600);
  await client.query('COMMIT');return manifest;
 } catch(e){await client.query('ROLLBACK');throw e;}
}
async function apply(client, manifest, directory, expected, deletionUid) {
 if(expected!==manifest.total)throw Error('Explicit expected user count does not match the reviewed plan');
 if(digest(fs.readFileSync(path.join(directory,manifest.backup)))!==manifest.backupSha256)throw Error('Backup hash mismatch');
 if(!manifest.restoreVerified)throw Error('Restore this dump to an isolated database and verify it before --apply');
 await client.query('BEGIN');
 try {
  await client.query('SELECT pg_advisory_xact_lock(824031,1)');
  const tables=(await client.query(`SELECT string_agg(format('%I.%I',n.nspname,c.relname),',' ORDER BY c.relname) AS names FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`)).rows[0].names;
  await client.query('LOCK TABLE '+tables+' IN ACCESS EXCLUSIVE MODE');
  const actual=await readPlan(client);
  if(JSON.stringify(actual)!==JSON.stringify(manifest.plan))throw Error('Plan changed; prepare and verify a fresh backup');
  const before=await ownership(client);
  if(JSON.stringify(before.inventory)!==JSON.stringify(manifest.references))throw Error('Reference schema changed; prepare and verify a fresh backup');
  if(manifest.ownership && before.sha256!==manifest.ownership.sha256)throw Error('Account references changed since backup; prepare and restore a fresh backup');
  let run;
  if(deletionUid) {
   if(!actual.some(x=>x.identityUid===deletionUid))throw Error('Deletion UUID is absent from the reviewed plan');
   const target=(await client.query('SELECT role,"accountState" FROM "User" WHERE "identityUid"=$1',[deletionUid])).rows[0];
   if(target.accountState==='ACTIVE'&&['ADMIN','SUPERADMIN'].includes(target.role)) {
    const counts=(await client.query(`SELECT count(*) FILTER(WHERE role IN ('ADMIN','SUPERADMIN'))::integer admins,count(*) FILTER(WHERE role='SUPERADMIN')::integer supers FROM "User" WHERE "accountState"='ACTIVE'`)).rows[0];
    if(counts.admins<=1||(target.role==='SUPERADMIN'&&counts.supers<=1))throw Error('Deletion would remove the last active administrative access');
   }
   await client.query(`SELECT set_config('cronox.user_delete','on',true)`);
   const deleted=await client.query('DELETE FROM "User" WHERE "identityUid"=$1 RETURNING "identityUid"',[deletionUid]);
   if(deleted.rowCount!==1)throw Error('Deletion changed unexpectedly');
   run='controlled deletion';
  } else run=(await client.query('SELECT cronox_compact_users($1,$2::jsonb,$3) AS run',[expected,JSON.stringify(actual),'reviewed initial numbering'])).rows[0].run;
  const after=await readPlan(client);
  if(after.length!==expected-(deletionUid?1:0)||after.some(x=>x.oldId!==x.newId))throw Error('Nonconsecutive result');
  const invalid=(await client.query(`SELECT count(*)::integer AS n FROM "User" WHERE "memberCode"<>cronox_user_number_code(id)`)).rows[0].n;
  if(invalid)throw Error('Member code mismatch');
  const cascaded=new Set(deletionUid?before.records.map(record=>JSON.parse(record)).filter(([table,key,column,uid])=>uid===deletionUid && before.inventory.foreignKeys.some(f=>f.table===table&&f.column===column&&f.delete_action==='c')).map(([table,key])=>JSON.stringify([table,key])):[]);
  const retained=before.records.filter(record=>{const [table,key,column,uid]=JSON.parse(record);return uid!==deletionUid&&!cascaded.has(JSON.stringify([table,key]));});
  const current=await ownership(client);
  if(JSON.stringify(retained)!==JSON.stringify(current.records))throw Error('Ownership verification failed; operation rolled back');
  await client.query('COMMIT');return {total:after.length,changed:!!run,run};
 }catch(e){await client.query('ROLLBACK');throw e;}
}
async function main() {
 const args=process.argv.slice(2),value=key=>args.find(x=>x.startsWith(key+'='))?.slice(key.length+1);
 const external=value('--connection-env');
 const local=external?null:require('./start-local.cjs').loadLocalEnvironment();
 const connection=external?process.env[external]:local.DATABASE_URL;
 if(!connection)throw Error('Missing connection environment variable');
 const u=new URL(connection),loopback=['127.0.0.1','localhost'].includes(u.hostname);
 if(!loopback&&!args.includes('--production-maintenance'))throw Error('External database requires explicit --production-maintenance after stopping application/workers');
 const client=new Client({connectionString:connection});await client.connect();
 try {
  await client.query('SELECT pg_advisory_lock(824031,1)');
  if(args.includes('--prepare')) {
   const directory=value('--directory');if(!directory)throw Error('--directory is required for private backup');
   const manifest=await prepare(client,connection,path.resolve(directory),value('--pg-bin')||local?.LOCAL_PG_BIN||'C:/Program Files/PostgreSQL/17/bin');
   console.log(JSON.stringify({total:manifest.total,changed:manifest.plan.filter(x=>x.oldId!==x.newId).length,backupSha256:manifest.backupSha256,restoreVerified:false}));
  }else if(args.includes('--apply')) {
   const directory=path.resolve(value('--directory')||'');
   const manifest=JSON.parse(fs.readFileSync(path.join(directory,'plan.json'),'utf8'));
   console.log(JSON.stringify(await apply(client,manifest,directory,Number(value('--expect-users')),value('--delete-uid'))));
  }else {
   await client.query('BEGIN READ ONLY');const plan=await readPlan(client);await client.query('COMMIT');
   console.log(JSON.stringify({scope:'read only, no production default',total:plan.length,maximumId:Math.max(0,...plan.map(x=>x.oldId)),moves:plan.filter(x=>x.oldId!==x.newId).length}));
  }
 }finally{await client.end();}
}
module.exports={readPlan,prepare,apply,digest};
if(require.main===module)main().catch(e=>{console.error(e.message.replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted connection]'));process.exitCode=1;});
