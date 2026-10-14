const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('maintenance installs artifacts without restarting writers or performing an unavailable HTTP smoke',()=>{
 const stage=fs.readFileSync(path.join(__dirname,'deploy-vps-release.sh'),'utf8');
 assert.match(stage,/if \[ -f \/var\/lib\/cronox\/maintenance\.flag \]; then[\s\S]*?MAINTENANCE_RELEASE_INSTALLED_BACKEND_STOPPED[\s\S]*?else[\s\S]*?pm2 restart cronox/);
 const driver=fs.readFileSync(path.join(__dirname,'deploy-production.sh'),'utf8');
 assert.ok(driver.indexOf('MAINTENANCE_ACTIVE_ROOT_START_REQUIRED')<driver.indexOf('cronox-export-smoke.json'));
 assert.match(driver,/MAINTENANCE_ACTIVE_ROOT_START_REQUIRED'[\s\S]*?exit 0/);
});
test('manual verification can skip publishing while push behavior remains supported',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/deploy.yml'),'utf8');
 assert.match(workflow,/publish:[\s\S]*?type: boolean/);
 assert.match(workflow,/deploy:\s*\n\s*if: github\.event_name == 'push' \|\| inputs\.publish/);
});
