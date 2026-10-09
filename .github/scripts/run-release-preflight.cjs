'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
    const options = { cwd: isolated, stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_PATH: '' } };
    const npmArgs = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
    const install = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm ' + npmArgs.join(' ')], options)
      : spawnSync('npm', npmArgs, options);
    if (install.status !== 0) throw Error('ISOLATED_PREFLIGHT_INSTALL_FAILED');
    console.log(`PREFLIGHT_DEPENDENCIES_READY pg=${dependencies.pg} dotenv=${dependencies.dotenv}`);
    const result = spawnSync(process.execPath, [path.join(isolated, 'check-user-numbering-release.cjs'), '--deployment-check'], {
      ...options, env: { ...options.env, CRONOX_ENV_FILE: environmentFile },
    });
    return result.status ?? 1;
  } finally {
    // Remove only this invocation's mkdtemp directory, never application files.
    if (path.dirname(isolated) !== parent || !path.basename(isolated).startsWith('cronox-preflight-')) throw Error('UNSAFE_PREFLIGHT_CLEANUP_PATH');
    fs.rmSync(isolated, { recursive: true, force: true, maxRetries: 3 });
  }
}
module.exports = { main };
if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted connection]')); process.exitCode = 1; }
}
