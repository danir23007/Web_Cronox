/* Root-only, explicit operator invocation. Does not start Nest, send mail,
 * update queues, restart PM2, migrate, clean mail or grant permissions.
 * inspect: safe allowlist; backup: consistent pg_dump plus private archive;
 * verify: restores the application public schema to an isolated local cluster,
 * checks every referenced encrypted file and mailbox credential, then stops it.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = '/var/www/cronox/Web_Cronox';
const backend = root + '/cronox-backend';
const req = createRequire(backend + '/package.json');
const flags = ['MAILBOX_WORKER_ENABLED', 'MAILBOX_SEND_ENABLED',
 'MAILBOX_CAMPAIGN_ENABLED', 'MAILBOX_CAMPAIGN_PROVIDER_VERIFIED',
 'MAILBOX_CAMPAIGN_DAILY_LIMIT', 'MAILBOX_CAMPAIGN_HOURLY_LIMIT',
 'MAILBOX_CAMPAIGN_INTERVAL_SECONDS', 'MAILBOX_SENT_RETENTION_ENABLED',
 'MAILBOX_CAMPAIGN_TRACKING_ENABLED', 'NEWSLETTER_EMAIL_WORKER_ENABLED',
 'WAITLIST_EMAIL_WORKER_ENABLED', 'BACKGROUND_JOBS_ENABLED',
 'SMTP_NOREPLY_DAILY_LIMIT', 'SMTP_NOREPLY_HOURLY_LIMIT',
 'SMTP_INFO_DAILY_LIMIT', 'SMTP_ORDERS_DAILY_LIMIT', 'SMTP_SUPPORT_DAILY_LIMIT',
 'MAILBOX_MAX_RECIPIENTS', 'MAILBOX_MAX_MESSAGE_BYTES', 'MAILBOX_MAX_ATTACHMENT_BYTES'];
const run = (command, args, options = {}) => execFileSync(command, args,
 { windowsHide:true, stdio:'pipe', maxBuffer:64 * 1024 * 1024, ...options });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function privateWrite(file, data) { fs.writeFileSync(file,data,{mode:0o600,flag:'wx'}); }
function state() {
 const daemon=Number(fs.readFileSync('/root/.pm2/pm2.pid','utf8').trim());
 if(!Number.isSafeInteger(daemon)||daemon<1)throw Error('PM2_DAEMON_NOT_RUNNING');
 process.kill(daemon,0);
 const apps = JSON.parse(run('/usr/bin/pm2',['jlist']).toString());
 const app = apps.find(p=>p.name==='cronox');
 if (!app || app.pm2_env?.status !== 'online' || !app.pid) throw Error('PM2_NOT_ONLINE');
 const cwd=fs.realpathSync(app.pm2_env.pm_cwd);
 if (![root,backend].map(p=>fs.realpathSync(p)).includes(cwd)) throw Error('UNEXPECTED_PM2_CWD');
 if(fs.realpathSync(app.pm2_env.pm_exec_path)!==fs.realpathSync(backend+'/dist/main.js'))throw Error('UNEXPECTED_PM2_ENTRY');
 const inherited = Object.fromEntries(fs.readFileSync('/proc/'+app.pid+'/environ','utf8')
  .split('\0').filter(s=>s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
 const envFile=path.resolve(cwd,inherited.CRONOX_ENV_FILE||app.pm2_env.env?.CRONOX_ENV_FILE||'.env');
 const fileEnv = req('dotenv').parse(fs.readFileSync(envFile));
 const filePredatesStart = fs.statSync(envFile).mtimeMs <= app.pm2_env.pm_uptime;
 const env = {...fileEnv,...app.pm2_env.env,...inherited};
 Object.assign(process.env,env);
 const privateRoot = req(backend+'/dist/mailbox/mailbox-files.service.js').mailboxPrivateRoot();
 const stat = fs.statSync(privateRoot);
 if (!stat.isDirectory()) throw Error('PRIVATE_STORAGE_NOT_DIRECTORY');
 fs.accessSync(privateRoot,fs.constants.R_OK|fs.constants.W_OK);
 return { app,env,envFile,privateRoot,apps,report:{
  host:require('node:os').hostname(),commit:run('git',['-C',root,'rev-parse','HEAD']).toString().trim(),
  pm2:{name:app.name,status:app.pm2_env.status,pid:app.pid,restarts:app.pm2_env.restart_time,
   unstableRestarts:app.pm2_env.unstable_restarts,exitCode:app.pm2_env.exit_code,
   startedAt:new Date(app.pm2_env.pm_uptime),errorLogLastModified:
    app.pm2_env.pm_err_log_path&&fs.existsSync(app.pm2_env.pm_err_log_path)?fs.statSync(app.pm2_env.pm_err_log_path).mtime:null},
  filePredatesStart,configEvidence:filePredatesStart?'START_ENV_PLUS_UNCHANGED_DOTENV':'DOTENV_CHANGED_REQUIRES_RUNTIME_CHECK',
  flags:Object.fromEntries(flags.map(k=>[k,env[k]??'UNSET'])),
  privateStorage:{readWrite:true,mode:(stat.mode&0o777).toString(8),owner:stat.uid},
 }};
}
function pgEnv(url) {
 const parsed = new URL(url);
 if (!['postgres:','postgresql:'].includes(parsed.protocol)) throw Error('DATABASE_PROTOCOL');
 return {...process.env,PGHOST:parsed.hostname.replace(/^\[|\]$/g,''),PGPORT:parsed.port||'5432',
  PGUSER:decodeURIComponent(parsed.username),PGPASSWORD:decodeURIComponent(parsed.password),
  PGDATABASE:decodeURIComponent(parsed.pathname.slice(1)),PGSSLMODE:parsed.searchParams.get('sslmode')||'require',PGCONNECT_TIMEOUT:'15'};
}
function backup(s) {
 if(!s.report.filePredatesStart)throw Error('ENV_CHANGED_AFTER_START_RESOLVE_EFFECTIVE_CONFIG_FIRST');
 const base = '/root/cronox-backups';
 fs.mkdirSync(base,{recursive:true,mode:0o700});
 const stat=fs.statSync(base);
 if(stat.uid!==0 || (stat.mode&0o077)!==0 || fs.realpathSync(base)!==base) throw Error('BACKUP_DIRECTORY_UNSAFE');
 const dir = fs.mkdtempSync(base+'/mail-');
 fs.chmodSync(dir,0o700);
 // Keep both original and effective configuration for encrypted recovery.
 privateWrite(dir+'/dotenv.private',fs.readFileSync(s.envFile));
 privateWrite(dir+'/effective-env.private.json',JSON.stringify(s.env));
 privateWrite(dir+'/pm2.private.json',JSON.stringify(s.apps));
 privateWrite(dir+'/release.json',JSON.stringify(s.report,null,2));
 const pg = pgEnv(s.env.DATABASE_URL);
 // A custom archive includes the full database snapshot, not just mail tables.
 run('/usr/bin/pg_dump',['--format=custom','--file='+dir+'/database.dump'],{env:pg});
 fs.chmodSync(dir+'/database.dump',0o600);
 run('/usr/bin/tar',['-czf',dir+'/private-mail.tar.gz','-C',s.privateRoot,'.']);
 fs.chmodSync(dir+'/private-mail.tar.gz',0o600);
 const manifest=Object.fromEntries(fs.readdirSync(dir).map(name=>[name,hash(dir+'/'+name)]));
 privateWrite(dir+'/manifest.json',JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({backup:dir,archiveCreated:true,recoveryVerified:false,
  note:'Run verify. Concurrent deletion of a referenced file makes verification fail; never clean on an unverified archive.'}));
}
async function verify(dir) {
 if(dir==='latest'){
  const base='/root/cronox-backups';
  dir=fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^mail-[\w-]+$/.test(e.name))
   .map(e=>base+'/'+e.name).filter(p=>fs.existsSync(p+'/manifest.json'))
   .sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
 }
 if (!dir || fs.realpathSync(dir)!==dir || !/^\/root\/cronox-backups\/mail-[\w-]+$/.test(dir)) throw Error('BACKUP_PATH_UNSAFE');
 const manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json'));
 for(const [name,expected] of Object.entries(manifest)) {
  if(path.basename(name)!==name || hash(dir+'/'+name)!==expected) throw Error('BACKUP_HASH_MISMATCH');
 }
 run('/usr/bin/pg_restore',['--list',dir+'/database.dump']);
 run('/usr/bin/tar',['-tzf',dir+'/private-mail.tar.gz']);
 const version = run('/usr/bin/pg_restore',['--version']).toString().match(/(\d+)\./)?.[1];
 const bin = process.env.CRONOX_RESTORE_PG_BIN || '/usr/lib/postgresql/'+version+'/bin';
 for(const name of ['initdb','pg_ctl','postgres']) fs.accessSync(bin+'/'+name,fs.constants.X_OK);
 const uid=Number(run('id',['-u','deploy']).toString().trim());
 const gid=Number(run('id',['-g','deploy']).toString().trim());
 const isolated=fs.mkdtempSync('/var/tmp/cronox-mail-restore-');
 fs.chmodSync(isolated,0o700); fs.chownSync(isolated,uid,gid);
 const cleanEnv={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'};
 const asPostgres=(command,args)=>run('/usr/sbin/runuser',['-u','deploy','--',command,...args],{env:cleanEnv});
 const localEnv={...cleanEnv,PGHOST:isolated,PGPORT:'55439',PGUSER:'postgres',PGDATABASE:'postgres',PGSSLMODE:'disable',PGPASSWORD:''};
 let started=false;
 try {
  const initArgs=['-D',isolated+'/pg','-U','postgres','-A','trust','--encoding=UTF8','--locale=C'];
  if(process.env.CRONOX_RESTORE_PG_SHARE)initArgs.push('-L',process.env.CRONOX_RESTORE_PG_SHARE);
  asPostgres(bin+'/initdb',initArgs);
  // Unix socket inside 0700 directory, no TCP listener, no application/workers.
  started=true;
  asPostgres(bin+'/pg_ctl',['-D',isolated+'/pg','-l',isolated+'/postgres.log','-o',"-c listen_addresses='' -k "+isolated+' -p 55439','-w','start']);
  run('/usr/bin/psql',['-X','-v','ON_ERROR_STOP=1','-c','CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'],{env:localEnv});
  // Managed provider schemas remain in the full dump. Restore CRONOX's entire
  // application schema; provider-managed extensions/roles require its restore tool.
  const restoreArgs=['--exit-on-error','--no-owner','--no-acl','--schema=public','--dbname=postgres',dir+'/database.dump'];
  // --schema does not select dependent EXTENSION objects. CRONOX's text GIN
  // indexes require pg_trgm, which is public in the production catalog. Restore
  // definitions, create that dependency, then restore data and all constraints.
  run('/usr/bin/pg_restore',['--section=pre-data',...restoreArgs],{env:localEnv});
  run('/usr/bin/psql',['-X','-v','ON_ERROR_STOP=1','-c','CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;'],{env:localEnv});
  run('/usr/bin/pg_restore',['--section=data',...restoreArgs],{env:localEnv});
  run('/usr/bin/pg_restore',['--section=post-data',...restoreArgs],{env:localEnv});
  const query=sql=>run('/usr/bin/psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{env:localEnv}).toString().trim();
  const keys = JSON.parse(query(`SELECT COALESCE(json_agg(key),'[]') FROM (SELECT key FROM "MailboxFile" WHERE key IS NOT NULL UNION SELECT "bodyKey" FROM "MailboxMessage" WHERE "bodyKey" IS NOT NULL) refs`));
  const frozen=JSON.parse(query(`SELECT COALESCE(json_agg(content),'[]') FROM (SELECT content FROM "MailboxCampaignVersion" UNION ALL SELECT snapshot FROM "MailboxCampaign" WHERE snapshot IS NOT NULL) versions`));
  const allKeys = new Set(keys);
  const visit=value=>{if(!value || typeof value!=='object')return;for(const [name,item] of Object.entries(value)){if(name==='key'&&typeof item==='string'&&/^[0-9a-f-]{36}$/i.test(item))allKeys.add(item);else visit(item);}};
  frozen.forEach(visit);
  const restoreFiles=fs.mkdtempSync(dir+'/verified-private-');
  run('/usr/bin/tar',['-xzf',dir+'/private-mail.tar.gz','-C',restoreFiles]);
  const env=JSON.parse(fs.readFileSync(dir+'/effective-env.private.json'));
  Object.assign(process.env,env,{MAILBOX_PRIVATE_DIR:restoreFiles});
  const files=new (req(backend+'/dist/mailbox/mailbox-files.service.js').MailboxFilesService)();
  for(const key of allKeys) {
   const stream=await files.read(key);
   for await (const _chunk of stream) {} // consume to verify the AES-GCM tag
  }
  const boxes=JSON.parse(query(`SELECT COALESCE(json_agg(row_to_json(b)),'[]') FROM (SELECT id,"imapSecretRef","imapSecret","smtpSecretRef","smtpSecret" FROM "Mailbox") b`));
  const {credential}=req(backend+'/dist/mailbox/mailbox-security.js');
  for(const box of boxes) for(const kind of ['imap','smtp']) credential(box[kind+'SecretRef'],box[kind+'Secret'],box.id+':'+kind);
  const migrations=JSON.parse(query(`SELECT COALESCE(json_agg(migration_name),'[]') FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`));
  const report={checkedAt:new Date(),backup:dir,hashesVerified:true,applicationSchemaRestored:true,
   providerManagedSchemasRestored:false,referencedPrivateFilesDecrypted:allKeys.size,mailboxCredentialsRecovered:boxes.length,
   migrationCount:migrations.length,requiredExtensions:['pg_trgm'],network:'PRIVATE_UNIX_SOCKET_NO_TCP',workersStarted:false};
  privateWrite(dir+'/recovery-verified-'+Date.now()+'.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 } finally {
  let stopped=!started;
  if(started){asPostgres(bin+'/pg_ctl',['-D',isolated+'/pg','-m','fast','-w','stop']);stopped=true;}
  // Keep the stopped 0700 restoration for operator inspection, never in Git.
  console.log(JSON.stringify({isolatedRestore:isolated,stopped}));
 }
}
(async()=>{
 if(process.platform!=='linux'||process.getuid()!==0) throw Error('ROOT_VPS_TERMINAL_REQUIRED');
 process.umask(0o077);
 const mode=process.argv[2];
 if(mode==='verify')return verify(process.argv[3]);
 if(!['inspect','backup'].includes(mode))throw Error('USE_INSPECT_BACKUP_OR_VERIFY');
 const s=state();
 console.log(JSON.stringify(s.report,null,2));
 if(mode==='backup')backup(s);
})().catch(error=>{
 // Captured subprocess output can contain sensitive provider details. Do not print it.
 const stderr=String(error.stderr||'');
 const cause=/operator class.*does not exist/.test(stderr)?'PG_RESTORE_REQUIRED_EXTENSION_MISSING':
  /error while loading shared libraries/.test(stderr)?'POSTGRES_LIBRARY_MISSING':
  /pg_restore: error/.test(stderr)?'PG_RESTORE_FAILED':null;
 console.error('CRONOX_OPERATOR_CHECK_FAILED:'+String(cause||error.code||(/^[A-Z_]+$/.test(error.message)?error.message:error.constructor.name)));
 if(process.platform==='linux'&&process.getuid()===0){
  try{
   const base='/root/cronox-backups';fs.mkdirSync(base,{recursive:true,mode:0o700});
   const stat=fs.statSync(base);
   if(stat.uid!==0||(stat.mode&0o077)!==0||fs.realpathSync(base)!==base)throw Error('UNSAFE');
   const log=base+'/operator-error-'+Date.now()+'.private.log';
   privateWrite(log,String(error.stack||error)+'\n'+String(error.stderr||''));
   console.error('PRIVATE_OPERATOR_LOG:'+log);
  }catch{}
 }
 process.exitCode=1;
});
