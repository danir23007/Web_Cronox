'use strict';
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadLocalEnvironment } = require('./start-local.cjs');
const env = loadLocalEnvironment();
const url = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local migration only');
const backend = path.resolve(__dirname, '..');
const name = '20261008120000_stable_user_identity_newsletter_link';
const pgEnv = { ...env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
const psql = path.join(env.LOCAL_PG_BIN || 'C:/Program Files/PostgreSQL/17/bin', process.platform === 'win32' ? 'psql.exe' : 'psql');
const options = { env: pgEnv, windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };
const migrated = execFileSync(psql, ['-X', '-At', '-c', 'SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=\'NewsletterSubscription\' AND column_name=\'userId\')'], options).trim();
const guard = execFileSync(psql, ['-X', '-At', '-c', 'SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=\'User_check_reserved_id\')'], options).trim();
for (const migrationName of [ ...(migrated === 't' ? [] : [name]), ...(guard === 't' ? [] : ['20261008121000_prevent_deleted_user_id_reuse']) ]) {
  execFileSync(psql, ['-X', '-v', 'ON_ERROR_STOP=1'], { ...options, input: fs.readFileSync(path.join(backend, 'prisma/migrations', migrationName, 'migration.sql'), 'utf8') });
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'resolve', '--applied', migrationName], { cwd: backend, env, windowsHide: true, stdio: 'pipe' });
  console.log('Applied and recorded local migration: ' + migrationName);
}
console.log('Protected local identity/newsletter migrations ready');
