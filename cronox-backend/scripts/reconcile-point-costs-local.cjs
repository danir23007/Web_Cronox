'use strict';
// Explicit local-only dry run. No production URL or current-catalog fallback.
const path=require('path');
const args=process.argv.slice(2);if(args.some(a=>a!=='--apply'&&!/^--actor=\d+$/.test(a)&&!/^--point=[a-f0-9-]{36}$/.test(a)))throw Error('Usage: reconcile-point-costs-local.cjs [--point=UUID] [--apply --actor=ID]');
Object.assign(process.env,require('./start-local.cjs').loadLocalEnvironment());
const url=new URL(process.env.DATABASE_URL);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('LOCAL_DATABASE_REQUIRED');
require('ts-node').register({project:path.join(__dirname,'../tsconfig.json'),transpileOnly:true});
const db=new(require('@prisma/client').PrismaClient)();
(async()=>{try{console.log(JSON.stringify(await require('../src/admin/points/point-cost-reconciliation').reconcilePointCosts(db,{apply:args.includes('--apply'),actorId:Number(args.find(a=>a.startsWith('--actor='))?.slice(8))||undefined,pointId:args.find(a=>a.startsWith('--point='))?.slice(8)}),null,2));}finally{await db.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
