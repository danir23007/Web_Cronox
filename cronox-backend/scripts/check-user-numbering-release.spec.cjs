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
 const production=fs.readFileSync(path.resolve(__dirname,'../../.github/scripts/deploy-production.sh'),'utf8');
 const release=fs.readFileSync(path.resolve(__dirname,'../../.github/scripts/deploy-vps-release.sh'),'utf8');
 assert.ok(production.indexOf('git show "$expected:.github/scripts/run-release-preflight.cjs"')<production.indexOf('git merge --ff-only'));
 assert.ok(release.indexOf('check-user-numbering-release.cjs')<release.indexOf('prisma migrate deploy'));
 assert.ok(release.indexOf('check-user-numbering-release.cjs')<release.indexOf('pm2 restart'));
 const incomingLoader=production.match(/\| node -e '([\s\S]*?)' -- --repo=/)[1];
 const loaded=spawnSync(process.execPath,['-e',incomingLoader,'--','--repo=fixture','--revision='+'a'.repeat(40),'--env-file=fixture.env'],{
  cwd:path.resolve(__dirname,'..'),encoding:'utf8',
  input:'module.exports.main=args=>{if(!args.includes("--repo=fixture")||!args.includes("--env-file=fixture.env"))throw Error("Missing arguments");console.log("INCOMING_READ_ONLY_CHECK_LOADED");return 0;};',
 });
 assert.equal(loaded.status,0,loaded.stderr);assert.match(loaded.stdout,/INCOMING_READ_ONLY_CHECK_LOADED/);
});
