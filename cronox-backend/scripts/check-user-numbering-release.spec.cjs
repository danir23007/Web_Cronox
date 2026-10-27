'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate}=require('./check-user-numbering-release.cjs');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ready={ready:true,migrations:6,nextId:43,total:42,maximum:42,reservedMaximum:42,reservedCodeMaximum:42,invalid:0,compactionEnabled:false,permanentApplied:true,receiptExists:true};
test('blocks partial migrations, a regressed allocation cursor and enabled compaction',()=>{
 for(const state of [null,{...ready,ready:false},{...ready,migrations:2},{...ready,maximum:44},{...ready,nextId:42},{...ready,invalid:1},{...ready,compactionEnabled:true},{...ready,reservedMaximum:43}])assert.throws(()=>validate(state),/Permanent user numbering/);
});
test('permits permanent numbering with deletion gaps and reserved retired IDs',()=>{
 assert.equal(validate(ready),true);assert.equal(validate({...ready,total:0,maximum:0,reservedMaximum:0,reservedCodeMaximum:0,nextId:1}),true);
 assert.equal(validate({...ready,total:40,maximum:42,nextId:44}),true);
 assert.equal(validate({...ready,total:0,maximum:0,reservedMaximum:100,nextId:101}),true);
});
test('only explicit pre-migration checks accept a complete legacy input; startup rejects it',()=>{
 const old={...ready,migrations:5,compactionEnabled:true,permanentApplied:false,receiptExists:false,misordered:0,reservedMaximum:100,reservedCodeMaximum:100};
 assert.equal(validate(old,{beforeMigrate:true}),true);
 assert.throws(()=>validate(old),/Permanent user numbering/);
 for(const patch of [{migrations:4},{ready:false},{nextId:42},{maximum:43},{misordered:1},{invalid:1},{receiptExists:true},{permanentApplied:true},{compactionEnabled:false}])assert.throws(()=>validate({...old,...patch},{beforeMigrate:true}),/Permanent user numbering/);
 assert.equal(validate(ready,{beforeMigrate:true}),true);
 assert.throws(()=>validate({...ready,reservedCodeMaximum:43}),/Permanent user numbering/);
});
test('legacy compaction/deletion operator cannot mutate account IDs',async()=>{
 await assert.rejects(require('./user-numbering.cjs').apply(),/IDs are permanent/);
});
test('incoming production release is checked before merging HTML; readiness is checked again before migrate/restart',()=>{
 const production=fs.readFileSync(path.resolve(__dirname,'../../.github/ops/cronox-release/preflight.cjs'),'utf8');
 const release=fs.readFileSync(path.resolve(__dirname,'../../.github/scripts/deploy-vps-release.sh'),'utf8');
 assert.ok(release.indexOf('check-user-numbering-release.cjs')>=0);
 assert.ok(release.indexOf('check-user-numbering-release.cjs')<release.indexOf('npm run build:compiled'));
 assert.match(release,/check-user-numbering-release.cjs --deployment-check --before-migrate/);
 const bootstrap=fs.readFileSync(path.resolve(__dirname,'../src/main.ts'),'utf8');
 assert.ok(bootstrap.indexOf(".main(['--deployment-check'])")<bootstrap.indexOf('NestFactory.create('));
 assert.doesNotMatch(bootstrap,/--before-migrate/);
 assert.doesNotMatch(release,/migrate deploy|pm2 restart/);
 const fakeProcess={argv:['node','preflight.cjs','a'.repeat(40)],getuid:()=>1000,
   cwd:()=>'/var/www/cronox/Web_Cronox',chdir:()=>{},exit:()=>{throw Error('Unexpected exit');}};
 require('node:vm').runInNewContext(production,{process:fakeProcess,module,require:name=>{
  if(name==='node:child_process')return {execFileSync:(exe,args)=>{
    assert.equal(exe,'/usr/bin/git');
    assert.deepEqual(Array.from(args),['show','a'.repeat(40)+':.github/scripts/run-release-preflight.cjs']);
    return Buffer.from('module.exports.main=args=>{if(!args.includes("--revision='+'a'.repeat(40)+'")||!args.includes("--env-file=/var/www/cronox/Web_Cronox/cronox-backend/.env"))throw Error("Missing arguments");return 0;};');
  }};
  return require(name);
 }});
 assert.equal(fakeProcess.exitCode,0);
});
