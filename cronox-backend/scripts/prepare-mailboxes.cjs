'use strict';
// Offline only: no database, network, mail provider or worker is invoked here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const backend = path.resolve(__dirname, '..');
const repository = path.dirname(backend);
const dotenv = require(path.join(backend, 'node_modules/dotenv'));

function fixedPrivateKey(curve) {
  const scalar = curve.getPrivateKey();
  const encoded = Buffer.alloc(32);
  scalar.copy(encoded, 32 - scalar.length);
  return encoded.toString('base64url');
}

function prepareValues(existing, directory, subject, local) {
  const values = { ...existing };
  const id = values.MAILBOX_ENCRYPTION_KEY_ID || (local ? 'local-mail-v1' : 'prod-mail-v1');
  if (!/^[\w-]{1,40}$/.test(id)) throw Error('INVALID_ENCRYPTION_KEY_ID');
  let keys;
  try { keys = JSON.parse(values.MAILBOX_ENCRYPTION_KEYS || '{}'); }
  catch { throw Error('INVALID_KEYRING_RESTORE_OR_REPAIR_PRIVATELY'); }
  if (!keys || Array.isArray(keys) || typeof keys !== 'object') throw Error('INVALID_KEYRING');
  keys = Object.assign(Object.create(null), keys);
  for (const [name, value] of Object.entries(keys)) {
    if (!/^[\w-]{1,40}$/.test(name) || typeof value !== 'string' ||
        !/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32) {
      throw Error('INVALID_EXISTING_KEY_RESTORE_OR_REPAIR_PRIVATELY');
    }
  }
  if (!keys[id]) {
    if (Object.keys(keys).length) throw Error('ACTIVE_KEY_MISSING_RESTORE_OR_SELECT_EXISTING_KEY');
    keys[id] = crypto.randomBytes(32).toString('base64');
  }
  const privateKey = values.MAILBOX_VAPID_PRIVATE_KEY;
  const publicKey = values.MAILBOX_VAPID_PUBLIC_KEY;
  const curve = crypto.createECDH('prime256v1');
  if (privateKey) {
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(privateKey)) throw Error();
      curve.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    } catch { throw Error('INVALID_VAPID_PRIVATE_KEY_RESTORE_PRIVATELY'); }
    if (publicKey && publicKey !== curve.getPublicKey().toString('base64url'))
      throw Error('VAPID_PAIR_MISMATCH_RESTORE_PRIVATELY');
  } else {
    if (publicKey) throw Error('VAPID_PRIVATE_KEY_MISSING_RESTORE_PRIVATELY');
    curve.generateKeys();
  }
  const contact = values.MAILBOX_VAPID_SUBJECT || subject;
  if (!contact || (!/^mailto:[^\s@]+@[^\s@]+$/.test(contact) && !/^https:\/\/[^\s]+$/.test(contact)))
    throw Error('VAPID_CONTACT_REQUIRED_USE_SUBJECT_OPTION');
  return {
    MAILBOX_ENCRYPTION_KEY_ID: id,
    MAILBOX_ENCRYPTION_KEYS: JSON.stringify(keys),
    MAILBOX_PRIVATE_DIR: values.MAILBOX_PRIVATE_DIR || directory,
    MAILBOX_VAPID_PRIVATE_KEY: privateKey || fixedPrivateKey(curve),
    MAILBOX_VAPID_PUBLIC_KEY: publicKey || curve.getPublicKey().toString('base64url'),
    MAILBOX_VAPID_SUBJECT: contact,
    MAILBOX_WORKER_ENABLED: 'false',
    MAILBOX_SEND_ENABLED: 'false',
    ...(local ? { MAILBOX_LOCAL_SMTP_REFERENCES: 'true' } : {}),
  };
}

function canonical(target) {
  if (fs.existsSync(target)) return fs.realpathSync(target);
  return path.join(canonical(path.dirname(target)), path.basename(target));
}
function validateDirectory(directory) {
  if (!directory || !path.isAbsolute(directory)) throw Error('PRIVATE_DIRECTORY_MUST_BE_ABSOLUTE');
  const resolved = canonical(directory);
  const relation = path.relative(canonical(repository), resolved);
  if (!relation || (!relation.startsWith('..' + path.sep) && relation !== '..' && !path.isAbsolute(relation)))
    throw Error('PRIVATE_DIRECTORY_MUST_BE_OUTSIDE_REPOSITORY');
  if (resolved === path.parse(resolved).root) throw Error('PRIVATE_DIRECTORY_CANNOT_BE_FILESYSTEM_ROOT');
  return resolved;
}
function restrict(target, directory) {
  if (process.platform !== 'win32') { fs.chmodSync(target, directory ? 0o700 : 0o600); return; }
  const result = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = result.stdout?.match(/S-1-5-\d+(?:-\d+)+/)?.[0];
  if (result.status !== 0 || !sid) throw Error('CANNOT_IDENTIFY_PRIVATE_STORAGE_OWNER');
  const suffix = directory ? '(OI)(CI)F' : 'F';
  const acl = spawnSync('icacls.exe', [target, '/inheritance:r', '/grant:r',
    `*${sid}:${suffix}`, `*S-1-5-18:${suffix}`, `*S-1-5-32-544:${suffix}`],
    { windowsHide: true, stdio: 'ignore' });
  if (acl.status !== 0) throw Error('CANNOT_RESTRICT_PRIVATE_PERMISSIONS');
  // Reject surviving explicit access grants to other identities.
  const inspection = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "$a=Get-Acl -LiteralPath $env:CRONOX_ACL_TARGET; foreach($r in $a.Access){if($r.AccessControlType -eq 'Allow'){ $s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($s -notin @($env:CRONOX_ACL_SID,'S-1-5-18','S-1-5-32-544')){exit 1}}}"],
    { windowsHide: true, stdio: 'ignore', env: { ...process.env, CRONOX_ACL_TARGET: target, CRONOX_ACL_SID: sid } });
  if (inspection.status !== 0) throw Error('UNEXPECTED_EXPLICIT_PRIVATE_STORAGE_ACCESS');
}
function updateEnvironment(text, updates) {
  for (const [name, value] of Object.entries(updates)) {
    if (/[\r\n']/.test(value)) throw Error('UNSUPPORTED_ENVIRONMENT_VALUE');
    const line = `${name}='${value}'`;
    const pattern = new RegExp(`^(?:export\\s+)?${name}\\s*=.*$`, 'gm');
    text = pattern.test(text) ? text.replace(pattern, () => line) : text.trimEnd() + '\n' + line + '\n';
  }
  return text;
}
async function registerDisabledLocal() {
  const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
  const env = loadLocalEnvironment();
  ensureLocalPostgres(env);
  Object.assign(process.env, env);
  const provider = env.SMTP_HOST === 'smtp.hostinger.com' ? 'hostinger'
    : env.SMTP_HOST === 'smtp.titan.email' ? 'titan' : null;
  if (!provider) throw Error('MAILBOX_PROVIDER_NOT_DETECTED');
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    const names = { SUPPORT: 'Soporte', ORDERS: 'Pedidos', NOREPLY: 'No reply', INFO: 'Información' };
    for (const [name, label] of Object.entries(names)) {
      const address = env[`SMTP_${name}_USER`]?.trim().toLowerCase();
      const reference = `SMTP_${name}_PASS`;
      if (!address || !env[reference]) continue;
      if (!/^[^\s@]+@[^\s@]+$/.test(address)) throw Error('INVALID_MAILBOX_ADDRESS');
      await db.mailbox.createMany({ skipDuplicates: true, data: [{
        id: crypto.randomUUID(), name: label, address, username: address, fromName: 'CRONOX',
        provider, imapHost: provider === 'hostinger' ? 'imap.hostinger.com' : 'imap.titan.email',
        imapPort: 993, smtpHost: env.SMTP_HOST, smtpPort: 465,
        imapSecretRef: reference, smtpSecretRef: reference, active: false,
        notify: false, status: 'PENDING_CONFIG', sentCopy: 'append',
      }] });
    }
    console.log(JSON.stringify({ localMailboxes: await db.mailbox.findMany({
      select: { address: true, active: true, status: true, imapSecretRef: true, smtpSecretRef: true },
      orderBy: { address: 'asc' },
    }), providerConnection: 'NOT_TESTED' }));
  } finally { await db.$disconnect(); }
}
async function run() {
  const options = {};
  for (const argument of process.argv.slice(2)) {
    if (argument === '--register-local') { options.registerLocal = true; continue; }
    const match = argument.match(/^--(env-file|private-dir|subject|runtime-pm2)=(.+)$/);
    if (!match) throw Error('USE_ENV_FILE_PRIVATE_DIR_SUBJECT_OPTIONS');
    options[match[1]] = match[2];
  }
  const envFile = path.resolve(options['env-file'] || path.join(backend, '.env.local'));
  const local = envFile === path.join(backend, '.env.local');
  if (options.registerLocal && !local) throw Error('REGISTRATION_ONLY_ALLOWED_IN_LOCAL_PROFILE');
  if (!fs.existsSync(envFile)) throw Error('PRIVATE_ENVIRONMENT_FILE_MUST_ALREADY_EXIST');
  if (fs.lstatSync(envFile).isSymbolicLink()) throw Error('USE_REAL_PRIVATE_ENVIRONMENT_FILE_PATH');
  const ignored = spawnSync('git', ['-c', `safe.directory=${repository}`, 'check-ignore', '--quiet', envFile], { cwd: repository, stdio: 'ignore' });
  if (envFile.startsWith(repository + path.sep) && ignored.status !== 0)
    throw Error('ENVIRONMENT_FILE_MUST_BE_EXCLUDED_FROM_GIT');
  const text = fs.readFileSync(envFile, 'utf8');
  const existing = dotenv.parse(text);
  if (options['runtime-pm2']) {
    if (local || process.platform === 'win32') throw Error('PM2_INSPECTION_ONLY_FOR_PRODUCTION_LINUX');
    if (process.getuid() !== 0) throw Error('PRODUCTION_PM2_ROOT_SESSION_REQUIRED');
    const pm2Home = process.env.PM2_HOME || '/root/.pm2';
    const daemonPidFile = path.join(pm2Home, 'pm2.pid');
    if (!fs.existsSync(daemonPidFile) || fs.statSync(daemonPidFile).uid !== 0)
      throw Error('EXISTING_ROOT_PM2_DAEMON_REQUIRED');
    const daemonPid = Number(fs.readFileSync(daemonPidFile, 'utf8').trim());
    if (!Number.isInteger(daemonPid) || daemonPid < 2 || fs.statSync(`/proc/${daemonPid}`).uid !== 0)
      throw Error('EXISTING_ROOT_PM2_DAEMON_REQUIRED');
    process.kill(daemonPid, 0);
    const runtime = spawnSync('/usr/bin/pm2', ['jlist'], { encoding: 'utf8',
      env: { ...process.env, PM2_HOME: pm2Home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let app;
    try { app = JSON.parse(runtime.stdout).find(p => p.name === options['runtime-pm2']); }
    catch { throw Error('CANNOT_INSPECT_EXISTING_PM2_CONFIGURATION'); }
    if (runtime.status !== 0 || !app) throw Error('EXISTING_PM2_APPLICATION_NOT_FOUND');
    const inherited = { ...(app.pm2_env.env || {}), ...app.pm2_env };
    if (inherited.CRONOX_ENV_FILE && path.resolve(inherited.CRONOX_ENV_FILE) !== envFile)
      throw Error('PM2_USES_A_DIFFERENT_PRIVATE_ENVIRONMENT_FILE');
    if (inherited.MAILBOX_WORKER_ENABLED === 'true' || inherited.MAILBOX_SEND_ENABLED === 'true')
      throw Error('PM2_MAILBOX_OVERRIDE_MUST_BE_DISABLED_BEFORE_PREPARATION');
    for (const name of ['MAILBOX_ENCRYPTION_KEY_ID', 'MAILBOX_ENCRYPTION_KEYS', 'MAILBOX_VAPID_PUBLIC_KEY',
      'MAILBOX_VAPID_PRIVATE_KEY', 'MAILBOX_VAPID_SUBJECT', 'MAILBOX_PRIVATE_DIR']) {
      if (!inherited[name]) continue;
      if (existing[name] && existing[name] !== inherited[name]) throw Error('PM2_AND_ENVIRONMENT_CONFLICT_REVIEW_PRIVATELY');
      existing[name] = inherited[name];
    }
  }
  if (local) require('./start-local.cjs').buildLocalEnvironment(existing, {});
  const source = local && fs.existsSync(path.join(backend, '.env'))
    ? dotenv.parse(fs.readFileSync(path.join(backend, '.env'))) : existing;
  const defaultDirectory = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'CRONOX', 'mailboxes') : '/var/lib/cronox/mailboxes';
  const values = prepareValues(existing, options['private-dir'] || defaultDirectory,
    options.subject || (source.SMTP_SUPPORT_USER ? `mailto:${source.SMTP_SUPPORT_USER}` : ''), local);
  const directory = validateDirectory(values.MAILBOX_PRIVATE_DIR);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  restrict(directory, true);
  const probe = path.join(directory, `.mailbox-access-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(probe, 'private-storage-probe', { flag: 'wx', mode: 0o600 });
    restrict(probe, false);
    if (fs.readFileSync(probe, 'utf8') !== 'private-storage-probe') throw Error('PRIVATE_STORAGE_ACCESS_FAILED');
  } finally { if (fs.existsSync(probe)) fs.unlinkSync(probe); }
  restrict(envFile, false);
  const updated = updateEnvironment(text, values);
  if (text !== updated) {
    const temporary = envFile + `.mailbox-${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, '', { flag: 'wx', mode: 0o600 });
      if (process.platform !== 'win32') {
        const original = fs.statSync(envFile);
        fs.chownSync(temporary, original.uid, original.gid);
      }
      restrict(temporary, false);
      fs.writeFileSync(temporary, updated);
      fs.renameSync(temporary, envFile);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  console.log(JSON.stringify({ environment: envFile, privateDirectory: directory,
    encryption: 'configured', vapid: 'configured', providerConnection: 'NOT_TESTED',
    synchronization: false, sending: false, changed: text !== updated }));
  if (options.registerLocal) await registerDisabledLocal();
}
if (require.main === module) {
  run().catch(error => {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'CHECK_PRIVATE_CONFIGURATION_PATHS_PERMISSIONS_AND_LOCAL_MIGRATION';
    console.error(`MAILBOX_PREPARATION_FAILED: ${code}. No secrets were logged.`);
    process.exitCode = 1;
  });
}
module.exports = { prepareValues, updateEnvironment, validateDirectory, fixedPrivateKey };
