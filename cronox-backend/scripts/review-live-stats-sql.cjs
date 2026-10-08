// Disposable loopback PostgreSQL; no deployment env, HTTP, mail or payments.
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const backend=path.resolve(__dirname,'..'),bin='C:/Program Files/PostgreSQL/17/bin';
const exe=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(command,args,options={})=>execFileSync(command,args,{windowsHide:true,stdio:'pipe',...options});
async function main(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cronox-presence-')),data=path.join(dir,'pg');
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const url=`postgresql://cronox_presence@127.0.0.1:${port}/postgres`;
  Object.assign(process.env,require('../test/test-environment.cjs').withTestEnvironment({}, {force:true}),{DATABASE_URL:url,DIRECT_URL:url,CRONOX_ENV_FILE:path.join(dir,'absent.env'),BACKGROUND_JOBS_ENABLED:'false'});
  run(exe('initdb'),['-D',data,'-U','cronox_presence','-A','trust','--encoding=UTF8','--locale=C']);
  run(exe('pg_ctl'),['-D',data,'-l',path.join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{stdio:'ignore'});
  let db;
  try{
    const schema=path.join(dir,'schema.prisma');await fs.copyFile(path.join(backend,'prisma/schema.prisma'),schema);
    const sql=run(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',schema,'--script'],{cwd:dir,env:process.env});
    const baseline=path.join(dir,'baseline.sql');await fs.writeFile(baseline,'CREATE EXTENSION IF NOT EXISTS pg_trgm;\n'+sql);run(exe('psql'),[url,'-v','ON_ERROR_STOP=1','-f',baseline]);
    const runtimePath=require.resolve('@prisma/client/runtime/library.js'),runtime=require(runtimePath);
    require.cache[runtimePath].exports=new Proxy(runtime,{get(target,key){if(key==='warnEnvConflicts')return()=>{};if(key==='getPrismaClient')return config=>target.getPrismaClient({...config,relativeEnvPaths:{}});return Reflect.get(target,key);}});
    const {PrismaClient}=require('@prisma/client');db=new PrismaClient({datasources:{db:{url}}});
    const {LiveStatsService}=require('../dist/live-stats/live-stats.service'),service=new LiveStatsService(db);
    const users=[];
    for(const role of ['USER','ADMIN','SUPERADMIN'])users.push(await db.user.create({data:{email:role.toLowerCase()+'@example.test',role,accountState:'ACTIVE'}}));
    for(const user of users)await db.authSession.create({data:{id:'session-'+user.id,userId:user.id,sessionVersion:user.sessionVersion,refreshHash:'fixture',refreshIssuedAt:Math.floor(Date.now()/1000)}});
    const anonymousId=randomUUID(),guest=await db.cart.create({data:{anonymousId}}),cart=await db.cart.create({data:{userId:users[0].id}});
    const product=await db.product.create({data:{slug:'presence-fixture',name:'Fixture',price:1000,variants:{create:{sku:'presence-fixture',size:'M',stockQty:10}}},include:{variants:true}});
    for(const [target,qty]of[[guest,3],[cart,2]])await db.cartItem.create({data:{cartId:target.id,variantId:product.variants[0].id,qty,priceAtAdd:1000}});
    await db.livePresence.upsert({where:{visitorHash:'guest'},create:{visitorHash:'guest',section:'home',anonymousId},update:{section:'store'}});
    await db.livePresence.upsert({where:{visitorHash:'guest'},create:{visitorHash:'guest',section:'home'},update:{section:'home'}});
    assert.equal(await db.livePresence.count(),1,'guest proof is unique across tabs');
    for(const user of users)await db.livePresence.create({data:{visitorHash:'proof-'+user.id,userId:user.id,sessionId:'session-'+user.id,section:'home',seenAt:new Date(Date.now()-6000)}});
    await db.livePresence.create({data:{visitorHash:'second-account-proof',userId:users[0].id,sessionId:'session-'+users[0].id,section:'product',productId:product.id}});
    let snapshot=await service.snapshot();assert.deepEqual(snapshot.visitors,{total:2,signedIn:1,guests:1});assert.deepEqual(snapshot.carts,{visitors:2,units:5,products:1});
    assert.deepEqual(snapshot.locations.map(x=>[x.section,x.visitors]).sort(),[['home',1],['product',1]]);assert.equal(snapshot.products[0].visitors,1);
    await db.authSession.update({where:{id:'session-'+users[0].id},data:{revokedAt:new Date()}});
    snapshot=await service.snapshot();assert.deepEqual(snapshot.visitors,{total:1,signedIn:0,guests:1});assert.equal(snapshot.carts.units,3);
    await db.livePresence.update({where:{visitorHash:'guest'},data:{seenAt:new Date(Date.now()-121000)}});
    snapshot=await service.snapshot();assert.equal(snapshot.visitors.total,0);assert.equal(await db.livePresence.count({where:{visitorHash:'guest'}}),0);
    const report={scope:'disposable real PostgreSQL only',checks:['guest tab uniqueness','normal account dedup across proofs','ADMIN/SUPERADMIN excluded','latest valid section/product','cart quantities dedup','revoked sessions excluded','120-second expiry and cleanup'],passed:true};
    const out=path.resolve(backend,'../output/playwright/live-stats');await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'sql-report.json'),JSON.stringify(report,null,2));console.log('PASS: real PostgreSQL presence dedup, roles, carts, session validity and expiry');
  }finally{if(db)await db.$disconnect();run(exe('pg_ctl'),['-D',data,'-m','fast','-w','stop'],{stdio:'ignore'});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
