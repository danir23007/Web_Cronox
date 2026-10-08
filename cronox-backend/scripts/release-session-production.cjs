'use strict';
// Explicit operator tool for the authorized October release. No Nest/workers.
// Private dumps and diagnostics never enter the checkout or Git.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = '/var/www/cronox/Web_Cronox', backend = root + '/cronox-backend';
if (process.platform !== 'linux' || process.getuid() === 0) throw Error('USE_DEPLOY_USER_ON_VPS');
process.umask(0o077);
const req = createRequire(backend + '/package.json');
const env = req('dotenv').parse(fs.readFileSync(backend + '/.env'));
const url = new URL(env.DIRECT_URL || env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('INVALID_DATABASE');
const pgEnv = { ...process.env, PGHOST:url.hostname, PGPORT:url.port || '5432',
  PGDATABASE:decodeURIComponent(url.pathname.slice(1)), PGUSER:decodeURIComponent(url.username),
  PGPASSWORD:decodeURIComponent(url.password), PGSSLMODE:url.searchParams.get('sslmode') || 'require' };
const run = (command, args, options = {}) => execFileSync(command,args,{encoding:'utf8',stdio:'pipe',maxBuffer:64*1024*1024,...options});
const sql = (query, connection=pgEnv) => run('/usr/bin/psql',['-X','-A','-t','-v','ON_ERROR_STOP=1'],{input:query,env:connection}).trim();
const base = '/home/deploy/cronox-release-backups';
fs.mkdirSync(base,{recursive:true,mode:0o700});
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file,data) => fs.writeFileSync(file,JSON.stringify(data,null,2),{mode:0o600,flag:'wx'});
function inventory(connection=pgEnv) {
  return JSON.parse(sql(`BEGIN READ ONLY;
    SELECT json_build_object('users',(SELECT count(*) FROM "User"),
      'subscriptions',(SELECT count(*) FROM "NewsletterSubscription"),
      'confirmedOrphans',(SELECT count(*) FROM "NewsletterSubscription" s WHERE s."subscribedAt" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "User" u WHERE lower(btrim(u.email))=lower(btrim(s.email)))),
      'duplicateEmails',(SELECT count(*) FROM (SELECT 1 FROM "User" GROUP BY lower(btrim(email)) HAVING count(*)>1) d),
      'codeCollisions',(SELECT count(*) FROM (SELECT 1 FROM "User" WHERE "memberCode" IS NOT NULL GROUP BY lower(btrim("memberCode")) HAVING count(*)>1) d),
      'footerMatches',(SELECT count(*) FROM "FooterPageContent" WHERE html ~* 'dani\\.rivas@cronox\\.es'),
      'migrations',(SELECT json_agg(migration_name ORDER BY migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
      'failedMigrations',(SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL));
    COMMIT;`,connection).split('\n').find(line=>line.startsWith('{')));
}
async function main() {
  const mode=process.argv[2], dir=process.argv[3];
  if(mode==='audit') { console.log(JSON.stringify(inventory())); return; }
  if(mode==='backup') {
    const destination=fs.mkdtempSync(base+'/session-20261008-');
    const before=inventory();
    run('/usr/bin/pg_dump',['--format=custom','--schema=public','--no-owner','--no-acl','--file='+destination+'/database.dump'],{env:pgEnv});
    fs.chmodSync(destination+'/database.dump',0o600);
    const report={backup:destination,createdAt:new Date().toISOString(),before,dumpHash:hash(destination+'/database.dump'),scope:'complete application public schema; no provider-managed schemas or private mailbox files'};
    write(destination+'/manifest.json',report);
    console.log(JSON.stringify(report)); return;
  }
  if(!dir || fs.realpathSync(dir)!==dir || !dir.startsWith(base+'/session-20261008-')) throw Error('VERIFIED_BACKUP_DIRECTORY_REQUIRED');
  const manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json'));
  if(hash(dir+'/database.dump')!==manifest.dumpHash) throw Error('BACKUP_HASH_MISMATCH');
  if(mode==='verify') {
    const bin=process.env.CRONOX_RESTORE_PG_BIN;
    if(!bin || !fs.existsSync(bin+'/initdb')) throw Error('ISOLATED_POSTGRES_BIN_REQUIRED');
    const isolated=fs.mkdtempSync(dir+'/restore-');
    const localEnv={...process.env,PGHOST:isolated,PGPORT:'55439',PGUSER:'deploy',PGDATABASE:'postgres',PGPASSWORD:'',PGSSLMODE:'disable'};
    const toolEnv={...localEnv,PGSHAREDIR:process.env.CRONOX_RESTORE_PG_SHARE};
    let started=false;
    try {
      run(bin+'/initdb',['-D',isolated+'/pg','-U','deploy','-A','trust','--encoding=UTF8','--locale=C'],{env:toolEnv});
      run(bin+'/pg_ctl',['-D',isolated+'/pg','-l',isolated+'/postgres.log','-o',"-c listen_addresses='' -k "+isolated+' -p 55439','-w','start'],{env:toolEnv}); started=true;
      sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',localEnv);
      const args=['--exit-on-error','--no-owner','--no-acl','--schema=public','--dbname=postgres',dir+'/database.dump'];
      run('/usr/bin/pg_restore',['--section=pre-data',...args],{env:localEnv});
      sql('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;',localEnv);
      run('/usr/bin/pg_restore',['--section=data',...args],{env:localEnv});
      run('/usr/bin/pg_restore',['--section=post-data',...args],{env:localEnv});
      const restored=inventory(localEnv);
      if(JSON.stringify(restored)!==JSON.stringify(manifest.before)) throw Error('RESTORE_COUNTS_MISMATCH');
      const migrationDir=process.env.CRONOX_RELEASE_MIGRATIONS;
      const migrations=['20261008120000_stable_user_identity_newsletter_link','20261008121000_prevent_deleted_user_id_reuse'];
      const script=migrations.map(name=>fs.readFileSync(path.join(migrationDir,name,'migration.sql'),'utf8')).join('\n');
      const test=`CREATE TEMP TABLE issued_before AS SELECT id,"memberCode","publicMemberToken" FROM "User";
        ${script}
        DO $$ BEGIN
          IF EXISTS(SELECT 1 FROM issued_before b LEFT JOIN "User" u USING(id) WHERE u.id IS NULL OR (b."memberCode" IS NOT NULL AND b."memberCode" IS DISTINCT FROM u."memberCode") OR b."publicMemberToken" IS DISTINCT FROM u."publicMemberToken")
          THEN RAISE EXCEPTION 'Issued identity changed'; END IF;
        END $$;`;
      sql(test,localEnv);
      const report={checkedAt:new Date().toISOString(),backup:dir,hashVerified:true,applicationSchemaRestored:true,providerManagedSchemasRestored:false,privateMailboxFilesRestored:false,restoredUsers:restored.users,restoredSubscriptions:restored.subscriptions,migrationsTested:migrations,existingIdsCodesAndQrPreserved:true,network:'private Unix socket, no TCP',workersStarted:false};
      write(dir+'/recovery-verified.json',report); console.log(JSON.stringify(report));
    } finally {if(started)run(bin+'/pg_ctl',['-D',isolated+'/pg','-m','fast','-w','stop'],{env:toolEnv});}
    return;
  }
  if(!fs.existsSync(dir+'/recovery-verified.json')) throw Error('RECOVERY_VERIFICATION_REQUIRED');
  if(!['dry-run','repair'].includes(mode)) throw Error('USE_AUDIT_BACKUP_VERIFY_DRY_RUN_REPAIR');
  const {PrismaClient}=req('@prisma/client');
  const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
  try {
    const {repairNewsletterUsers}=req(backend+'/dist/newsletter/newsletter-user-repair');
    const before=await repairNewsletterUsers(db,false);
    write(dir+'/newsletter-dry-run-'+Date.now()+'.private.json',before);
    if(mode==='dry-run') {console.log(JSON.stringify(before));return;}
    const jobsBefore=await db.newsletterMailJob.count();
    const result=await repairNewsletterUsers(db,true);
    if(await db.newsletterMailJob.count()!==jobsBefore) throw Error('MAIL_JOB_COUNT_CHANGED_REVIEW_CONCURRENT_ACTIVITY');
    const footer=await db.$queryRawUnsafe(`UPDATE "FooterPageContent" SET html=regexp_replace(html,'dani\\.rivas@cronox\\.es','support@cronox.es','gi'),revision=revision+1,"updatedAt"=CURRENT_TIMESTAMP WHERE html ~* 'dani\\.rivas@cronox\\.es' RETURNING slug,revision`);
    const cases=[];
    for(const [index,email] of (process.env.CRONOX_VERIFY_EMAILS||'').split(',').filter(Boolean).entries()) {
      const user=await db.user.findUnique({where:{email},select:{id:true,memberCode:true,accountState:true,newsletterSubscribed:true}});
      const subscription=await db.newsletterSubscription.findUnique({where:{email},select:{userId:true,subscribedAt:true}});
      if(!user || !subscription || subscription.userId!==user.id || !user.memberCode || !user.newsletterSubscribed || !subscription.subscribedAt) throw Error('EXAMPLE_LINK_VERIFICATION_FAILED');
      cases.push({example:index+1,userId:user.id,memberCode:user.memberCode,accountState:user.accountState,linked:true});
    }
    const report={checkedAt:new Date().toISOString(),result,footer,mailJobsUnchanged:true,cases,inventory:inventory()};
    write(dir+'/repair-'+Date.now()+'.private.json',report);console.log(JSON.stringify(report));
  } finally {await db.$disconnect();}
}
main().catch(error=>{
  const log=base+'/error-'+Date.now()+'.private.log';
  fs.writeFileSync(log,String(error.stack||error)+'\n'+String(error.stderr||''),{mode:0o600});
  console.error('RELEASE_OPERATION_FAILED:'+String(error.code||error.constructor.name)+'; private log: '+log);process.exitCode=1;
});
