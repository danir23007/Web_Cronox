'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {execFileSync}=require('node:child_process'),{Client}=require('pg');
const {readPlan,digest}=require('./user-numbering.cjs');
const {ownership}=require('./user-numbering-ownership.cjs');
async function verify(directory,bin) {
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'plan.json'),'utf8'));
 const backup=path.join(directory,manifest.backup);
 if(digest(fs.readFileSync(backup))!==manifest.backupSha256)throw Error('Backup hash mismatch');
 const temporary=await fsp.mkdtemp(path.join(os.tmpdir(),'cronox-numbering-restore-'));
 const exe=name=>{const file=path.join(bin,name+(process.platform==='win32'?'.exe':''));return fs.existsSync(file)?file:name;};
 const run=(name,args)=>execFileSync(exe(name),args,{windowsHide:true,stdio:name==='pg_ctl'?'ignore':'pipe'});
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const data=path.join(temporary,'pg');let started=false,client;
 try {
  run('initdb',['-D',data,'-U','cronox_restore','-A','trust','--encoding=UTF8','--locale=C']);
  const options=process.platform==='win32'?`-h 127.0.0.1 -p ${port}`:`-h '' -p ${port} -k ${temporary}`;
  run('pg_ctl',['-D',data,'-l',path.join(temporary,'postgres.log'),'-o',options,'-w','start']);started=true;
  const url=`postgresql://cronox_restore@127.0.0.1:${port}/postgres`+(process.platform==='win32'?'':`?host=${encodeURIComponent(temporary)}`);
  run('psql',[url,'-v','ON_ERROR_STOP=1','-c','CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;']);
  const toc=run('pg_restore',['--list',backup]).toString('utf8').split(/\r?\n/).filter(line=>!/^\d+;.* SCHEMA - public /.test(line)).join('\n');
  const list=path.join(temporary,'restore.list');fs.writeFileSync(list,toc);
  run('pg_restore',['--no-owner','--no-acl','--exit-on-error','--use-list='+list,'--dbname='+url,backup]);
  client=new Client({connectionString:url});await client.connect();
  const restored=await readPlan(client);
  if(JSON.stringify(restored)!==JSON.stringify(manifest.plan))throw Error('Restored map differs from the backup snapshot');
  if(manifest.ownership && (await ownership(client)).sha256!==manifest.ownership.sha256)throw Error('Restored ownership inventory differs from the snapshot');
  manifest.restoreVerified=true;manifest.restoreVerification={at:new Date().toISOString(),total:restored.length,backupSha256:manifest.backupSha256};
  fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  return {restored:true,total:restored.length,backupSha256:manifest.backupSha256};
 }finally{if(client)await client.end();if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
}
module.exports={verify};
if(require.main===module){const v=k=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1);verify(path.resolve(v('--directory')||''),v('--pg-bin')||'C:/Program Files/PostgreSQL/17/bin').then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message.slice(0,300));process.exitCode=1;});}
