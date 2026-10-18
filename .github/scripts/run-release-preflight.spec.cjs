'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const runner = path.join(__dirname, 'run-release-preflight.cjs');
const { checkMailboxStorage } = require(runner);

test('incoming preflight rejects root-owned, linked or inaccessible mailbox storage before release', () => {
  const config = { MAILBOX_PRIVATE_DIR: '/var/lib/cronox/mailboxes' };
  const runtime = { platform: 'linux', getuid: () => 1000, getgid: () => 1000 };
  const stat = { isDirectory: () => true, isSymbolicLink: () => false, uid: 1000, gid: 1000, mode: 0o40700, dev: 1 };
  const filesystem = { lstatSync: () => stat, realpathSync: value => value, accessSync: () => {}, readdirSync: () => [] };
  checkMailboxStorage(config, filesystem, runtime);
  assert.throws(() => checkMailboxStorage(config, { ...filesystem, lstatSync: () => ({ ...stat, uid: 0 }) }, runtime), /OWNERSHIP/);
  assert.throws(() => checkMailboxStorage(config, { ...filesystem, realpathSync: () => '/other' }, runtime), /OWNERSHIP/);
  assert.throws(() => checkMailboxStorage(config, { ...filesystem, accessSync: () => { throw Error('EACCES private-file-name'); } }, runtime),
    error => error.message === 'MAILBOX_STORAGE_ACCESS_REQUIRES_REVIEW');
  assert.throws(() => checkMailboxStorage({}, filesystem, runtime), /RUNTIME/);
  assert.throws(() => checkMailboxStorage(config, filesystem, { ...runtime, getuid: () => 0 }), /RUNTIME/);
});

function mailboxInventoryFixture() {
  const directory = '/var/lib/cronox/mailboxes', uuid = '00000000-0000-4000-8000-000000000001';
  const rootStat = { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false,
    uid: 1000, gid: 1000, mode: 0o40700, dev: 1, nlink: 2 };
  const fileStat = { ...rootStat, isDirectory: () => false, isFile: () => true, mode: 0o100600, nlink: 1 };
  const objects = new Map([[directory, rootStat], [directory + '/' + uuid, { ...fileStat }],
    [directory + '/' + uuid + '.meta', { ...fileStat }], [directory + '/uploads', { ...rootStat }],
    [directory + '/uploads/' + uuid + '.upload', { ...fileStat, mode: 0o100644 }]]);
  const lists = new Map([[directory, [uuid, uuid + '.meta', 'uploads']], [directory + '/uploads', [uuid + '.upload']]]);
  const access = [];
  const filesystem = { lstatSync: file => objects.get(file), realpathSync: value => value,
    readdirSync: file => lists.get(file), accessSync: (file, mode) => access.push([file, mode]) };
  return { directory, uuid, objects, lists, access, filesystem,
    config: { MAILBOX_PRIVATE_DIR: directory }, runtime: { platform: 'linux', getuid: () => 1000, getgid: () => 1000 } };
}

test('incoming preflight checks read/write access for every cached body, metadata and upload without reading content', () => {
  const fixture = mailboxInventoryFixture();
  checkMailboxStorage(fixture.config, fixture.filesystem, fixture.runtime);
  assert.deepEqual(new Set(fixture.access.map(([file]) => file)), new Set(fixture.objects.keys()));
  for (const [file, mode] of fixture.access) {
    assert.equal(mode, fs.constants.R_OK | fs.constants.W_OK | (fixture.objects.get(file).isDirectory() ? fs.constants.X_OK : 0));
  }
});

test('fixed root ownership cannot hide inaccessible root-owned cache objects or unsafe inventory', () => {
  for (const scenario of ['owner', 'group', 'symlink', 'hardlink', 'mount', 'mode', 'directory', 'denied', 'name', 'newline-name', 'upload-name', 'root-limit', 'upload-limit']) {
    const f = mailboxInventoryFixture(), file = f.directory + '/' + f.uuid;
    const st = f.objects.get(file);
    if (scenario === 'owner') st.uid = 0;
    if (scenario === 'group') st.gid = 0;
    if (scenario === 'symlink') st.isSymbolicLink = () => true;
    if (scenario === 'hardlink') st.nlink = 2;
    if (scenario === 'mount') st.dev = 2;
    if (scenario === 'mode') st.mode = 0o100644;
    if (scenario === 'directory') st.isFile = () => false;
    if (scenario === 'denied') f.filesystem.accessSync = name => { if (name === file) throw Error('EACCES private-cache-name'); };
    if (scenario === 'name') f.lists.set(f.directory, ['arbitrary-file']);
    if (scenario === 'newline-name') f.lists.set(f.directory, [f.uuid + '\n']);
    if (scenario === 'upload-name') f.lists.set(f.directory + '/uploads', ['other-file']);
    if (scenario === 'root-limit') f.lists.set(f.directory, Array(100001).fill(f.uuid));
    if (scenario === 'upload-limit') f.lists.set(f.directory + '/uploads', Array(10001).fill(f.uuid + '.upload'));
    assert.throws(() => checkMailboxStorage(f.config, f.filesystem, f.runtime),
      error => /^MAILBOX_STORAGE_[A-Z_]+$/.test(error.message), scenario);
  }
});
function fixture(invalidLock = false, accountCheck = false) {
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
  write('cronox-backend/prisma/migrations/20261015120000_customer_account_enablement/migration.sql','-- reviewed incoming migration\n');
  write('cronox-backend/node_modules/pg/package.json', '{"name":"pg","version":"0.0.0"}');
  write('cronox-backend/scripts/check-user-numbering-release.cjs', `
    const assert=require('node:assert/strict'),fs=require('node:fs');
    assert.equal(require('pg/package.json').version,'8.23.1');
    assert.equal(require('dotenv/package.json').version,'16.6.1');
    assert.equal(typeof require('pg').Client,'function');
    assert.equal(require('dotenv').parse(fs.readFileSync(process.env.CRONOX_ENV_FILE)).ISOLATION_SENTINEL,'runtime-config');
    assert.equal(fs.readFileSync(process.env.CRONOX_ACCOUNT_STATE_MIGRATION_FILE,'utf8'),'-- reviewed incoming migration\\n');
    assert.ok(process.argv.includes('--deployment-check'));
    assert.ok(require.resolve('pg').startsWith(process.cwd()));
    console.log('ISOLATED_READ_ONLY_PREFLIGHT_LOADED');
    process.exitCode=${accountCheck ? 0 : 23}; // A readiness failure must propagate, never be ignored.
  `);
  write('cronox-backend/scripts/check-account-state-release.cjs', `
    const assert=require('node:assert/strict'),fs=require('node:fs');
    assert.equal(require('dotenv').parse(fs.readFileSync(process.env.CRONOX_ENV_FILE)).ISOLATION_SENTINEL,'runtime-config');
    console.log('ACCOUNT_STATE_PREFLIGHT_LOADED'); process.exitCode=24;
  `);
  const git = args => { const r=spawnSync('git',args,{cwd:directory,encoding:'utf8'}); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
  git(['init','--quiet']);git(['add','.']);git(['-c','user.name=Preflight Test','-c','user.email=preflight@example.test','commit','--quiet','-m','fixture']);
  return { directory, parent, revision: git(['rev-parse','HEAD']), cleanup() {
    assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('cronox-preflight-test-'));
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:3});
  } };
}
test('account-state maintenance failure propagates after numbering succeeds',()=>{
  const f=fixture(false,true);
  try {
    const r=spawnSync(process.execPath,[runner,'--repo='+f.directory,'--revision='+f.revision],{encoding:'utf8',timeout:60000});
    assert.equal(r.status,24,r.stderr); assert.match(r.stdout,/ACCOUNT_STATE_PREFLIGHT_LOADED/);
  } finally {f.cleanup();}
});
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
