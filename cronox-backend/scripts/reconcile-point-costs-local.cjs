'use strict';
// Explicit local-only dry run. The optional review DB must be disposable.
const path=require('path');
const args=process.argv.slice(2);if(args.some(a=>a!=='--apply'&&!/^--actor=\d+$/.test(a)&&!/^--point=[a-f0-9-]{36}$/.test(a)&&!/^--review-db=cronox_editions_ui_[a-f0-9]{32}$/.test(a)))throw Error('Usage: reconcile-point-costs-local.cjs [--review-db=cronox_editions_ui_ID] [--point=UUID] [--apply --actor=ID]');
Object.assign(process.env,require('./start-local.cjs').loadLocalEnvironment());
const url=new URL(process.env.DATABASE_URL);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('LOCAL_DATABASE_REQUIRED');
const review=args.find(a=>a.startsWith('--review-db='))?.slice(12);if(review){url.pathname='/'+review;url.search='';process.env.DATABASE_URL=url.href;process.env.DIRECT_URL=url.href;}
require('ts-node').register({project:path.join(__dirname,'../tsconfig.json'),transpileOnly:true});
const db=new(require('@prisma/client').PrismaClient)();
(async()=>{try{console.log(JSON.stringify(await require('../src/admin/points/point-cost-reconciliation').reconcilePointCosts(db,{apply:args.includes('--apply'),actorId:Number(args.find(a=>a.startsWith('--actor='))?.slice(8))||undefined,pointId:args.find(a=>a.startsWith('--point='))?.slice(8)}),null,2));}finally{await db.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
