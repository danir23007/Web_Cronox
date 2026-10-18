const fs=require('node:fs'), os=require('node:os'),p=require('node:path'), cp=require('node:child_process');
const root=fs.mkdtempSync(p.join(os.tmpdir(),'cronox-npm-build-fixture-'));
fs.chmodSync(root,0o700);
try {
 const tool=p.join(root,'tool'),app=p.join(root,'app');fs.mkdirSync(tool);fs.mkdirSync(app);
 fs.writeFileSync(p.join(tool,'package.json'),JSON.stringify({name:'cronox-build-fixture',version:'1.0.0',bin:{'fixture-build':'index.cjs'}}));
 fs.writeFileSync(p.join(tool,'index.cjs'),'#!/usr/bin/env node\nconsole.log("FIXTURE_BUILD_OK")\n');
 const run=(args,cwd,env={})=>cp.execFileSync(process.env.CRONOX_TEST_NPM_BIN||'/usr/bin/npm',args,{cwd,env:{...process.env,NODE_ENV:'production',...env},encoding:'utf8',stdio:['ignore','pipe','pipe']});
 run(['pack','--offline','--ignore-scripts','--pack-destination',root],tool);
 fs.writeFileSync(p.join(app,'package.json'),JSON.stringify({name:'cronox-test-app',version:'1.0.0',devDependencies:{'cronox-build-fixture':'file:../cronox-build-fixture-1.0.0.tgz'}}));
 const flags=['--offline','--ignore-scripts','--no-audit','--no-fund'];
 run(['install','--package-lock-only',...flags],app);
 const lock=fs.readFileSync(p.join(app,'package-lock.json'));
 run(['ci',...flags],app);
 if(fs.existsSync(p.join(app,'node_modules/cronox-build-fixture/index.cjs'))) throw Error('BEFORE_NOT_REPRODUCED');
 run(['ci',...flags],app,{npm_config_include:'dev'});
 if(!fs.existsSync(p.join(app,'node_modules/cronox-build-fixture/index.cjs'))) throw Error('AFTER_NOT_CORRECTED');
 if(!lock.equals(fs.readFileSync(p.join(app,'package-lock.json'))))throw Error('LOCK_CHANGED');
 console.log(JSON.stringify({productionDefaultOmittedBuildTool:true,explicitIncludeInstalledBuildTool:true,lockUnchanged:true,networkUsed:false}));
} finally { fs.rmSync(root,{recursive:true,force:true}); }
