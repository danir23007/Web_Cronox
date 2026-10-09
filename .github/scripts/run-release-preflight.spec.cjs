'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const runner = path.join(__dirname, 'run-release-preflight.cjs');
function fixture(invalidLock = false) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'cronox-preflight-test-'));
  const write = (file, value) => { const target = path.join(directory, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
  const manifest = fs.readFileSync(path.join(root, '.github/preflight/package.json'), 'utf8');
  const lock = JSON.parse(fs.readFileSync(path.join(root, '.github/preflight/package-lock.json'), 'utf8'));
  if (invalidLock) lock.packages['node_modules/pg'].version = '0.0.0';
  write('.github/preflight/package.json', manifest);
  write('.github/preflight/package-lock.json', JSON.stringify(lock));
  write('cronox-backend/package-lock.json', fs.readFileSync(path.join(root, 'cronox-backend/package-lock.json')));
  write('cronox-backend/.env', 'ISOLATION_SENTINEL=runtime-config\n');
  write('cronox-backend/node_modules/pg/package.json', '{"name":"pg","version":"0.0.0"}');
  write('cronox-backend/scripts/check-user-numbering-release.cjs', `
    const assert=require('node:assert/strict'),fs=require('node:fs');
    assert.equal(require('pg/package.json').version,'8.23.1');
    assert.equal(require('dotenv/package.json').version,'16.6.1');
    assert.equal(typeof require('pg').Client,'function');
    assert.equal(require('dotenv').parse(fs.readFileSync(process.env.CRONOX_ENV_FILE)).ISOLATION_SENTINEL,'runtime-config');
    assert.ok(process.argv.includes('--deployment-check'));
    assert.ok(require.resolve('pg').startsWith(process.cwd()));
    console.log('ISOLATED_READ_ONLY_PREFLIGHT_LOADED');
    process.exitCode=23; // A readiness failure must propagate, never be ignored.
  `);
  const git = args => { const r=spawnSync('git',args,{cwd:directory,encoding:'utf8'}); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
  git(['init','--quiet']);git(['add','.']);git(['-c','user.name=Preflight Test','-c','user.email=preflight@example.test','commit','--quiet','-m','fixture']);
  return { directory, parent, revision: git(['rev-parse','HEAD']), cleanup() {
    assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('cronox-preflight-test-'));
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:3});
  } };
}
for (const invalidLock of [false,true]) {
  test(invalidLock ? 'installation failure aborts before executing the database preflight' : 'exact release dependencies load in isolation and a failed readiness guard propagates', () => {
    const f=fixture(invalidLock);
    try {
      const sentinel=path.join(f.directory,'cronox-backend/node_modules/pg/package.json');
      const before=fs.readFileSync(sentinel);
      const r=spawnSync(process.execPath,[runner,'--repo='+f.directory,'--revision='+f.revision],{encoding:'utf8',timeout:60000});
      assert.deepEqual(fs.readFileSync(sentinel),before);
      assert.equal(fs.readFileSync(path.join(f.directory,'cronox-backend/.env'),'utf8'),'ISOLATION_SENTINEL=runtime-config\n');
      if(invalidLock) { assert.equal(r.status,1);assert.match(r.stderr,/ISOLATED_PREFLIGHT_INSTALL_FAILED/);assert.doesNotMatch(r.stdout,/ISOLATED_READ_ONLY_PREFLIGHT_LOADED/); }
      else { assert.equal(r.status,23,r.stderr);assert.match(r.stdout,/PREFLIGHT_DEPENDENCIES_READY pg=8.23.1 dotenv=16.6.1/);assert.match(r.stdout,/ISOLATED_READ_ONLY_PREFLIGHT_LOADED/); }
    } finally { f.cleanup(); }
  });
}
