const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {assertReady}=require('./check-account-state-release.cjs');
test('release fails closed until the reviewed maintenance migration is complete',()=>{
  assert.throws(()=>assertReady({states:['ACTIVE','PRE_REGISTERED','PENDING_PASSWORD'],claimColumn:false,legacyRows:2}),/maintenance required/);
  assert.throws(()=>assertReady({states:['ACTIVE','INACTIVE'],claimColumn:false,legacyRows:0}));
  assert.throws(()=>assertReady({states:['ACTIVE','INACTIVE'],claimColumn:true,legacyRows:1}));
  const ready={states:['ACTIVE','INACTIVE'],claimColumn:true,stateColumn:true,legacyRows:'0',migrationApplied:true,checksumMatches:true};
  assert.doesNotThrow(()=>assertReady(ready));
  for(const key of ['claimColumn','stateColumn','migrationApplied','checksumMatches'])assert.throws(()=>assertReady({...ready,[key]:false}),/maintenance required/);
  assert.throws(()=>assertReady({...ready,legacyRows:undefined}),/maintenance required/);
});
test('deployment checks maintenance before automatic migrations and restart',()=>{
  const script=fs.readFileSync(path.join(__dirname,'../../.github/scripts/deploy-vps-release.sh'),'utf8');
  const guard=script.indexOf('node scripts/check-account-state-release.cjs');
  assert.ok(guard>=0&&guard<script.indexOf('npm run build:compiled'));
  assert.doesNotMatch(script,/migrate deploy|pm2 restart/);
  const controller=fs.readFileSync(path.join(__dirname,'../../.github/ops/cronox-release/controller.py'),'utf8');
  assert.match(controller,/'backup', 'install', 'migrate',\s*'start_paused'/);
});
