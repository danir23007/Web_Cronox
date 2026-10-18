const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('maintenance installs artifacts without restarting writers or performing an unavailable HTTP smoke',()=>{
 const stage=fs.readFileSync(path.join(__dirname,'deploy-vps-release.sh'),'utf8');
 assert.match(stage,/test -f \/var\/lib\/cronox\/maintenance\.flag/);
 assert.doesNotMatch(stage,/pm2 restart|migrate deploy|sudo/);
 const driver=fs.readFileSync(path.join(__dirname,'deploy-production.sh'),'utf8');
 assert.match(driver,/cronox-release request \$GITHUB_SHA/);
 assert.match(driver,/cronox-release status \$GITHUB_SHA/);
 assert.doesNotMatch(driver,/sudo \/usr\/bin\/pm2|git reset|git merge/);
 assert.match(driver,/StrictHostKeyChecking=yes/);
});
test('push verifies only and publishing requires an explicit dispatch',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/deploy.yml'),'utf8');
 assert.match(workflow,/publish:[\s\S]*?type: boolean/);
 assert.match(workflow,/deploy:\s*\n\s*if: github\.event_name == 'workflow_dispatch' && inputs\.publish/);
});
