// Disposable PostgreSQL only; no production/local business database connection.
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const backend=path.resolve(__dirname,'..'),bin='C:/Program Files/PostgreSQL/17/bin';
const exe=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(cmd,args,opts={})=>execFileSync(cmd,args,{windowsHide:true,stdio:'pipe',...opts});
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cronox-favorites-')),data=path.join(dir,'pg');
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const url=`postgresql://cronox_favorites@127.0.0.1:${port}/postgres`;
  Object.assign(process.env,require('../test/test-environment.cjs').withTestEnvironment({}, {force:true}),{DATABASE_URL:url,DIRECT_URL:url,CRONOX_ENV_FILE:path.join(dir,'absent.env'),BACKGROUND_JOBS_ENABLED:'false'});
  run(exe('initdb'),['-D',data,'-U','cronox_favorites','-A','trust','--encoding=UTF8','--locale=C']);
  run(exe('pg_ctl'),['-D',data,'-l',path.join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{stdio:'ignore'});
  let db;
  try {
    const schema=path.join(dir,'schema.prisma');await fs.copyFile(path.join(backend,'prisma/schema.prisma'),schema);
    const sql=run(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',schema,'--script'],{cwd:dir,env:process.env});
    const baseline=path.join(dir,'baseline.sql');await fs.writeFile(baseline,'CREATE EXTENSION IF NOT EXISTS pg_trgm;\n'+sql);run(exe('psql'),[url,'-v','ON_ERROR_STOP=1','-f',baseline]);
    const runtimePath=require.resolve('@prisma/client/runtime/library.js'),runtime=require(runtimePath);
    require.cache[runtimePath].exports=new Proxy(runtime,{get(t,k){if(k==='warnEnvConflicts')return()=>{};if(k==='getPrismaClient')return config=>t.getPrismaClient({...config,relativeEnvPaths:{}});return Reflect.get(t,k);}});
    const {PrismaClient}=require('@prisma/client');db=new PrismaClient({datasources:{db:{url}}});
    const {AdminFavoritesService}=require('../dist/admin/favorites/admin-favorites.service'),reporter=new AdminFavoritesService(db);
    const {FavoritesService}=require('../dist/favorites/favorites.service'),favorites=new FavoritesService(db);
    const users=[];
    for(let i=0;i<3;i++)users.push(await db.user.create({data:{email:`favorites-${i}@example.test`,accountState:i===2?'PRE_REGISTERED':'ACTIVE',password:null}}));
    const products=[];
    for(let i=0;i<28;i++)products.push(await db.product.create({data:{name:'Producto '+i,slug:'favorite-product-'+i,price:3500,imageUrl:'/assets/products/camiseta_washed_gris.png',variants:{create:{sku:'FAV-'+i,size:'M',stockQty:i===2?0:3}}}}));
    const get=patch=>reporter.report({page:1,sort:'desc',...patch});
    assert.equal((await get()).summary.favorites,0);assert.equal((await get()).total,28);
    await favorites.add(users[0].id,{productId:products[0].id});
    await favorites.add(users[0].id,{productId:products[0].id}); // Same identity/device retry.
    await favorites.add(users[0].id,{productId:products[1].id});
    await favorites.add(users[0].id,{productId:products[2].id});
    await favorites.add(users[1].id,{productId:products[0].id});
    await db.favorite.create({data:{userId:users[2].id,productId:products[1].id}});
    await db.product.update({where:{id:products[1].id},data:{isActive:false}});
    const r=await get();assert.deepEqual(r.summary,{favorites:5,users:3});assert.equal(r.rows.length,25);
    assert.deepEqual(r.rows.slice(0,3).map(p=>[p.id,p.favorites]),[[products[0].id,2],[products[1].id,2],[products[2].id,1]]);
    assert.equal(r.rows[1].isActive,false);assert.equal(r.rows[1].available,false);assert.equal(r.rows[2].available,false);
    assert.equal(r.rows[3].favorites,0);assert.deepEqual((await get({page:2})).summary,r.summary);
    assert.equal((await get({page:2})).rows.length,3);
    assert.equal((await get({search:'FAV-0'})).total,1);assert.deepEqual((await get({search:'FAV-0'})).summary,r.summary);
    assert.equal((await get({search:String(products[0].id)})).rows[0].id,products[0].id);
    assert.equal((await get({search:'%'})).total,0);assert.equal((await get({search:"' OR 1=1 --"})).total,0);
    assert.equal((await get({sort:'asc'})).rows[0].favorites,0);
    await favorites.remove(users[0].id,String(products[0].id));
    assert.equal((await get()).summary.favorites,4);
    assert.equal((await get({search:'FAV-0'})).rows[0].favorites,1);
    assert.equal(await db.favorite.count(),4);
    await db.productVariant.deleteMany({where:{productId:products[27].id}});
    await db.product.delete({where:{id:products[27].id}});assert.equal((await get()).total,27);
    console.log('PASS: real PostgreSQL + FavoritesService add/remove, repeated devices, all account states/passwordless, per-user/per-product totals, zeros, inactive/stock, search/escaping, ties, pages/global summaries, deletion, fresh queries.');
  }finally{
    await db?.$disconnect();run(exe('pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'ignore'});
    const relative=path.relative(os.tmpdir(),dir);assert.ok(relative.startsWith('cronox-favorites-')&&!relative.includes('..')&&!path.isAbsolute(relative));await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
