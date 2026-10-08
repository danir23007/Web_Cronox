// Read-only check against the protected local configuration; never remote.
const assert=require('node:assert/strict');
const {loadLocalEnvironment}=require('./start-local.cjs');
const env=loadLocalEnvironment();
const runtimePath=require.resolve('@prisma/client/runtime/library.js'),runtime=require(runtimePath);
require.cache[runtimePath].exports=new Proxy(runtime,{get(t,k){if(k==='warnEnvConflicts')return()=>{};if(k==='getPrismaClient')return config=>t.getPrismaClient({...config,relativeEnvPaths:{}});return Reflect.get(t,k);}});
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
(async()=>{
  const {AdminFavoritesService}=require('../dist/admin/favorites/admin-favorites.service');
  const report=await new AdminFavoritesService(db).report({page:1,sort:'desc'});
  assert.equal(report.total,await db.product.count());
  assert.equal(report.summary.favorites,await db.favorite.count());
  const people=await db.favorite.findMany({distinct:['userId'],select:{userId:true}});
  assert.equal(report.summary.users,people.length);
  console.log(JSON.stringify({scope:'read-only protected loopback database',products:report.total,summary:report.summary,rows:report.rows.length,verified:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
