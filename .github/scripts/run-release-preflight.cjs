'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function checkMailboxStorage(config, filesystem = fs, runtime = process) {
  const directory = '/var/lib/cronox/mailboxes';
  if (config.MAILBOX_PRIVATE_DIR !== directory || runtime.platform !== 'linux'
      || !runtime.getuid || !runtime.getgid || runtime.getuid() === 0 || runtime.getgid() === 0) {
    throw Error('MAILBOX_STORAGE_RUNTIME_REQUIRES_REVIEW');
  }
  try {
    const root = filesystem.lstatSync(directory);
    if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== runtime.getuid()
        || root.gid !== runtime.getgid() || (root.mode & 0o7777) !== 0o700
        || filesystem.realpathSync(directory) !== directory) {
      throw Error('MAILBOX_STORAGE_OWNERSHIP_REQUIRES_REVIEW');
    }
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
    // Absolute end assertion also rejects a trailing newline in a filename.
    const fileName = new RegExp('^' + uuid + '(?:\\.meta)?(?![\\s\\S])');
    const uploadName = new RegExp('^' + uuid + '\\.upload(?![\\s\\S])');
    const assertObject = (file, kind, modes) => {
      const value = filesystem.lstatSync(file);
      if (value.isSymbolicLink() || (kind === 'directory' ? !value.isDirectory() : !value.isFile())
          || value.uid !== runtime.getuid() || value.gid !== runtime.getgid() || value.dev !== root.dev
          || !modes.includes(value.mode & 0o7777) || (kind === 'file' && value.nlink !== 1)) {
        throw Error('MAILBOX_STORAGE_OBJECT_REQUIRES_REVIEW');
      }
      filesystem.accessSync(file, fs.constants.R_OK | fs.constants.W_OK
        | (kind === 'directory' ? fs.constants.X_OK : 0));
    };
    filesystem.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    const names = filesystem.readdirSync(directory);
    if (names.length > 100000) throw Error('MAILBOX_STORAGE_INVENTORY_LIMIT');
    for (const name of names) {
      const file = directory + '/' + name;
      if (name === 'uploads') {
        assertObject(file, 'directory', [0o700]);
        const uploads = filesystem.readdirSync(file);
        if (uploads.length > 10000) throw Error('MAILBOX_STORAGE_INVENTORY_LIMIT');
        for (const upload of uploads) {
          if (!uploadName.test(upload)) throw Error('MAILBOX_STORAGE_NAME_REQUIRES_REVIEW');
          // Multer uploads may be 0644 inside directories that remain 0700.
          assertObject(file + '/' + upload, 'file', [0o600, 0o644]);
        }
      } else {
        if (!fileName.test(name)) throw Error('MAILBOX_STORAGE_NAME_REQUIRES_REVIEW');
        assertObject(file, 'file', [0o600]);
      }
    }
  } catch (error) {
    // Native fs errors can contain private cache object names: report only codes.
    if (/^MAILBOX_STORAGE_[A-Z_]+$/.test(error.message || '')) throw error;
    throw Error('MAILBOX_STORAGE_ACCESS_REQUIRES_REVIEW');
  }
  // v5 already executes this incoming preflight as deploy, before maintenance.
  // Inspect metadata and OS access only; no contents, mutation or ownership repair.
  console.log('MAILBOX_STORAGE_DEPLOY_ACCESS_OK');
}

function main(args = process.argv.slice(2)) {
  const argument = name => args.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
  const repository = fs.realpathSync(argument('--repo') || process.cwd());
  const revision = argument('--revision');
  const environmentFile = path.resolve(argument('--env-file') || path.join(repository, 'cronox-backend/.env'));
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw Error('EXACT_RELEASE_SHA_REQUIRED');
  if (!fs.statSync(environmentFile).isFile()) throw Error('RUNTIME_ENV_FILE_REQUIRED');
  const read = file => {
    const result = spawnSync('git', ['show', `${revision}:${file}`], { cwd: repository, encoding: 'utf8' });
    if (result.status !== 0) throw Error(`RELEASE_FILE_UNAVAILABLE:${file}`);
    return result.stdout;
  };
  const manifest = read('.github/preflight/package.json');
  const lockfile = read('.github/preflight/package-lock.json');
  const check = read('cronox-backend/scripts/check-user-numbering-release.cjs');
  const accountCheck = read('cronox-backend/scripts/check-account-state-release.cjs');
  const accountMigration = read('cronox-backend/prisma/migrations/20261015120000_customer_account_enablement/migration.sql');
  const backendLock = JSON.parse(read('cronox-backend/package-lock.json'));
  const dependencies = JSON.parse(manifest).dependencies;
  for (const name of ['pg', 'dotenv']) {
    if (dependencies[name] !== backendLock.packages[`node_modules/${name}`].version) throw Error(`PREFLIGHT_VERSION_DIFFERS_FROM_BACKEND:${name}`);
  }
  const parent = fs.realpathSync(os.tmpdir());
  const isolated = fs.mkdtempSync(path.join(parent, 'cronox-preflight-'));
  fs.chmodSync(isolated, 0o700);
  try {
    fs.writeFileSync(path.join(isolated, 'package.json'), manifest, { mode: 0o600 });
    fs.writeFileSync(path.join(isolated, 'package-lock.json'), lockfile, { mode: 0o600 });
    fs.writeFileSync(path.join(isolated, 'check-user-numbering-release.cjs'), check, { mode: 0o600 });
    fs.writeFileSync(path.join(isolated, 'check-account-state-release.cjs'), accountCheck, { mode: 0o600 });
    const accountMigrationFile = path.join(isolated, 'account-state-migration.sql');
    fs.writeFileSync(accountMigrationFile, accountMigration, { mode: 0o600 });
    const options = { cwd: isolated, stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_PATH: '' } };
    const npmArgs = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
    const install = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm ' + npmArgs.join(' ')], options)
      : spawnSync('npm', npmArgs, options);
    if (install.status !== 0) throw Error('ISOLATED_PREFLIGHT_INSTALL_FAILED');
    console.log(`PREFLIGHT_DEPENDENCIES_READY pg=${dependencies.pg} dotenv=${dependencies.dotenv}`);
    for (const script of ['check-user-numbering-release.cjs', 'check-account-state-release.cjs']) {
      const result = spawnSync(process.execPath, [path.join(isolated, script), '--deployment-check', ...(script==='check-user-numbering-release.cjs'?['--before-migrate']:[])], {
        ...options, env: { ...options.env, CRONOX_ENV_FILE: environmentFile, CRONOX_ACCOUNT_STATE_MIGRATION_FILE: accountMigrationFile },
      });
      if (result.status !== 0) return result.status ?? 1;
    }
    const configuration = require(path.join(isolated, 'node_modules/dotenv')).parse(fs.readFileSync(environmentFile));
    checkMailboxStorage({ ...configuration, ...process.env });
    return 0;
  } finally {
    // Remove only this invocation's mkdtemp directory, never application files.
    if (path.dirname(isolated) !== parent || !path.basename(isolated).startsWith('cronox-preflight-')) throw Error('UNSAFE_PREFLIGHT_CLEANUP_PATH');
    fs.rmSync(isolated, { recursive: true, force: true, maxRetries: 3 });
  }
}
module.exports = { main, checkMailboxStorage };
if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted connection]')); process.exitCode = 1; }
}
