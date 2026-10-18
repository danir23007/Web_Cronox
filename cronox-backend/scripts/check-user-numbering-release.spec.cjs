'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate}=require('./check-user-numbering-release.cjs');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ready={ready:true,migrations:5,nextId:43,total:42,maximum:42,invalid:0,misordered:0};
test('blocks automatic deployment before backup/compaction, partial migrations and inconsistent numbering',()=>{
 for(const state of [null,{...ready,ready:false},{...ready,migrations:2},{...ready,maximum:44},{...ready,nextId:45},{...ready,invalid:1},{...ready,misordered:1}])assert.throws(()=>validate(state),/Controlled user numbering/);
});
test('permits a fully numbered release and an empty reviewed initial database',()=>{
 assert.equal(validate(ready),true);assert.equal(validate({...ready,total:0,maximum:0,nextId:1}),true);
});
test('incoming production release is checked before merging HTML; readiness is checked again before migrate/restart',()=>{
 const production=fs.readFileSync(path.resolve(__dirname,'../../.github/ops/cronox-release/preflight.cjs'),'utf8');
 const release=fs.readFileSync(path.resolve(__dirname,'../../.github/scripts/deploy-vps-release.sh'),'utf8');
 assert.ok(release.indexOf('check-user-numbering-release.cjs')>=0);
 assert.ok(release.indexOf('check-user-numbering-release.cjs')<release.indexOf('npm run build:compiled'));
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
